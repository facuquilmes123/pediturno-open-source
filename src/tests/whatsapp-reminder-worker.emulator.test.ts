import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { enqueueWhatsAppReminder } from '@/lib/whatsapp-reminder-outbox';
import { claimWhatsAppReminder, finishWhatsAppReminderAttempt } from '@/lib/whatsapp-reminder-worker';
import { recordWhatsAppReminderConsent, loadWhatsAppReminderConsent } from '@/lib/whatsapp-reminder-consent';
import { planWhatsAppReminder, type WhatsAppReminderSource } from '@/lib/whatsapp-reminder-policy';

let app: App, db: Firestore;
const now = Date.parse('2026-11-06T15:00:00Z');
function source(): WhatsAppReminderSource {
  return { nowMs: now, business: { id: 'owner-a', status: 'active', remindersEnabled: true },
    appointment: { id: 'appointment-a', businessId: 'owner-a', clientId: 'client-a', status: 'Confirmado', startsAtMs: now + 3600000, reminderDueAtMs: now - 1 },
    client: { id: 'client-a', businessId: 'owner-a', phoneE164: '+5491100000000' },
    consent: { businessId: 'owner-a', clientId: 'client-a', phoneE164: '+5491100000000', category: 'appointment_reminder', textVersion: 'v1', grantedAtMs: now - 1000 },
    sender: { businessId: 'owner-a', phoneNumberId: '123456', active: true },
    template: { businessId: 'owner-a', name: 'appointment_reminder', language: 'es_AR', category: 'UTILITY', status: 'APPROVED', revision: 'v1' } };
}
const sourceRef = () => db.doc('qaWhatsAppSources/owner-a');
async function load(tx: Transaction, refs: { businessId: string }) {
  return (await tx.get(db.doc(`qaWhatsAppSources/${refs.businessId}`))).data() as WhatsAppReminderSource | undefined ?? null;
}
async function target(tx: Transaction, refs: { businessId: string; clientId: string }) {
  const current = await load(tx, refs);
  return current && current.client.id === refs.clientId ? { businessId: current.client.businessId, clientId: current.client.id, phoneE164: current.client.phoneE164 } : null;
}
function grant(actionId = 'grant-a', nowMs = now - 1000) {
  return { businessId: 'owner-a', clientId: 'client-a', phoneE164: '+5491100000000', origin: 'client_preferences' as const,
    actionId, nowMs, decision: 'grant' as const, explicitOptIn: true as const, textVersion: 'v1' };
}
function revoke(actionId = 'revoke-a', nowMs = now) {
  const { textVersion: _version, explicitOptIn: _optIn, ...rest } = grant(actionId, nowMs);
  return { ...rest, decision: 'revoke' as const };
}
async function prepare() {
  const input = source();
  await sourceRef().set(input);
  const result = await enqueueWhatsAppReminder(db, input);
  if (result.status !== 'enqueued') throw Error('Expected enqueue');
  return { businessId: input.business.id, deliveryKey: result.deliveryKey, nowMs: now };
}
async function claimed(options: Awaited<ReturnType<typeof prepare>>) {
  const result = await claimWhatsAppReminder(db, options, load);
  if (result.status !== 'claimed') throw Error('Expected claim');
  return { ...options, leaseToken: result.leaseToken };
}
beforeAll(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-whatsapp-worker' }, 'whatsapp-worker-it');
  db = getFirestore(app);
});
beforeEach(async () => {
  for (const name of ['whatsappReminderOutbox', 'qaWhatsAppSources', 'whatsappReminderConsents', 'whatsappReminderConsentEvents']) {
    await db.recursiveDelete(db.collection(name));
  }
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });

