import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ db: vi.fn(), reminder: vi.fn(), confirmation: vi.fn(), owner: vi.fn(), push: vi.fn(), newPush: vi.fn() }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'owner' }) }) }));
vi.mock('@/services/email', () => ({ sendReminderEmail: mocks.reminder, sendConfirmationEmail: mocks.confirmation, sendNewAppointmentNotificationEmail: mocks.owner }));
vi.mock('@/services/push', () => ({ sendNewBookingPushNotification: mocks.newPush, sendPushNotification: mocks.push }));
import { runReminderBatch } from '@/lib/reminders';
import { POST as notifyOwner } from '@/app/api/owner/appointments/notify/route';
import { createBookingConfirmationOutbox, deliverBookingOutbox } from '@/lib/booking-outbox';
import { createBookingCapability } from '@/lib/booking-capability';

let db: Firestore; let app: App;
const now = new Date('2026-10-04T15:00:00Z');
const date = Timestamp.fromDate(new Date('2026-10-05T03:00:00Z'));
const originalKey = process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  app = initializeApp({ projectId: 'pediturno-mail-it' }, 'mail-it'); db = getFirestore(app);
  process.env.BOOKING_CAPABILITY_OUTBOX_KEY = Buffer.alloc(32, 7).toString('base64');
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  mocks.db.mockReturnValue(db); mocks.reminder.mockResolvedValue({ success: true });
  mocks.push.mockResolvedValue({ attempted: 1, delivered: 1 });
  mocks.newPush.mockResolvedValue({ attempted: 0, delivered: 0 });
  mocks.confirmation.mockResolvedValue({ success: true }); mocks.owner.mockResolvedValue({ success: true });
  await db.doc('businesses/owner').set({ status: 'active', membership: { type: 'lifetime' }, name: 'Prueba', slug: 'prueba', bookingSettings: { remindersEnabled: true, newAppointmentNotificationsEnabled: true, notificationEmail: 'owner@example.invalid' } });
});
afterAll(async () => { await db.terminate(); await deleteApp(app); if (originalKey === undefined) delete process.env.BOOKING_CAPABILITY_OUTBOX_KEY; else process.env.BOOKING_CAPABILITY_OUTBOX_KEY = originalKey; });
const appointment = () => ({ businessId: 'owner', status: 'Confirmado', client: 'Prueba', clientEmail: 'client@example.invalid', time: '12:00', date });

