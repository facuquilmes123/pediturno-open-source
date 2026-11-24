import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { enqueueWhatsAppReminder } from '@/lib/whatsapp-reminder-outbox';
import { claimWhatsAppReminder, finishWhatsAppReminderAttempt } from '@/lib/whatsapp-reminder-worker';
import { prepareWhatsAppReminderDispatch } from '@/lib/whatsapp-reminder-dispatch';
import type { WhatsAppReminderSource } from '@/lib/whatsapp-reminder-policy';

let app: App, db: Firestore;
const now = Date.parse('2026-11-06T15:00:00Z');
function source(): WhatsAppReminderSource {
  return { nowMs: now, business: { id: 'dispatch-owner', status: 'active', remindersEnabled: true },
    appointment: { id: 'dispatch-appointment', businessId: 'dispatch-owner', clientId: 'dispatch-client', status: 'Confirmado', startsAtMs: now + 3600000, reminderDueAtMs: now - 1 },
    client: { id: 'dispatch-client', businessId: 'dispatch-owner', phoneE164: '+5491100000000' },
    consent: { businessId: 'dispatch-owner', clientId: 'dispatch-client', phoneE164: '+5491100000000', category: 'appointment_reminder', textVersion: 'qa-v1', grantedAtMs: now - 1000 },
    sender: { businessId: 'dispatch-owner', phoneNumberId: '123456', active: true },
    template: { businessId: 'dispatch-owner', name: 'qa_reminder', language: 'es_AR', category: 'UTILITY', status: 'APPROVED', revision: 'qa-v1' } };
}
const sourceRef = () => db.doc('qaDispatchSources/current');
async function load(tx: Transaction) { return (await tx.get(sourceRef())).data() as WhatsAppReminderSource | undefined ?? null; }
async function claimed() {
  const input = source(); await sourceRef().set(input);
  const queued = await enqueueWhatsAppReminder(db, input);
  if (queued.status !== 'enqueued') throw Error('Expected queue');
  const options = { businessId: input.business.id, deliveryKey: queued.deliveryKey, nowMs: now };
  const claim = await claimWhatsAppReminder(db, options, load);
  if (claim.status !== 'claimed') throw Error('Expected claim');
  return { ...options, leaseToken: claim.leaseToken };
}
beforeAll(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-whatsapp-dispatch' }, 'whatsapp-dispatch-it'); db = getFirestore(app);
});
beforeEach(async () => { for (const name of ['whatsappReminderOutbox', 'qaDispatchSources']) await db.recursiveDelete(db.collection(name)); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });

describe('final pre-dispatch gate without provider calls', () => {
  it('allows exactly one preparation under concurrent callers and stores no contact', async () => {
    const options = await claimed();
    const results = await Promise.all(Array.from({ length: 4 }, () => prepareWhatsAppReminderDispatch(db, options, load)));
    expect(results.filter(r => r.status === 'ready')).toHaveLength(1);
    expect(results.filter(r => r.status === 'already_prepared')).toHaveLength(3);
    const ready = results.find(r => r.status === 'ready');
    expect(ready?.status === 'ready' && ready.dispatch.phoneE164).toBe(source().client.phoneE164);
    const stored = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(stored.dispatchAttempt).toBe(1);
    expect(JSON.stringify(stored)).not.toContain(source().client.phoneE164);
    expect(stored).not.toHaveProperty('dispatch');
  });
  it.each(['cancelled', 'revoked', 'phone', 'rescheduled', 'disabled', 'template_revision', 'template_name', 'template_language', 'sender'])(
    'revalidates after claim and prevents dispatch for %s', async change => {
      const options = await claimed(), fresh = source();
      if (change === 'cancelled') fresh.appointment.status = 'Cancelado';
      if (change === 'revoked') fresh.consent!.revokedAtMs = now;
      if (change === 'phone') fresh.client.phoneE164 = '+5491100000001';
      if (change === 'rescheduled') fresh.appointment.startsAtMs += 60000;
      if (change === 'disabled') fresh.business.remindersEnabled = false;
      if (change === 'template_revision') fresh.template!.revision = 'qa-v2';
      if (change === 'template_name') fresh.template!.name = 'other_template';
      if (change === 'template_language') fresh.template!.language = 'en_US';
      if (change === 'sender') fresh.sender!.phoneNumberId = '654321';
      await sourceRef().set(fresh);
      expect((await prepareWhatsAppReminderDispatch(db, options, load)).status).toBe('cancelled');
      expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('dispatchAttempt')).toBeUndefined();
    });
  it('does not read source or expose contacts to another business or stale lease', async () => {
    const options = await claimed(), loader = vi.fn(load);
    expect((await prepareWhatsAppReminderDispatch(db, { ...options, businessId: 'other-owner' }, loader)).status).toBe('stale');
    expect((await prepareWhatsAppReminderDispatch(db, { ...options, leaseToken: '0'.repeat(36) }, loader)).status).toBe('stale');
    expect(loader).not.toHaveBeenCalled();
  });
  it('quarantines an expired claim rather than preparing or retrying it', async () => {
    const options = await claimed(), loader = vi.fn(load);
    expect((await prepareWhatsAppReminderDispatch(db, { ...options, nowMs: now + 60000 }, loader)).status).toBe('uncertain');
    expect(loader).not.toHaveBeenCalled();
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 120000 }, load)).status).toBe('ignored');
  });
  it('only prepares again for a new attempt with proven not-submitted outcome', async () => {
    const options = await claimed();
    expect((await prepareWhatsAppReminderDispatch(db, options, load)).status).toBe('ready');
    expect((await finishWhatsAppReminderAttempt(db, options, { kind: 'not_submitted', retryable: true })).status).toBe('retry');
    const later = { ...options, nowMs: now + 60000 };
    const next = await claimWhatsAppReminder(db, later, load);
    if (next.status !== 'claimed') throw Error('Expected next claim');
    expect((await prepareWhatsAppReminderDispatch(db, { ...later, leaseToken: next.leaseToken }, load)).status).toBe('ready');
    expect((await prepareWhatsAppReminderDispatch(db, later, load)).status).toBe('stale');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('dispatchAttempt')).toBe(2);
  });
  it('does not equate preparation to provider acceptance or delivery', async () => {
    const options = await claimed(); await prepareWhatsAppReminderDispatch(db, options, load);
    const job = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(job.status).toBe('claimed'); expect(job.providerMessageId).toBeUndefined(); expect(job.acceptedAt).toBeUndefined();
  });
});