describe('internal WhatsApp job lifecycle without a provider', () => {
  it('grants only one lease under concurrent workers and keeps contacts out of the job', async () => {
    const options = await prepare();
    const results = await Promise.all(Array.from({ length: 5 }, () => claimWhatsAppReminder(db, options, load)));
    expect(results.filter(r => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter(r => r.status === 'busy')).toHaveLength(4);
    const record = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(record.attempts).toBe(1);
    expect(JSON.stringify(record)).not.toContain(source().client.phoneE164);
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('credentials');
  });
  it('does not read source or mutate another tenant or a missing job', async () => {
    const options = await prepare(), loader = vi.fn(load);
    expect((await claimWhatsAppReminder(db, { ...options, businessId: 'owner-b' }, loader)).status).toBe('foreign');
    expect((await claimWhatsAppReminder(db, { ...options, deliveryKey: '0'.repeat(64) }, loader)).status).toBe('missing');
    expect(loader).not.toHaveBeenCalled();
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(0);
  });
  it('defers a future job without consuming an attempt', async () => {
    const options = await prepare();
    await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).update({ dueAt: Timestamp.fromMillis(now + 1000) });
    expect((await claimWhatsAppReminder(db, options, load)).status).toBe('deferred');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(0);
  });
  it('quarantines an expired lease and never automatically sends it again', async () => {
    const options = await prepare(); await claimed(options);
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 60000 }, load)).status).toBe('uncertain');
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 120000 }, load)).status).toBe('ignored');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(1);
  });
  it.each(['revoked', 'cancelled', 'rescheduled', 'phone_changed', 'disabled', 'foreign_source'])(
    'reloads current source and blocks %s before claiming', async change => {
      const options = await prepare(), current = source();
      if (change === 'revoked') current.consent!.revokedAtMs = now;
      if (change === 'cancelled') current.appointment.status = 'Cancelado';
      if (change === 'rescheduled') current.appointment.startsAtMs += 60000;
      if (change === 'phone_changed') current.client.phoneE164 = '+5491100000001';
      if (change === 'disabled') current.business.remindersEnabled = false;
      if (change === 'foreign_source') current.client.businessId = 'owner-b';
      await sourceRef().set(current);
      expect((await claimWhatsAppReminder(db, options, load)).status).toBe('cancelled');
      expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(0);
    });
  it('cancels missing source and uses the worker clock instead of a stale source time', async () => {
    const options = await prepare();
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 3600000 }, load)).status).toBe('cancelled');
    // A separate occurrence verifies absence without resetting the cancelled job.
    const input = source(); input.appointment.id = 'appointment-b'; await sourceRef().set(input);
    const enqueued = await enqueueWhatsAppReminder(db, input);
    if (enqueued.status !== 'enqueued') throw Error('Expected enqueue');
    await sourceRef().delete();
    expect((await claimWhatsAppReminder(db, { ...options, deliveryKey: enqueued.deliveryKey }, load)).status).toBe('cancelled');
  });
  it('respects a postponed reminder and refreshes approved sender/template references', async () => {
    const options = await prepare(), input = source();
    input.appointment.reminderDueAtMs = now + 1000; input.sender!.phoneNumberId = '654321'; input.template!.revision = 'v2';
    await sourceRef().set(input);
    expect((await claimWhatsAppReminder(db, options, load)).status).toBe('deferred');
    const result = await claimWhatsAppReminder(db, { ...options, nowMs: now + 1000 }, load);
    expect(result.status).toBe('claimed');
    if (result.status === 'claimed') expect(result.references).toMatchObject({ senderId: '654321', templateRevision: 'v2' });
  });
  it('does not defer a job using another business source, even if that source is not due', async () => {
    const options = await prepare(), input = source();
    input.business.id = 'owner-b'; input.appointment.businessId = 'owner-b'; input.client.businessId = 'owner-b';
    input.appointment.reminderDueAtMs = now + 50000;
    const loader = async () => input;
    expect((await claimWhatsAppReminder(db, options, loader)).status).toBe('cancelled');
    const record = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(record.dueAt.toMillis()).toBe(now - 1); expect(record.attempts).toBe(0);
  });
  it('records acceptance once without claiming delivery or resetting on enqueue', async () => {
    const options = await prepare(), lease = await claimed(options);
    expect((await finishWhatsAppReminderAttempt(db, lease, { kind: 'accepted', messageId: 'wamid.test-a' })).status).toBe('sent');
    expect((await finishWhatsAppReminderAttempt(db, lease, { kind: 'accepted', messageId: 'wamid.test-a' })).status).toBe('stale');
    expect((await enqueueWhatsAppReminder(db, source())).status).toBe('duplicate');
    const record = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(record).not.toHaveProperty('deliveredAt'); expect(record).not.toHaveProperty('readAt');
    expect(record.attempts).toBe(1);
  });
  it('does not retry an uncertain submission', async () => {
    const options = await prepare(), lease = await claimed(options);
    expect((await finishWhatsAppReminderAttempt(db, lease, { kind: 'uncertain' })).status).toBe('uncertain');
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 120000 }, load)).status).toBe('ignored');
  });
  it('backs off only a proven unsubmitted attempt and fences the previous worker', async () => {
    const options = await prepare(), lease = await claimed(options);
    expect((await finishWhatsAppReminderAttempt(db, lease, { kind: 'not_submitted', retryable: true })).status).toBe('retry');
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: now + 59999 }, load)).status).toBe('deferred');
    const next = await claimed({ ...options, nowMs: now + 60000 });
    expect((await finishWhatsAppReminderAttempt(db, { ...lease, nowMs: now + 60001 }, { kind: 'accepted', messageId: 'wamid.stale' })).status).toBe('stale');
    expect((await finishWhatsAppReminderAttempt(db, next, { kind: 'accepted', messageId: 'wamid.current' })).status).toBe('sent');
  });
  it('caps unsubmitted retries at three total attempts', async () => {
    const options = await prepare(); let time = now;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const lease = await claimed({ ...options, nowMs: time });
      const result = await finishWhatsAppReminderAttempt(db, lease, { kind: 'not_submitted', retryable: true });
      expect(result.status).toBe(attempt < 3 ? 'retry' : 'failed');
      time += 60000 * 2 ** (attempt - 1);
    }
    expect((await claimWhatsAppReminder(db, { ...options, nowMs: time }, load)).status).toBe('ignored');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(3);
  });
  it('keeps a late acceptance for reconciliation without overwriting its identifier', async () => {
    const options = await prepare(), lease = await claimed(options);
    await claimWhatsAppReminder(db, { ...options, nowMs: now + 60000 }, load);
    expect((await finishWhatsAppReminderAttempt(db, { ...lease, nowMs: now + 60001 }, { kind: 'accepted', messageId: 'wamid.late' })).status).toBe('uncertain');
    expect((await finishWhatsAppReminderAttempt(db, { ...lease, nowMs: now + 60002 }, { kind: 'accepted', messageId: 'wamid.other' })).status).toBe('stale');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('providerMessageId')).toBe('wamid.late');
  });
  it('rejects invalid leases and a malformed due date', async () => {
    const options = await prepare();
    await expect(claimWhatsAppReminder(db, { ...options, leaseMs: 1 }, load)).rejects.toThrow('lease');
    await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).update({ dueAt: 'invalid' });
    await expect(claimWhatsAppReminder(db, options, load)).rejects.toThrow('due date');
  });
  it('rejects a non-string or unsafe provider identifier before settling a job', async () => {
    const options = await prepare(), lease = await claimed(options);
    await expect(finishWhatsAppReminderAttempt(db, lease, { kind: 'accepted', messageId: undefined as unknown as string })).rejects.toThrow('Invalid');
    await expect(finishWhatsAppReminderAttempt(db, lease, { kind: 'accepted', messageId: 'unsafe\nbody' })).rejects.toThrow('Invalid');
    expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('status')).toBe('claimed');
  });
});