describe('production notification reliability', () => {
  it('deduplicates upcoming push per scheduled occurrence independently of email reminders', async () => {
    await db.doc('businesses/owner').update({ 'bookingSettings.remindersEnabled': false });
    await db.doc('appointments/soon').set({ ...appointment(), date: Timestamp.fromDate(new Date('2026-10-04T03:00:00Z')), time: '12:20', clientEmail: '' });
    expect((await runReminderBatch(db, now.getTime())).pushesSent).toBe(1);
    expect((await runReminderBatch(db, now.getTime())).pushesSent).toBe(0);
    await db.doc('appointments/soon').update({ time: '12:25' });
    expect((await runReminderBatch(db, now.getTime())).pushesSent).toBe(1);
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.reminder).not.toHaveBeenCalled();
  });
  it('resumes beyond 500 records instead of disabling all reminders', async () => {
    const writer = db.bulkWriter();
    for (let i = 0; i < 501; i++) writer.set(db.doc(`appointments/a${String(i).padStart(3, '0')}`), { ...appointment(), clientEmail: '' });
    writer.set(db.doc('appointments/z_last'), appointment()); await writer.close();
    const first = await runReminderBatch(db, now.getTime());
    expect(first.processed).toBe(500); expect(first.failed).toBe(0);
    const next = await runReminderBatch(db, now.getTime());
    expect(next.processed).toBe(2); expect(next.sent).toBe(1); expect(mocks.reminder).toHaveBeenCalledTimes(1);
  }, 30000);
  it('deduplicates the same occurrence and sends again after rescheduling', async () => {
    await db.doc('appointments/booking').set(appointment());
    expect((await runReminderBatch(db, now.getTime())).sent).toBe(1);
    expect((await runReminderBatch(db, now.getTime())).sent).toBe(0);
    await db.doc('appointments/booking').update({ date: Timestamp.fromDate(new Date('2026-10-06T03:00:00Z')) });
    expect((await runReminderBatch(db, now.getTime() + 86400000)).sent).toBe(1);
  });
  it('does not retry a reminder after its attempt budget is exhausted', async () => {
    await db.doc('appointments/booking').set(appointment());
    const occurrence = new Date('2026-10-05T15:00:00Z').getTime();
    const id = createHash('sha256').update(`booking:${occurrence}`).digest('hex');
    await db.doc(`reminderDeliveries/${id}`).set({ attempts: 5, status: 'failed' });
    expect((await runReminderBatch(db, now.getTime())).sent).toBe(0);
    expect(mocks.reminder).not.toHaveBeenCalled();
  });
  it('cancels queued notifications for a business being deleted', async () => {
    const cap = createBookingCapability({ appointmentId: 'booking', businessId: 'owner', now });
    await db.doc(`bookingCapabilities/${cap.tokenHash}`).set(cap.capability);
    await db.doc('appointments/booking').set(appointment());
    await db.doc('businesses/owner').update({ status: 'deleting' });
    await db.doc('bookingEmailOutbox/mail').set(createBookingConfirmationOutbox({ appointmentId: 'booking', businessId: 'owner', token: cap.token, capabilityExpiresAt: cap.capability.expiresAt, now, notifyBusiness: true }));
    expect(await deliverBookingOutbox('mail', now)).toBe('skipped');
    expect(mocks.confirmation).not.toHaveBeenCalled(); expect(mocks.owner).not.toHaveBeenCalled();
    expect((await db.doc('bookingEmailOutbox/mail').get()).get('encryptedToken')).toBeUndefined();
  });
  it('does not send confirmations after cancellation or capability replacement', async () => {
    const cap = createBookingCapability({ appointmentId: 'booking', businessId: 'owner', now });
    await db.doc(`bookingCapabilities/${cap.tokenHash}`).set(cap.capability);
    await db.doc('appointments/booking').set({ ...appointment(), status: 'Cancelado' });
    await db.doc('bookingEmailOutbox/mail').set(createBookingConfirmationOutbox({ appointmentId: 'booking', businessId: 'owner', token: cap.token, capabilityExpiresAt: cap.capability.expiresAt, now }));
    expect(await deliverBookingOutbox('mail', now)).toBe('skipped'); expect(mocks.confirmation).not.toHaveBeenCalled();
    expect((await db.doc('bookingEmailOutbox/mail').get()).get('encryptedToken')).toBeUndefined();
    await db.doc('appointments/booking').update({ status: 'Confirmado' });
    await db.doc(`bookingCapabilities/${cap.tokenHash}`).update({ usedAt: Timestamp.fromDate(now) });
    await db.doc('bookingEmailOutbox/mail2').set(createBookingConfirmationOutbox({ appointmentId: 'booking', businessId: 'owner', token: cap.token, capabilityExpiresAt: cap.capability.expiresAt, now }));
    expect(await deliverBookingOutbox('mail2', now)).toBe('skipped'); expect(mocks.confirmation).not.toHaveBeenCalled();
  });
  it('permits a new manual notification after rescheduling and deduplicates the same occurrence', async () => {
    const futureDate = Timestamp.fromMillis(Date.now() + 3 * 86400000);
    await db.doc('appointments/booking').set({ ...appointment(), date: futureDate });
    const req = () => new Request('https://pediturno.test/api/owner/appointments/notify', { method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ appointmentId: 'booking', kind: 'reminder' }) }) as never;
    expect((await notifyOwner(req())).status).toBe(200);
    expect((await notifyOwner(req())).status).toBe(200);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
    await db.doc('appointments/booking').update({ time: '15:00' });
    expect((await notifyOwner(req())).status).toBe(200);
    expect(mocks.reminder).toHaveBeenCalledTimes(2);
  });
  it('retries the business notice without duplicating an accepted client email', async () => {
    const cap = createBookingCapability({ appointmentId: 'booking', businessId: 'owner', now });
    await db.doc(`bookingCapabilities/${cap.tokenHash}`).set(cap.capability);
    await db.doc('appointments/booking').set(appointment());
    await db.doc('bookingEmailOutbox/mail').set(createBookingConfirmationOutbox({ appointmentId: 'booking', businessId: 'owner', token: cap.token, capabilityExpiresAt: cap.capability.expiresAt, now, notifyBusiness: true }));
    mocks.owner.mockResolvedValueOnce({ success: false });
    expect(await deliverBookingOutbox('mail', now)).toBe('retry');
    expect(await deliverBookingOutbox('mail', new Date(now.getTime() + 6 * 60000))).toBe('sent');
    expect(mocks.confirmation).toHaveBeenCalledTimes(1); expect(mocks.owner).toHaveBeenCalledTimes(2);
  });
});
