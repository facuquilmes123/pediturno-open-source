import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { decryptCapabilityToken } from '@/lib/booking-capability';
import { bookingSlotIds } from '@/lib/booking-slots';
import { localTimeToUtc } from '@/lib/booking-constraints';

const { getAdminFirestore, initializeAdminApp, verifyIdToken } = vi.hoisted(() => ({ getAdminFirestore: vi.fn(), initializeAdminApp: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore, initializeAdminApp }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));

import { POST as book } from '@/app/api/public/bookings/route';
import { POST as ownerBook } from '@/app/api/owner/appointments/route';
import { POST as actOnAppointment } from '@/app/api/public/appointments/action/route';

const PROJECT_ID = `demo-pediturno-bookings-${randomUUID().slice(0, 8)}`;
const zone = 'America/Argentina/Buenos_Aires';
let db: Firestore;
let suffix = 0;
const originalAppCheckBypass = process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;

function dateKeyInBuenosAires(daysAhead = 3): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

function body(businessId: string, serviceId: string, overrides: Record<string, unknown> = {}) {
  return {
    businessId,
    serviceId,
    dateKey: dateKeyInBuenosAires(),
    time: '10:00',
    client: 'Cliente de prueba',
    clientPhone: '11111111',
    clientEmail: 'client@example.test',
    idempotencyKey: `request-key-${businessId}-123456`,
    ...overrides,
  };
}

function spaceBody(businessId: string, spaceId: string, overrides: Record<string, unknown> = {}) {
  return {
    businessId, spaceId, durationMinutes: 240,
    dateKey: dateKeyInBuenosAires(), time: '10:00',
    client: 'Cliente de espacio', clientPhone: '11112222', clientEmail: 'space@example.test',
    idempotencyKey: `space-key-${businessId}-123456`, ...overrides,
  };
}

function request(payload: Record<string, unknown>) {
  return new Request('https://pediturno.test/api/public/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as never;
}

function ownerRequest(payload: Record<string, unknown>) {
  return new Request('https://pediturno.test/api/owner/appointments', {
    method: 'POST',
    headers: { authorization: 'Bearer owner-fixture', 'content-type': 'application/json', 'X-Idempotency-Key': `owner-${payload.businessId}-request-key` },
    body: JSON.stringify({
      client: payload.client,
      clientPhone: payload.clientPhone,
      clientEmail: payload.clientEmail,
      serviceId: payload.serviceId,
      dateKey: payload.dateKey,
      time: payload.time,
      status: 'Confirmado',
    }),
  }) as never;
}

function actionRequest(payload: Record<string, unknown>) {
  return new Request('https://pediturno.test/api/public/appointments/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }) as never;
}

async function seed(overrides: { membership?: unknown; serviceStatus?: string } = {}) {
  suffix += 1;
  const businessId = `business_it_${suffix}`;
  const serviceId = `service_it_${suffix}`;
  const dateKey = dateKeyInBuenosAires();
  await db.collection('businesses').doc(businessId).set({
    name: 'Negocio de prueba', slug: `negocio-it-${suffix}`, status: 'active',
    membership: overrides.membership ?? { type: 'lifetime' },
    bookingSettings: { bookingLeadTimeHours: 0, bookingHorizonDays: 30, appointmentBufferMinutes: 0, autoConfirm: true },
    timeZone: zone,
  });
  await db.collection('services').doc(serviceId).set({
    businessId, name: 'Servicio de prueba', status: overrides.serviceStatus ?? 'Activo', duration: '60',
    workingHours: { [weekday(dateKey)]: { slots: [{ start: '09:00', end: '18:00' }] } },
  });
  return { businessId, serviceId };
}

async function seedSpace() {
  suffix += 1;
  const businessId = `space_business_it_${suffix}`;
  const spaceId = `space_it_${suffix}`;
  const dateKey = dateKeyInBuenosAires();
  await db.collection('businesses').doc(businessId).set({
    name: 'Espacio de prueba', slug: `espacio-it-${suffix}`, status: 'active', businessType: 'spaces', membership: { type: 'lifetime' },
    bookingSettings: { bookingLeadTimeHours: 0, bookingHorizonDays: 30, appointmentBufferMinutes: 15, autoConfirm: true }, timeZone: zone,
  });
  await db.collection('spaces').doc(spaceId).set({
    businessId, name: 'Salón de prueba', category: 'salon', status: 'Activo', preparationMinutes: 60, cleanupMinutes: 120, bookingBufferMinutes: 30,
    packages: [{ durationMinutes: 240, price: '50000' }, { durationMinutes: 480, price: '85000' }],
    workingHours: { [weekday(dateKey)]: { slots: [{ start: '00:00', end: '00:00' }] } },
  });
  return { businessId, spaceId };
}

async function count(collection: string, businessId: string) {
  const snapshot = await db.collection(collection).where('businessId', '==', businessId).get();
  return snapshot.size;
}

async function bookingToken(businessId: string): Promise<string> {
  const outbox = await db.collection('bookingEmailOutbox').where('businessId', '==', businessId).limit(1).get();
  expect(outbox.size).toBe(1);
  return decryptCapabilityToken(outbox.docs[0].get('encryptedToken'));
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run this suite through firebase emulators:exec; it must never target production.');
  }
  process.env.BOOKING_CAPABILITY_OUTBOX_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = 'true';
  const app = getApps().find((candidate) => candidate.name === 'public-bookings-integration')
    ?? initializeApp({ projectId: PROJECT_ID }, 'public-bookings-integration');
  db = getFirestore(app);
  getAdminFirestore.mockReturnValue(db);
});

