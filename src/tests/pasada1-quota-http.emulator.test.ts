import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn(), delivery: vi.fn(), disable: vi.fn(), revoke: vi.fn(), deleteUser: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify, updateUser: mocks.disable, revokeRefreshTokens: mocks.revoke, deleteUser: mocks.deleteUser }) }));
vi.mock('@/lib/payments/marketplace', () => ({ getSellerConnection: async () => ({ accessToken: 'emulator-only' }), mercadoPagoRequest: async () => ({ results: [] }), marketplaceConfiguration: () => ({}), MARKETPLACE_ORIGIN: 'https://pediturno.test' }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: mocks.delivery }));

import { countActiveAppointmentsInMonth, isBusinessPro } from '@/lib/appointment-quota';
import { localTimeToUtc } from '@/lib/booking-constraints';
import { POST as ownerStatus } from '@/app/api/owner/appointments/[appointmentId]/status/route';
import { expireDepositHolds } from '@/lib/payments/deposits';
import { POST as ownerBooking } from '@/app/api/owner/appointments/route';
import { POST as publicBooking } from '@/app/api/public/bookings/route';
import { GET as bootstrap } from '@/app/api/v1/owner/bootstrap/route';
import { processAndroidAccountDeletion } from '@/lib/android-account-deletion';

let app: App;
let db: Firestore;
const ownerId = 'android-owner-emulator';
const serviceId = 'android-service-emulator';
const zone = 'America/Argentina/Buenos_Aires';

function dateKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(Date.now() + 3 * 86_400_000));
}

async function seed() {
  const date = dateKey();
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  await db.doc(`businesses/${ownerId}`).set({
    name: 'Servicios Android', email: 'owner@example.test', status: 'active', businessType: 'services', membership: { type: 'lifetime' },
    timeZone: zone, slug: 'servicios-android', bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 0, bookingHorizonDays: 30, appointmentBufferMinutes: 0 },
    mercadopago: { accessToken: 'not-exposed' },
  });
  await db.doc(`services/${serviceId}`).set({
    businessId: ownerId, name: 'Consulta', status: 'Activo', duration: '60', price: '1000',
    workingHours: { [weekday]: { slots: [{ start: '09:00', end: '18:00' }] } },
  });
  return date;
}

function ownerRequest(date: string) {
  return new Request('https://pediturno.test/api/owner/appointments', {
    method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json', 'X-Idempotency-Key': 'android-emulator-request-key' },
    body: JSON.stringify({ client: 'Cliente Android', clientPhone: '11111111', clientEmail: 'client@example.test', serviceId, dateKey: date, time: '10:00', status: 'Confirmado' }),
  }) as any;
}

beforeAll(() => {
  if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Loopback emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-pasada1' }, 'pasada1-owner-it');
  db = getFirestore(app);
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  vi.stubEnv('BOOKING_CAPABILITY_OUTBOX_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS', 'true');
  mocks.db.mockReturnValue(db);
  mocks.verify.mockResolvedValue({ uid: ownerId });
  mocks.disable.mockResolvedValue(undefined); mocks.revoke.mockResolvedValue(undefined); mocks.deleteUser.mockResolvedValue(undefined);
});
afterAll(async () => { vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });

describe('Pasada 1: cross-platform Gratis admission', () => {
  it('expires a deposit hold once and releases its monthly consumption', async () => {
    const date = await seed();
    await db.doc(`businesses/${ownerId}`).update({ membership: { type: 'free' } });
    await db.doc('appointments/held').set({ businessId: ownerId, date: Timestamp.fromDate(localTimeToUtc(date, '00:00', zone)), status: 'Pendiente', paymentStatus: 'pending', bookingSlotIds: [] });
    await db.doc('depositOrders/hold').set({ businessId: ownerId, appointmentId: 'held', status: 'pending', expiresAt: Timestamp.fromMillis(Date.now()-1000), outboxId: 'held-mail' });
    await db.doc('bookingEmailOutbox/held-mail').set({ status: 'awaiting_payment' });
    expect((await expireDepositHolds()).expired).toBe(1);
    expect((await expireDepositHolds()).expired).toBe(0);
    expect(await countActiveAppointmentsInMonth(db, ownerId, date.slice(0,7), zone)).toBe(0);
  }, 60000);
  it('serializes public and owner requests for the final monthly slot, then retries without consuming twice', async () => {
    const date = await seed();
    await db.doc(`businesses/${ownerId}`).update({ membership: { type: 'free' } });
    const batch = db.batch();
    for (let i = 0; i < 39; i++) batch.set(db.doc(`appointments/previous-${i}`), {
      businessId: ownerId, serviceId, status: 'Completado', time: '00:00', durationMinutes: 10,
      date: Timestamp.fromDate(localTimeToUtc(`${date.slice(0,7)}-01`, '00:00', zone)),
    });
    await batch.commit();
    expect(isBusinessPro((await db.doc(`businesses/${ownerId}`).get()).data()!)).toBe(false);
    expect(await countActiveAppointmentsInMonth(db, ownerId, date.slice(0,7), zone)).toBe(39);
    const publicRequest = () => new Request('https://pediturno.test/api/public/bookings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId: ownerId, serviceId, dateKey: date, time: '11:00', client: 'Cliente Publico', clientPhone: '22222222', clientEmail: 'public@example.test', idempotencyKey: 'public-last-slot-request' }),
    }) as any;
    const results = await Promise.all([ownerBooking(ownerRequest(date)), publicBooking(publicRequest())]);
    expect(results.map(r => r.status).sort()).toEqual([201,409]);
    const winner = results[0].status === 201 ? 0 : 1;
    const firstBody = await results[winner].json();
    const retry = winner === 0 ? await ownerBooking(ownerRequest(date)) : await publicBooking(publicRequest());
    expect(retry.status).toBe(200);
    expect((await retry.json()).id).toBe(firstBody.id);
    expect((await db.collection('appointments').get()).size).toBe(40);
    const response = await bootstrap(new Request('https://pediturno.test/api/v1/owner/bootstrap', { headers: { authorization: 'Bearer synthetic' } }) as any);
    expect(response.status).toBe(200);
    const membership = (await response.json()).business.membership;
    expect(membership.currentMonthUsage).toBe(membership.currentMonthKey === date.slice(0, 7) ? 40 : 0);
    const cancel = () => ownerStatus(new Request('https://pediturno.test/api/owner/appointments/status', { method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'Cancelado' }) }) as any, { params: Promise.resolve({ appointmentId: firstBody.id }) });
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).status).toBe(200);
    expect(await countActiveAppointmentsInMonth(db, ownerId, date.slice(0,7), zone)).toBe(39);
  }, 60000);
});
