import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { localTimeToUtc, dateKeyInZone } from '@/lib/booking-constraints';

const { getAdminFirestore, verifyIdToken } = vi.hoisted(() => ({
  getAdminFirestore: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));

import { DELETE } from '@/app/api/owner/canchas/route';
import { POST as book } from '@/app/api/public/bookings/route';

const PROJECT_ID = 'pediturno-owner-canchas-it';
const zone = 'America/Argentina/Buenos_Aires';
let db: Firestore;
let suffix = 0;

function request(canchaId: string) {
  return new Request('https://pediturno.test/api/owner/canchas', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner-token' },
    body: JSON.stringify({ canchaId }),
  }) as never;
}

async function seed(withLegacyReservation: boolean) {
  suffix += 1;
  const owner = `owner_court_${suffix}`;
  const canchaId = `cancha_court_${suffix}`;
  const name = `Cancha ${suffix}`;
  await db.collection('businesses').doc(owner).set({
    status: 'active', membership: { type: 'lifetime' }, timeZone: zone, businessType: 'sports_facility',
  });
  await db.collection('canchas').doc(canchaId).set({
    businessId: owner, name, price: '3500', duration: 60, status: 'Pausado',
  });
  if (withLegacyReservation) {
    const future = new Date(Date.now() + 2 * 86400000);
    const dayKey = dateKeyInZone(future, zone);
    await db.collection('appointments').doc(`legacy_${suffix}`).set({
      businessId: owner, cancha: name, date: localTimeToUtc(dayKey, '20:00', zone), time: '20:00', status: 'Confirmado',
    });
  }
  return { owner, canchaId };
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run this suite through firebase emulators:exec; it must never target production.');
  }
  const app = getApps().find(candidate => candidate.name === 'owner-canchas-integration')
    ?? initializeApp({ projectId: PROJECT_ID }, 'owner-canchas-integration');
  db = getFirestore(app);
  getAdminFirestore.mockReturnValue(db);
});

beforeEach(() => {
  getAdminFirestore.mockReturnValue(db);
  verifyIdToken.mockImplementation(async (token: string) => ({ uid: token === 'owner-token' ? `owner_court_${suffix}` : 'other' }));
});

afterAll(async () => {
  await Promise.all(getApps().filter(app => app.name === 'owner-canchas-integration').map(app => app.delete()));
});

describe('owner cancha delete route against Firestore Emulator', () => {
  it('never leaves a confirmed booking pointing at a concurrently deleted court', async () => {
    const oldBypass = process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;
    const oldKey = process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
    process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = 'true';
    process.env.BOOKING_CAPABILITY_OUTBOX_KEY = Buffer.alloc(32, 9).toString('base64');
    try {
      const { owner, canchaId } = await seed(false);
      const dateKey = dateKeyInZone(new Date(Date.now() + 3 * 86400000), zone);
      const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
      await db.collection('canchas').doc(canchaId).update({ status: 'Activo', workingHours: { [day]: { slots: [{ start: '09:00', end: '21:00' }] } } });
      const booking = new Request('https://pediturno.test/api/public/bookings', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: owner, canchaId, dateKey, time: '15:00', client: 'Cliente QA', clientPhone: '1112345678', clientEmail: 'qa@example.test', idempotencyKey: `race-${owner}-123456789` }),
      });
      const [removed, booked] = await Promise.all([DELETE(request(canchaId)), book(booking as never)]);
      const courtExists = (await db.collection('canchas').doc(canchaId).get()).exists;
      const appointments = await db.collection('appointments').where('businessId', '==', owner).get();
      if (booked.status === 201) {
        expect(removed.status).toBe(409);
        expect(courtExists).toBe(true);
        expect(appointments.size).toBe(1);
      } else {
        expect(removed.status).toBe(200);
        expect([404, 409]).toContain(booked.status);
        expect(courtExists).toBe(false);
        expect(appointments.empty).toBe(true);
      }
    } finally {
      if (oldBypass === undefined) delete process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS; else process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = oldBypass;
      if (oldKey === undefined) delete process.env.BOOKING_CAPABILITY_OUTBOX_KEY; else process.env.BOOKING_CAPABILITY_OUTBOX_KEY = oldKey;
    }
  });
  it('keeps a court with a current legacy reservation', async () => {
    const { canchaId } = await seed(true);
    expect((await DELETE(request(canchaId))).status).toBe(409);
    expect((await db.collection('canchas').doc(canchaId).get()).exists).toBe(true);
  });

  it('handles duplicate deletes idempotently while removing an unbooked court exactly once', async () => {
    const { canchaId } = await seed(false);
    const responses = await Promise.all([DELETE(request(canchaId)), DELETE(request(canchaId))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 200]);
    expect((await db.collection('canchas').doc(canchaId).get()).exists).toBe(false);
  });
});