describe('private explicit consent and opt-out persistence', () => {
  beforeEach(async () => { await sourceRef().set(source()); });
  async function consent() { return db.runTransaction(tx => loadWhatsAppReminderConsent(db, tx, 'owner-a', 'client-a')); }
  it('stores an explicit opt-in once and keeps an immutable action record', async () => {
    expect((await recordWhatsAppReminderConsent(db, grant(), target)).status).toBe('recorded');
    expect((await recordWhatsAppReminderConsent(db, grant(), target)).status).toBe('duplicate');
    expect((await db.collection('whatsappReminderConsentEvents').get()).size).toBe(1);
    expect(planWhatsAppReminder({ ...source(), consent: await consent() }).eligible).toBe(true);
  });
  it('persists opt-out, blocks claim and requires a later explicit opt-in', async () => {
    const options = await prepare();
    await recordWhatsAppReminderConsent(db, grant(), target);
    await recordWhatsAppReminderConsent(db, revoke(), target);
    const loader = async (tx: Transaction, refs: { businessId: string }) => {
      const input = await load(tx, refs);
      return input ? { ...input, consent: await loadWhatsAppReminderConsent(db, tx, 'owner-a', 'client-a') } : null;
    };
    expect((await claimWhatsAppReminder(db, options, loader)).status).toBe('cancelled');
    await recordWhatsAppReminderConsent(db, grant('grant-b', now + 1), target);
    expect(planWhatsAppReminder({ ...source(), nowMs: now + 1, consent: await consent() }).eligible).toBe(true);
    expect((await enqueueWhatsAppReminder(db, { ...source(), nowMs: now + 1, consent: await consent() })).status).toBe('duplicate');
  });
  it.each(['grant-first', 'revoke-first'])('gives equal-time opt-out priority: %s', async order => {
    if (order === 'grant-first') { await recordWhatsAppReminderConsent(db, grant('grant-a', now), target); await recordWhatsAppReminderConsent(db, revoke(), target); }
    else { await recordWhatsAppReminderConsent(db, revoke(), target); await recordWhatsAppReminderConsent(db, grant('grant-a', now), target); }
    expect(planWhatsAppReminder({ ...source(), consent: await consent() }).eligible).toBe(false);
  });
  it('does not resurrect consent with an older action', async () => {
    await recordWhatsAppReminderConsent(db, revoke(), target);
    expect((await recordWhatsAppReminderConsent(db, grant(), target)).status).toBe('stale');
    expect(await consent()).toBeNull();
    const events = await db.collection('whatsappReminderConsentEvents').get();
    expect(events.docs.some(doc => doc.get('decision') === 'grant' && doc.get('applied') === false)).toBe(true);
  });
  it('rejects reuse of an action ID for a different decision', async () => {
    await recordWhatsAppReminderConsent(db, grant(), target);
    await expect(recordWhatsAppReminderConsent(db, revoke('grant-a'), target)).rejects.toThrow('conflict');
    expect((await db.collection('whatsappReminderConsentEvents').get()).size).toBe(1);
  });
  it('rejects foreign contacts and changed numbers without writing consent', async () => {
    const input = source(); input.client.phoneE164 = '+5491100000001'; await sourceRef().set(input);
    expect((await recordWhatsAppReminderConsent(db, grant(), target)).status).toBe('rejected');
    input.client.phoneE164 = grant().phoneE164; input.client.businessId = 'owner-b'; await sourceRef().set(input);
    expect((await recordWhatsAppReminderConsent(db, grant(), target)).status).toBe('rejected');
    expect((await db.collection('whatsappReminderConsents').get()).empty).toBe(true);
  });
  it('cannot treat an unchecked opt-in as permission', async () => {
    const invalid = { ...grant(), explicitOptIn: false } as unknown as Parameters<typeof recordWhatsAppReminderConsent>[1];
    await expect(recordWhatsAppReminderConsent(db, invalid, target)).rejects.toThrow('Invalid');
    expect((await db.collection('whatsappReminderConsentEvents').get()).empty).toBe(true);
  });
  it('preserves opt-out for the previously consented number after contact changes', async () => {
    await recordWhatsAppReminderConsent(db, grant(), target);
    const input = source(); input.client.phoneE164 = '+5491100000001'; await sourceRef().set(input);
    expect((await recordWhatsAppReminderConsent(db, revoke(), target)).status).toBe('recorded');
    expect(planWhatsAppReminder({ ...source(), consent: await consent() }).eligible).toBe(false);
  });
  it('records revocation even when no grant existed', async () => {
    await recordWhatsAppReminderConsent(db, revoke(), target);
    expect(await consent()).toBeNull();
    expect((await db.collection('whatsappReminderConsents').get()).docs[0].get('revokedAtMs')).toBe(now);
  });
});
