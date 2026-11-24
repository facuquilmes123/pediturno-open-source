import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore: mocks.db }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));

import { GET, POST } from '@/app/api/v1/owner/services/route';
import { GET as availability } from '@/app/api/v1/owner/availability/route';
import { dateKeyInZone, localTimeToUtc, shiftDateKey } from '@/lib/booking-constraints';

let app: App;
let db: Firestore;
let ownerId: string;
const headers = { authorization: 'Bearer emulator-only', 'content-type': 'application/json' };
const workingHours = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { slots: [{ start: '09:00', end: '18:00' }] }]));
const request = (path: string, body?: unknown) => new NextRequest(`https://pediturno.test/api/v1/owner/${path}`, {
  method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
});
const payload = (dates: string[]) => ({ name: 'Servicio fechas', duration: 30, price: '100', status: 'Activo', workingHours, unavailableDates: dates });

beforeAll(() => {
  if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Loopback emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-service-dates' }, `service-dates-${randomUUID()}`);
  db = getFirestore(app);
});
beforeEach(async () => {
  ownerId = `service-dates-${randomUUID()}`;
  mocks.db.mockReturnValue(db);
  mocks.verify.mockResolvedValue({ uid: ownerId });
});
afterEach(async () => {
  const services = await db.collection('services').where('businessId', '==', ownerId).get();
  await Promise.all(services.docs.map(doc => doc.ref.delete()));
  await db.doc(`businesses/${ownerId}`).delete();
});
afterAll(async () => { await db.terminate(); await deleteApp(app); });

async function seedBusiness(zone: string) {
  await db.doc(`businesses/${ownerId}`).set({ name: 'Servicios fechas', businessType: 'services', status: 'active',
    membership: { type: 'lifetime' }, timeZone: zone,
    bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 0, bookingHorizonDays: 30, appointmentBufferMinutes: 0 } });
}

describe('service date-only blocking uses the business time zone', () => {
  it.each(['America/Argentina/Buenos_Aires', 'America/Bogota', 'Europe/Madrid'])('blocks the selected day, not its neighbour, in %s', async zone => {
    await seedBusiness(zone);
    const day = shiftDateKey(dateKeyInZone(new Date(), zone), 3);
    const created = await POST(request('services', payload([day])));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const saved = (await db.doc(`services/${id}`).get()).get('unavailableDates')[0].toDate();
    expect(dateKeyInZone(saved, zone)).toBe(day);
    const list = await (await GET(request('services'))).json();
    expect(list.services.find((item: { id: string }) => item.id === id).unavailableDates).toEqual([day]);
    const blocked = await (await availability(request(`availability?serviceId=${id}&date=${day}`))).json();
    expect(blocked.slots.some((slot: { available: boolean }) => slot.available)).toBe(false);
    const preceding = await (await availability(request(`availability?serviceId=${id}&date=${shiftDateKey(day, -1)}`))).json();
    expect(preceding.slots.some((slot: { available: boolean }) => slot.available)).toBe(true);
  });

  it('keeps an explicit legacy instant unchanged while presenting its business date', async () => {
    const zone = 'America/Argentina/Buenos_Aires';
    await seedBusiness(zone);
    const day = shiftDateKey(dateKeyInZone(new Date(), zone), 3);
    const instant = localTimeToUtc(day, '00:00', zone).toISOString();
    const created = await POST(request('services', payload([instant])));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await db.doc(`services/${id}`).get()).get('unavailableDates')[0].toDate().toISOString()).toBe(instant);
    const list = await (await GET(request('services'))).json();
    expect(list.services[0].unavailableDates).toEqual([day]);
  });

  it.each(['2030-02-30', '2030-02-30T00:00:00.000Z', '2030-06-13T00:00:00'])('rejects an impossible or unqualified calendar date %s', async invalid => {
    await seedBusiness('America/Argentina/Buenos_Aires');
    const response = await POST(request('services', payload([invalid])));
    expect(response.status).toBe(400);
    expect((await db.collection('services').where('businessId', '==', ownerId).get()).empty).toBe(true);
  });
});
