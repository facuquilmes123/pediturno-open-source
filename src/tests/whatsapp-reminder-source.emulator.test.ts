import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { createWhatsAppReminderSourceLoader } from '@/lib/whatsapp-reminder-source';
import { enqueueCurrentWhatsAppReminder } from '@/lib/whatsapp-reminder-outbox';
import { claimWhatsAppReminder } from '@/lib/whatsapp-reminder-worker';
import { recordWhatsAppReminderConsent } from '@/lib/whatsapp-reminder-consent';
import { cancelWhatsAppReminderForOwner, readWhatsAppReminderForOwner } from '@/lib/whatsapp-reminder-owner';

let app: App, db: Firestore;
const now = Date.parse('2026-11-06T15:00:00Z');
const refs = { businessId: 'source-owner-a', appointmentId: 'source-appointment-a', clientId: 'source-client-a' };
const phone = '+5491100000000';
const owner = () => db.doc(`businesses/${refs.businessId}`);
const appointment = () => db.doc(`appointments/${refs.appointmentId}`);
const client = () => db.doc(`clients/${refs.clientId}`);
const settings = () => db.doc(`whatsappReminderSettings/${refs.businessId}`);
const loader = () => createWhatsAppReminderSourceLoader(db, now);
async function current() { return db.runTransaction(tx => loader()(tx, refs)); }
async function target(tx: Transaction) {
  const c = (await tx.get(client())).data();
  return c && c.businessId === refs.businessId ? { businessId: refs.businessId, clientId: refs.clientId, phoneE164: `+${c.phone.replace(/\D/g, '')}` } : null;
}
async function consent(decision: 'grant' | 'revoke', at = now - 1000, actionId = decision) {
  const base = { businessId: refs.businessId, clientId: refs.clientId, phoneE164: phone, origin: 'client_preferences' as const, actionId, nowMs: at };
  return recordWhatsAppReminderConsent(db, decision === 'grant' ? { ...base, decision, explicitOptIn: true, textVersion: 'qa-v1' } : { ...base, decision }, target);
}
async function enqueue() { return enqueueCurrentWhatsAppReminder(db, refs, now, loader()); }
async function queued() {
  const result = await enqueue();
  if (result.status !== 'enqueued') throw Error('Expected queue');
  return { businessId: refs.businessId, deliveryKey: result.deliveryKey, nowMs: now };
}
beforeAll(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-whatsapp-source' }, 'whatsapp-source-it'); db = getFirestore(app);
});
beforeEach(async () => {
  for (const name of ['businesses', 'appointments', 'clients', 'whatsappReminderSettings', 'whatsappReminderConsents', 'whatsappReminderConsentEvents', 'whatsappReminderOutbox']) await db.recursiveDelete(db.collection(name));
  await owner().set({ status: 'active', businessType: 'services', timeZone: 'America/Argentina/Buenos_Aires', bookingSettings: { remindersEnabled: true } });
  await appointment().set({ businessId: refs.businessId, clientId: refs.clientId, date: Timestamp.fromDate(new Date('2026-11-06T03:00:00Z')), time: '13:00',
    occupiedStartAt: Timestamp.fromDate(new Date('2026-11-06T15:30:00Z')), status: 'Confirmado', clientPhone: '+5491199999999', client: 'Synthetic person' });
  await client().set({ businessId: refs.businessId, phone: phone.slice(1), name: 'Synthetic person' });
  await settings().set({ schemaVersion: 1, businessId: refs.businessId, enabled: true, leadMinutes: 120,
    sender: { businessId: refs.businessId, phoneNumberId: '123456', active: true },
    template: { businessId: refs.businessId, name: 'qa_appointment_reminder', language: 'es_AR', category: 'UTILITY', status: 'APPROVED', revision: 'qa-v1' } });
  await consent('grant');
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });

