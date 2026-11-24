import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn(), delivery: vi.fn(), disable: vi.fn(), revoke: vi.fn(), deleteUser: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify, updateUser: mocks.disable, revokeRefreshTokens: mocks.revoke, deleteUser: mocks.deleteUser }) }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ getFiles: async () => [[], null] }) }) }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: mocks.delivery }));

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
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  app = initializeApp({ projectId: 'pediturno-android-owner-it' }, 'android-owner-it');
  db = getFirestore(app);
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'demo-pediturno-audit.appspot.com');
  vi.stubEnv('BOOKING_CAPABILITY_OUTBOX_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS', 'true');
  mocks.db.mockReturnValue(db);
  mocks.verify.mockResolvedValue({ uid: ownerId });
  mocks.disable.mockResolvedValue(undefined); mocks.revoke.mockResolvedValue(undefined); mocks.deleteUser.mockResolvedValue(undefined);
});
afterAll(async () => { vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });

describe('Android owner booking integration', () => {
  it('accepts an empty optional email without delivery work and remains idempotent', async () => {
    const date = await seed();
    const existingClientId = createHash('sha256').update(`${ownerId}\0client\0${'11111111'}`).digest('hex');
    await db.doc(`clients/${existingClientId}`).set({ businessId: ownerId, name: 'Cliente Android', phone: '11111111', email: 'retained@example.test' });
    const withoutEmail = () => new Request('https://pediturno.test/api/owner/appointments', {
      method: 'POST', headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json', 'X-Idempotency-Key': 'android-empty-email-request-key' },
      body: JSON.stringify({ client: 'Cliente Android', clientPhone: '11111111', clientEmail: '', serviceId, dateKey: date, time: '10:00', status: 'Confirmado' }),
    }) as any;
    const first = await ownerBooking(withoutEmail());
    expect(first.status).toBe(201);
    const retry = await ownerBooking(withoutEmail());
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect((await db.collection('appointments').get()).size).toBe(1);
    expect((await db.collection('appointments').get()).docs[0].get('clientEmail')).toBe('');
    expect((await db.collection('ownerAppointmentRequests').get()).size).toBe(1);
    expect((await db.collection('bookingEmailOutbox').get()).empty).toBe(true);
    expect((await db.collection('bookingCapabilities').get()).empty).toBe(true);
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect((await db.doc(`clients/${existingClientId}`).get()).get('email')).toBe('retained@example.test');
  });

  it('persists one owner booking on retry and blocks the same public slot', async () => {
    const date = await seed();
    const first = await ownerBooking(ownerRequest(date));
    const retry = await ownerBooking(ownerRequest(date));
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    const initial = await first.json();
    expect(await retry.json()).toEqual(initial);
    expect((await db.collection('appointments').get()).size).toBe(1);
    expect((await db.collection('ownerAppointmentRequests').get()).size).toBe(1);
    expect((await db.collection('bookingEmailOutbox').get()).size).toBe(1);

    const publicAttempt = await publicBooking(new Request('https://pediturno.test/api/public/bookings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId: ownerId, serviceId, dateKey: date, time: '10:00', client: 'Cliente Público', clientPhone: '22222222', clientEmail: 'public@example.test', idempotencyKey: 'public-emulator-request-key' }),
    }) as any);
    expect(publicAttempt.status).toBe(409);
  });

  it('returns a safe bootstrap projection from the persisted owner profile', async () => {
    await seed();
    const response = await bootstrap(new Request('https://pediturno.test/api/v1/owner/bootstrap', { headers: { authorization: 'Bearer synthetic' } }) as any);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.business.name).toBe('Servicios Android');
    expect(result.services).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('not-exposed');
  });

  it('purges operational records and leaves a deleted tombstone when no financial history exists', async () => {
    await seed();
    const requestId = randomUUID();
    await db.doc(`businesses/${ownerId}`).update({ status: 'deletion_requested', deletionRequestId: requestId });
    await db.doc(`accountDeletionRequests/${ownerId}`).set({ ownerId, requestId, source: 'android', requestedAt: new Date(), status: 'deletion_requested' });
    await db.doc(`clients/client-one`).set({ businessId: ownerId, name: 'Privacy' });
    const result = await processAndroidAccountDeletion(ownerId);
    expect(result.status).toBe('deleted');
    expect((await db.doc(`businesses/${ownerId}`).get()).get('status')).toBe('deleted');
    expect((await db.collection('clients').where('businessId', '==', ownerId).get()).empty).toBe(true);
    expect((await db.doc(`businessDeletions/${ownerId}`).get()).get('status')).toBe('deleted');
    expect(mocks.disable).toHaveBeenCalledWith(ownerId, { disabled: true });
  });

  it('keeps a closed account in financial review without deleting ledger evidence', async () => {
    await seed();
    const requestId = randomUUID();
    await db.doc(`businesses/${ownerId}`).update({ status: 'deletion_requested', deletionRequestId: requestId });
    await db.doc(`accountDeletionRequests/${ownerId}`).set({ ownerId, requestId, source: 'android', requestedAt: new Date(), status: 'deletion_requested' });
    await db.doc('depositOrders/financial-one').set({ businessId: ownerId, status: 'paid' });
    const result = await processAndroidAccountDeletion(ownerId);
    expect(result.status).toBe('financial_review_required');
    expect((await db.doc('depositOrders/financial-one').get()).exists).toBe(true);
    expect((await db.doc(`businesses/${ownerId}`).get()).get('status')).toBe('deletion_requested');
  });
  it.each(['owner','public'])('does not reuse a foreign preclaimed client id during %s booking', async (mode) => {
    const date=await seed();const claimedId=createHash('sha256').update(`${ownerId}\0client\0${'11111111'}`).digest('hex');
    await db.doc(`clients/${claimedId}`).set({businessId:'neighbor',name:'Neighbor untouched',phone:'11111111'});
    const request=mode==='owner' ? ownerRequest(date) : new Request('https://pediturno.test/api/public/bookings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({businessId:ownerId,serviceId,dateKey:date,time:'10:00',client:'Cliente QA',clientPhone:'11111111',clientEmail:'qa@example.test',idempotencyKey:randomUUID()})}) as any;
    const response=await (mode==='owner'?ownerBooking(request):publicBooking(request));expect(response.status).toBe(201);
    expect((await db.doc(`clients/${claimedId}`).get()).get('name')).toBe('Neighbor untouched');
    const {id}=await response.json();const booked=(await db.doc(`appointments/${id}`).get()).data()!;expect(booked.clientId).not.toBe(claimedId);expect((await db.doc(`clients/${booked.clientId}`).get()).get('businessId')).toBe(ownerId);
  });
  it.each(['owner', 'public'])('rejects ambiguous legacy clients during %s booking without altering them', async (mode) => {
    const date = await seed();
    await db.doc('clients/legacy-duplicate-a').set({ businessId: ownerId, name: 'Legacy A', phone: '11111111', email: 'a@example.test' });
    await db.doc('clients/legacy-duplicate-b').set({ businessId: ownerId, name: 'Legacy B', phone: '11111111', email: 'b@example.test' });
    const request = mode === 'owner' ? ownerRequest(date) : new Request('https://pediturno.test/api/public/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessId: ownerId, serviceId, dateKey: date, time: '10:00', client: 'Cliente QA', clientPhone: '11111111', clientEmail: 'qa@example.test', idempotencyKey: randomUUID() }) }) as any;
    const response = await (mode === 'owner' ? ownerBooking(request) : publicBooking(request));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Hay clientes duplicados con ese teléfono. Revisá el directorio antes de reservar.' });
    expect((await db.collection('appointments').where('businessId', '==', ownerId).get()).empty).toBe(true);
    expect((await db.doc('clients/legacy-duplicate-a').get()).data()).toMatchObject({ name: 'Legacy A', phone: '11111111', email: 'a@example.test' });
    expect((await db.doc('clients/legacy-duplicate-b').get()).data()).toMatchObject({ name: 'Legacy B', phone: '11111111', email: 'b@example.test' });
  });

});