beforeEach(() => {
  getAdminFirestore.mockReturnValue(db);
  verifyIdToken.mockResolvedValue({ uid: 'owner-placeholder' });
});

afterAll(async () => {
  if (originalAppCheckBypass === undefined) delete process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;
  else process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = originalAppCheckBypass;
  await Promise.all(getApps().filter((app) => app.name === 'public-bookings-integration').map((app) => app.delete()));
});

describe('public booking route against Firestore Emulator', () => {
  it('keeps Servicios bookable without starting a payment when old settings request a deposit', async () => {
    const { businessId, serviceId } = await seed();
    await db.collection('businesses').doc(businessId).update({ businessType: 'services', mercadopago: { requireDeposit: true, depositType: 'fixed', depositValue: 900 } });
    const result = await book(request(body(businessId, serviceId)));
    expect(result.status).toBe(201);
    const appointments = await db.collection('appointments').where('businessId', '==', businessId).get();
    expect(appointments.size).toBe(1);
    expect(appointments.docs[0].get('status')).toBe('Confirmado');
    expect(appointments.docs[0].get('paymentStatus')).toBeUndefined();
    expect(appointments.docs[0].get('depositOrderId')).toBeUndefined();
    await expect(count('depositOrders', businessId)).resolves.toBe(0);
    expect((await db.collection('businesses').doc(businessId).get()).get('mercadopago.requireDeposit')).toBe(true);
  });
  it('serializes competing owner and public bookings into one appointment graph', async () => {
    const { businessId, serviceId } = await seed();
    verifyIdToken.mockResolvedValue({ uid: businessId });
    const publicPayload = body(businessId, serviceId, {
      client: 'Cliente público', clientPhone: '11111111', clientEmail: 'public@example.test',
      idempotencyKey: `public-owner-race-${businessId}-123456`,
    });
    const ownerPayload = { ...publicPayload, client: 'Cliente dueño', clientPhone: '22222222', clientEmail: 'owner@example.test' };

    const [publicResponse, ownerResponse] = await Promise.all([
      book(request(publicPayload)),
      ownerBook(ownerRequest(ownerPayload)),
    ]);

    expect([publicResponse.status, ownerResponse.status].sort()).toEqual([201, 409]);
    await expect(count('appointments', businessId)).resolves.toBe(1);
    await expect(count('bookingSlots', businessId)).resolves.toBeGreaterThan(0);
    await expect(count('bookingCapabilities', businessId)).resolves.toBe(1);
    await expect(count('bookingEmailOutbox', businessId)).resolves.toBe(1);
    await expect(count('clients', businessId)).resolves.toBe(1);
    const [publicRequests, ownerRequests, rateLimits, monthlyUsage] = await Promise.all([
      count('bookingRequests', businessId), db.collection('ownerAppointmentRequests').where('ownerId', '==', businessId).get().then(snapshot => snapshot.size),
      count('bookingRateLimits', businessId),
      db.collection('businesses').doc(businessId).collection('monthlyUsage').get(),
    ]);
    expect(publicRequests + ownerRequests).toBe(1);
    expect(rateLimits === 0 || rateLimits === 3).toBe(true);
    expect(monthlyUsage.size).toBe(0); // Lifetime fixture is not subject to the Free quota ledger.
  });

  it('locks space setup, package and cleanup atomically and preserves the package price snapshot', async () => {
    const { businessId, spaceId } = await seedSpace();
    const first = spaceBody(businessId, spaceId, { time: '10:00', idempotencyKey: `space-first-${businessId}-123456` });
    const overlappingSetup = spaceBody(businessId, spaceId, { time: '14:00', idempotencyKey: `space-overlap-${businessId}-123456` });
    const [created, collision] = await Promise.all([book(request(first)), book(request(overlappingSetup))]);
    expect([created.status, collision.status].sort()).toEqual([201, 409]);
    const appointments = await db.collection('appointments').where('businessId', '==', businessId).get();
    expect(appointments.size).toBe(1);
    const appointment = appointments.docs[0].data();
    expect(appointment).toMatchObject({ spaceId, durationMinutes: 240, priceAtBooking: 50000, preparationMinutesAtBooking: 60, cleanupMinutesAtBooking: 120, bookingBufferMinutesAtBooking: 30 });
    expect(Array.isArray(appointment.bookingSlotIds)).toBe(true);
    expect(appointment.bookingSlotIds).toHaveLength(45); // 60m prep + 4h + 2h cleanup + 30m gap, 10-minute locks
    expect((await book(request(spaceBody(businessId, spaceId, { durationMinutes: 720, idempotencyKey: `space-invalid-${businessId}-123456` })))).status).toBe(400);
  });
  it('books independent courts concurrently but rejects the wrong business mode', async () => {
    const { businessId, serviceId } = await seed();
    const source = (await db.collection('services').doc(serviceId).get()).data()!;
    await db.collection('canchas').doc(`court_${businessId}`).set({ ...source, duration: 60 });
    await db.collection('canchas').doc(`court2_${businessId}`).set({ ...source, name: 'Otra cancha', duration: 60 });
    const first = body(businessId, serviceId, { serviceId: undefined, canchaId: `court_${businessId}` });
    expect((await book(request(first))).status).toBe(404);
    await db.collection('businesses').doc(businessId).update({ businessType: 'sports_facility' });
    const responses = await Promise.all([
      book(request(first)),
      book(request({ ...first, canchaId: `court2_${businessId}`, idempotencyKey: `other-${businessId}-12345` })),
    ]);
    expect(responses.map(result => result.status)).toEqual([201, 201]);
    expect((await book(request(body(businessId, serviceId)))).status).toBe(404);
    expect((await book(request({ ...first, idempotencyKey: `collision-${businessId}-12345` }))).status).toBe(409);
    expect((await db.collection('appointments').where('businessId', '==', businessId).get()).docs.every(doc => !!doc.get('canchaId'))).toBe(true);
  });

  it('enforces booking quota atomically without charging idempotent retries', async () => {
    const { businessId, serviceId } = await seed();
    const first = body(businessId, serviceId);
    expect((await book(request(first))).status).toBe(201);
    expect((await book(request(first))).status).toBe(200);
    const counters = await db.collection('bookingRateLimits').where('businessId', '==', businessId).get();
    expect(counters.size).toBe(3);
    expect(counters.docs.every(doc => doc.get('count') === 1)).toBe(true);
    await Promise.all(counters.docs.map(doc => doc.ref.update({ count: 120 })));
    expect((await book(request({ ...first, time: '12:00', idempotencyKey: `limited-${businessId}-12345` }))).status).toBe(429);
    expect((await book(request(first))).status).toBe(200);
    await expect(count('appointments', businessId)).resolves.toBe(1);
  });

  it('serializes concurrent slot requests with different idempotency keys and persists exactly one booking graph', async () => {
    const { businessId, serviceId } = await seed();
    const first = body(businessId, serviceId, { idempotencyKey: `first-key-${businessId}-123456` });
    const second = body(businessId, serviceId, { idempotencyKey: `second-key-${businessId}-123456` });

    const responses = await Promise.all([book(request(first)), book(request(second))]);
    const statuses = responses.map((response) => response.status).sort();
    for (const response of responses) {
      const json = await response.json();
      expect(JSON.stringify(json)).not.toContain('Cliente de prueba');
      expect(JSON.stringify(json)).not.toContain('11111111');
      expect(JSON.stringify(json)).not.toContain('client@example.test');
    }
    await expect(count('appointments', businessId)).resolves.toBe(1);
    await expect(count('clients', businessId)).resolves.toBe(1);
    await expect(count('bookingCapabilities', businessId)).resolves.toBe(1);
    await expect(count('bookingEmailOutbox', businessId)).resolves.toBe(1);
    expect(statuses).toEqual([201, 409]);
  });

  it('reuses one normalized client across recurring concurrent bookings', async () => {
    const { businessId, serviceId } = await seed();
    const laterDate = dateKeyInBuenosAires(7);
    await db.collection('services').doc(serviceId).update({
      [`workingHours.${weekday(laterDate)}`]: { slots: [{ start: '09:00', end: '18:00' }] },
    });
    const first = body(businessId, serviceId, {
      clientPhone: '+54 (11) 1111-1111', idempotencyKey: `client-first-${businessId}-123456`, time: '10:00', dateKey: laterDate,
    });
    expect((await book(request(first))).status).toBe(201);

    const [second, third] = await Promise.all([
      book(request(body(businessId, serviceId, { clientPhone: '541111111111', time: '12:00', idempotencyKey: `client-second-${businessId}-123456` }))),
      book(request(body(businessId, serviceId, { clientPhone: '54 11 1111 1111', time: '14:00', idempotencyKey: `client-third-${businessId}-123456` }))),
    ]);

    expect([second.status, third.status].sort()).toEqual([201, 201]);
    await expect(count('clients', businessId)).resolves.toBe(1);
    const [client, appointments] = await Promise.all([
      db.collection('clients').where('businessId', '==', businessId).get(),
      db.collection('appointments').where('businessId', '==', businessId).get(),
    ]);
    expect(client.docs[0].get('phone')).toBe('541111111111');
    expect(client.docs[0].get('lastAppointment').toDate().getTime()).toBe(localTimeToUtc(laterDate, '00:00', zone).getTime());
    expect(new Set(appointments.docs.map(doc => doc.get('clientId'))).size).toBe(1);
  });

  it('replays the same key safely and rejects the same key with changed payload', async () => {
    const { businessId, serviceId } = await seed();
    const initial = body(businessId, serviceId);
    const created = await book(request(initial));
    expect(created.status).toBe(201);
    const createdJson = await created.json();

    const replay = await book(request(initial));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ id: createdJson.id, repeated: true });

    const altered = await book(request({ ...initial, client: 'Otra persona' }));
    expect(altered.status).toBe(409);
    await expect(altered.json()).resolves.toEqual({ error: 'Idempotency key reused for different details' });
    await expect(count('appointments', businessId)).resolves.toBe(1);
    await expect(count('clients', businessId)).resolves.toBe(1);
    await expect(count('bookingCapabilities', businessId)).resolves.toBe(1);
    await expect(count('bookingEmailOutbox', businessId)).resolves.toBe(1);
  });

  it('preserves Services Free access but rejects invalid dates, inactive businesses and paused resources', async () => {
    const active = await seed();
    const invalidDate = await book(request(body(active.businessId, active.serviceId, { dateKey: '2026-02-30' })));
    expect(invalidDate.status).toBe(400);
    expect(await invalidDate.json()).toEqual({ error: 'Invalid booking details' });

    const expired = await seed({ membership: { type: 'trial', expiresAt: new Date('2020-01-01T00:00:00Z') } });
    const expiredResponse = await book(request(body(expired.businessId, expired.serviceId)));
    expect(expiredResponse.status).toBe(201);
    await expect(count('appointments', expired.businessId)).resolves.toBe(1);

    const unknown = await seed({ membership: { type: 'untrusted-plan' } });
    const unknownResponse = await book(request(body(unknown.businessId, unknown.serviceId)));
    expect(unknownResponse.status).toBe(201);
    await expect(count('appointments', unknown.businessId)).resolves.toBe(1);

    const disabled = await seed();
    await db.doc(`businesses/${disabled.businessId}`).update({ status: 'inactive' });
    const disabledResponse = await book(request(body(disabled.businessId, disabled.serviceId)));
    expect(disabledResponse.status).toBe(404);
    expect(await disabledResponse.json()).toEqual({ error: 'Booking resource unavailable' });
    await expect(count('appointments', disabled.businessId)).resolves.toBe(0);

    const expiredSports = await seed({ membership: { type: 'trial', expiresAt: new Date('2020-01-01T00:00:00Z') } });
    await db.doc(`businesses/${expiredSports.businessId}`).update({ businessType: 'sports_facility' });
    const courtId = `expired_court_${expiredSports.businessId}`;
    await db.doc(`canchas/${courtId}`).set((await db.doc(`services/${expiredSports.serviceId}`).get()).data()!);
    const sportsResponse = await book(request(body(expiredSports.businessId, expiredSports.serviceId, { serviceId: undefined, canchaId: courtId })));
    expect(sportsResponse.status).toBe(403);
    expect(await sportsResponse.json()).toEqual({ error: 'Online booking unavailable' });
    await expect(count('appointments', expiredSports.businessId)).resolves.toBe(0);

    const paused = await seed({ serviceStatus: 'Pausado' });
    const pausedResponse = await book(request(body(paused.businessId, paused.serviceId)));
    expect(pausedResponse.status).toBe(404);
    expect(await pausedResponse.json()).toEqual({ error: 'Booking resource unavailable' });
  });

  it('rejects concurrent requests at different but overlapping times', async () => {
    const { businessId, serviceId } = await seed();
    const atTen = body(businessId, serviceId, { idempotencyKey: `overlap-ten-${businessId}-123456`, time: '10:00' });
    const atTenThirty = body(businessId, serviceId, { idempotencyKey: `overlap-thirty-${businessId}-123456`, time: '10:30' });
    const responses = await Promise.all([book(request(atTen)), book(request(atTenThirty))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(count('appointments', businessId)).resolves.toBe(1);
    await expect(count('bookingSlots', businessId)).resolves.toBeGreaterThan(0);
  });

  it('cancellation consumes the capability, frees slots, and permits a replacement booking', async () => {
    const { businessId, serviceId } = await seed();
    const initial = body(businessId, serviceId, { idempotencyKey: `cancel-first-${businessId}-123456`, time: '10:00' });
    expect((await book(request(initial))).status).toBe(201);
    expect(await count('bookingSlots', businessId)).toBeGreaterThan(0);

    const token = await bookingToken(businessId);
    const cancellation = await actOnAppointment(actionRequest({ token, action: 'cancel' }));
    expect(cancellation.status).toBe(200);
    await expect(cancellation.json()).resolves.toEqual({ action: 'cancel' });
    await expect(count('bookingSlots', businessId)).resolves.toBe(0);

    const replacement = await book(request(body(businessId, serviceId, {
      idempotencyKey: `cancel-replacement-${businessId}-123456`, time: '10:00',
    })));
    expect(replacement.status).toBe(201);
    await expect(count('appointments', businessId)).resolves.toBe(2);
    await expect(count('bookingSlots', businessId)).resolves.toBeGreaterThan(0);
  });

  it('rescheduling moves deterministic occupancy, frees the old time, and blocks the new time', async () => {
    const { businessId, serviceId } = await seed();
    const dateKey = dateKeyInBuenosAires();
    const created = await book(request(body(businessId, serviceId, {
      idempotencyKey: `reschedule-first-${businessId}-123456`, time: '10:00', dateKey,
    })));
    expect(created.status).toBe(201);
    const token = await bookingToken(businessId);
    const oldSlotIds = bookingSlotIds(businessId, 'services', localTimeToUtc(dateKey, '10:00', zone), 60, 0);
    const newSlotIds = bookingSlotIds(businessId, 'services', localTimeToUtc(dateKey, '12:00', zone), 60, 0);

    const moved = await actOnAppointment(actionRequest({ token, action: 'reschedule', dateKey, time: '12:00' }));
    expect(moved.status).toBe(200);
    await expect(moved.json()).resolves.toMatchObject({ action: 'reschedule' });
    const oldSlots = await Promise.all(oldSlotIds.map((id) => db.collection('bookingSlots').doc(id).get()));
    const newSlots = await Promise.all(newSlotIds.map((id) => db.collection('bookingSlots').doc(id).get()));
    expect(oldSlots.every((snapshot) => !snapshot.exists)).toBe(true);
    expect(newSlots.every((snapshot) => snapshot.exists)).toBe(true);

    const oldTime = await book(request(body(businessId, serviceId, {
      idempotencyKey: `reschedule-old-${businessId}-123456`, time: '10:00', dateKey,
    })));
    expect(oldTime.status).toBe(201);
    const newTime = await book(request(body(businessId, serviceId, {
      idempotencyKey: `reschedule-new-${businessId}-123456`, time: '12:00', dateKey,
    })));
    expect(newTime.status).toBe(409);
  });

  it('consumes one capability exactly once under concurrent cancel and reschedule requests', async () => {
    const { businessId, serviceId } = await seed();
    const dateKey = dateKeyInBuenosAires();
    const created = await book(request(body(businessId, serviceId, {
      idempotencyKey: `capability-race-${businessId}-123456`, time: '10:00', dateKey,
    })));
    expect(created.status).toBe(201);
    const { id: appointmentId } = await created.json();
    const token = await bookingToken(businessId);

    const [cancel, reschedule] = await Promise.all([
      actOnAppointment(actionRequest({ token, action: 'cancel' })),
      actOnAppointment(actionRequest({ token, action: 'reschedule', dateKey, time: '12:00' })),
    ]);
    expect([cancel.status, reschedule.status].sort()).toEqual([200, 404]);

    const appointment = (await db.collection('appointments').doc(appointmentId).get()).data();
    expect(appointment).toBeTruthy();
    const oldSlotIds = bookingSlotIds(businessId, 'services', localTimeToUtc(dateKey, '10:00', zone), 60, 0);
    const nextSlotIds = bookingSlotIds(businessId, 'services', localTimeToUtc(dateKey, '12:00', zone), 60, 0);
    const [oldSlots, nextSlots] = await Promise.all([
      Promise.all(oldSlotIds.map((id) => db.collection('bookingSlots').doc(id).get())),
      Promise.all(nextSlotIds.map((id) => db.collection('bookingSlots').doc(id).get())),
    ]);
    const cancelled = appointment?.status === 'Cancelado';
    const rescheduled = appointment?.time === '12:00' && appointment?.status !== 'Cancelado';
    expect(Number(cancelled) + Number(rescheduled)).toBe(1);
    expect(oldSlots.every((snapshot) => !snapshot.exists)).toBe(true);
    expect(nextSlots.every((snapshot) => snapshot.exists)).toBe(rescheduled);
  });
});