describe('authoritative WhatsApp source adapter and atomic enqueue', () => {
  it('uses the real calendar occurrence and consented current contact, never occupiedStartAt or booking contact', async () => {
    const source = await current();
    expect(source?.appointment.startsAtMs).toBe(Date.parse('2026-11-06T16:00:00Z'));
    expect(source?.appointment.reminderDueAtMs).toBe(Date.parse('2026-11-06T14:00:00Z'));
    expect(source?.client.phoneE164).toBe(phone);
    const options = await queued();
    const job = (await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).data()!;
    expect(JSON.stringify(job)).not.toContain(phone);
    expect(JSON.stringify(job)).not.toContain('Synthetic person');
    expect(job).not.toHaveProperty('clientPhone');
  });
  it('resolves the business timezone rather than the host timezone', async () => {
    await owner().update({ timeZone: 'America/New_York' });
    await appointment().update({ date: Timestamp.fromDate(new Date('2026-11-06T05:00:00Z')), time: '11:00' });
    expect((await current())?.appointment.startsAtMs).toBe(Date.parse('2026-11-06T16:00:00Z'));
  });
  it('creates one job when multiple transactional enqueuers race', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => enqueue()));
    expect(results.filter(r => r.status === 'enqueued')).toHaveLength(1);
    expect(results.filter(r => r.status === 'duplicate')).toHaveLength(3);
    expect((await db.collection('whatsappReminderOutbox').get()).size).toBe(1);
  });
  it('retries a creation conflict by re-reading the full transaction', async () => {
    const spy = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(Object.assign(new Error('Synthetic create conflict'), { code: 6 }));
    try { expect((await enqueue()).status).toBe('enqueued'); expect(spy).toHaveBeenCalledTimes(2); }
    finally { spy.mockRestore(); }
  });
  it('propagates unrelated transaction failures without claiming success or retrying them', async () => {
    const spy = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(Object.assign(new Error('Synthetic permission denial'), { code: 7 }));
    try { await expect(enqueue()).rejects.toThrow('Synthetic permission denial'); expect(spy).toHaveBeenCalledTimes(1); }
    finally { spy.mockRestore(); }
  });
  it.each(['missing_settings', 'disabled', 'wrong_settings_owner', 'bad_schema', 'bad_lead', 'non_services', 'blocked', 'deleting'])(
    'fails closed for %s without creating a job', async change => {
      if (change === 'missing_settings') await settings().delete();
      if (change === 'disabled') await settings().update({ enabled: false });
      if (change === 'wrong_settings_owner') await settings().update({ businessId: 'source-owner-b' });
      if (change === 'bad_schema') await settings().update({ schemaVersion: 2 });
      if (change === 'bad_lead') await settings().update({ leadMinutes: '120' });
      if (change === 'non_services') await owner().update({ businessType: 'spaces' });
      if (change === 'blocked' || change === 'deleting') await owner().update({ status: change });
      expect((await enqueue()).status).toBe('rejected');
      expect((await db.collection('whatsappReminderOutbox').get()).empty).toBe(true);
    });
  it.each(['appointment_owner', 'client_owner', 'client_reassigned', 'invalid_zone', 'invalid_clock', 'invalid_phone', 'local_phone'])(
    'rejects incompatible current records: %s', async change => {
      if (change === 'appointment_owner') await appointment().update({ businessId: 'source-owner-b' });
      if (change === 'client_owner') await client().update({ businessId: 'source-owner-b' });
      if (change === 'client_reassigned') await appointment().update({ clientId: 'another-client' });
      if (change === 'invalid_zone') await owner().update({ timeZone: 'Invalid/Timezone' });
      if (change === 'invalid_clock') await appointment().update({ time: '25:00' });
      if (change === 'invalid_phone') await client().update({ phone: `abc${phone}` });
      if (change === 'local_phone') await client().update({ phone: '1100000000' });
      expect((await enqueue()).status).toBe('rejected');
    });
  it.each(['changed_phone', 'revoked', 'reassigned', 'rescheduled', 'cancelled', 'payment_review'])(
    'real worker revalidates current records before a claim: %s', async change => {
      const options = await queued();
      if (change === 'changed_phone') await client().update({ phone: '+5491100000001' });
      if (change === 'revoked') await consent('revoke', now);
      if (change === 'reassigned') await appointment().update({ clientId: 'another-client' });
      if (change === 'rescheduled') await appointment().update({ time: '14:00' });
      if (change === 'cancelled') await appointment().update({ status: 'Cancelado' });
      if (change === 'payment_review') await appointment().update({ paymentStatus: 'paid', paymentReviewRequired: true });
      expect((await claimWhatsAppReminder(db, options, loader())).status).toBe('cancelled');
      expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('attempts')).toBe(0);
    });
  it('overrides the loader clock and rejects a record no longer in the future', async () => {
    const result = await enqueueCurrentWhatsAppReminder(db, refs, now + 7200000, loader());
    expect(result).toEqual({ status: 'rejected', reason: 'appointment_ineligible' });
  });
  it('checks requested identity even when an injected loader returns another appointment', async () => {
    const original = await current();
    const result = await enqueueCurrentWhatsAppReminder(db, refs, now, async () => ({ ...original!, appointment: { ...original!.appointment, id: 'other-appointment' } }));
    expect(result.status).toBe('rejected');
  });
  it('rejects path traversal and invalid clocks before reading records', async () => {
    await expect(enqueueCurrentWhatsAppReminder(db, { ...refs, businessId: 'bad/id' }, now, loader())).rejects.toThrow();
    expect(() => createWhatsAppReminderSourceLoader(db, NaN)).toThrow();
    await expect(db.runTransaction(tx => loader()(tx, { ...refs, clientId: '../client' }))).rejects.toThrow();
  });
  it('never allows the worker to claim a job after a concurrent consent withdrawal', async () => {
    await Promise.all([enqueue(), consent('revoke', now + 1)]);
    const jobs = await db.collection('whatsappReminderOutbox').get();
    for (const job of jobs.docs) expect((await claimWhatsAppReminder(db, { businessId: refs.businessId, deliveryKey: job.id, nowMs: now + 2 }, createWhatsAppReminderSourceLoader(db, now + 2))).status).toBe('cancelled');
  });
});

describe('owner control without dispatch or contact disclosure', () => {
  it('exposes only the owner DTO and hides missing/foreign jobs equally', async () => {
    const options = await queued();
    await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).update({ providerMessageId: 'private-message-id', leaseToken: 'private-lease', phoneE164: phone });
    const view = await readWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey);
    expect(view).toMatchObject({ status: 'pending', attempts: 0, canCancel: true });
    expect(JSON.stringify(view)).not.toMatch(/private-message-id|private-lease|5491100000000/);
    expect(await readWhatsAppReminderForOwner(db, 'source-owner-b', options.deliveryKey)).toBeNull();
    expect(await readWhatsAppReminderForOwner(db, refs.businessId, '0'.repeat(64))).toBeNull();
    expect((await cancelWhatsAppReminderForOwner(db, 'source-owner-b', options.deliveryKey, now)).status).toBe('not_found');
  });
  it('cancels pending work idempotently and prevents a subsequent claim', async () => {
    const options = await queued();
    expect((await cancelWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey, now)).status).toBe('cancelled');
    expect((await cancelWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey, now + 1)).status).toBe('already_cancelled');
    expect((await claimWhatsAppReminder(db, options, loader())).status).toBe('ignored');
    expect((await readWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey))?.canCancel).toBe(false);
  });
  it.each(['claimed', 'uncertain', 'sent', 'delivered', 'read', 'failed'])(
    'does not falsely report cancellation of %s work', async status => {
      const options = await queued();
      await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).update({ status });
      expect((await cancelWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey, now)).status).toBe('not_cancellable');
      expect((await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).get()).get('status')).toBe(status);
    });
  it('serializes a cancellation/claim race without claiming that submitted work was stopped', async () => {
    const options = await queued();
    const [cancel, claim] = await Promise.all([cancelWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey, now), claimWhatsAppReminder(db, options, loader())]);
    if (cancel.status === 'cancelled') expect(claim.status).toBe('ignored');
    else { expect(cancel.status).toBe('not_cancellable'); expect(claim.status).toBe('claimed'); }
  });
  it('rejects malformed owned records and backdated cancellation', async () => {
    const options = await queued();
    await expect(cancelWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey, now - 1)).rejects.toThrow();
    await db.doc(`whatsappReminderOutbox/${options.deliveryKey}`).update({ clientId: { sensitive: 'not-a-reference' } });
    await expect(readWhatsAppReminderForOwner(db, refs.businessId, options.deliveryKey)).rejects.toThrow();
  });
});
