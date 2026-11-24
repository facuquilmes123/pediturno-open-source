import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { dateKeyInZone, localTimeToUtc } from '@/lib/booking-constraints';

const projectId = 'demo-pediturno-audit';
const baseUrl = process.env.PEDITURNO_ANDROID_LOCAL_BASE_URL || 'http://127.0.0.1:3000';
const zone = 'America/Argentina/Buenos_Aires';
const prefix = `it_android_dashboard_${Date.now()}_`;
const fixture = (suffix: string) => `${prefix}${suffix}`;
const owners = [fixture('owner_a'), fixture('owner_b'), fixture('owner_c'), fixture('owner_d')];
const tokens = new Map<string, string>();
let app: App; let db: Firestore; let initialized = false;

function business() {
  return {
    status: 'active', businessType: 'services', name: 'Dashboard test', email: 'owner@example.test', timeZone: zone,
    membership: { type: 'lifetime' }, bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 2, bookingHorizonDays: 30 },
  };
}

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function previousMonthDay(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}-01`;
}

function at(dateKey: string) {
  return Timestamp.fromDate(localTimeToUtc(dateKey, '00:00', zone));
}

async function signIn(ownerId: string) {
  const email = `${ownerId}@example.test`; const password = `pw-${ownerId}-A!`;
  await getAuth(app).createUser({ uid: ownerId, email, password, emailVerified: true });
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture-api-key', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const payload = await response.json() as { idToken?: string };
  if (!response.ok || typeof payload.idToken !== 'string') throw new Error('Could not obtain a Firebase Auth emulator token');
  tokens.set(ownerId, payload.idToken);
}

async function dashboard(ownerId: string) {
  return fetch(`${baseUrl}/api/v1/owner/dashboard`, { headers: { authorization: `Bearer ${tokens.get(ownerId)}` } });
}

async function cleanupBusiness(ownerId: string) {
  await Promise.all(['appointments', 'clients', 'services'].map(async collection => {
    const rows = await db.collection(collection).where('businessId', '==', ownerId).get();
    await Promise.all(rows.docs.map(row => row.ref.delete()));
  }));
  await db.collection('businesses').doc(ownerId).delete();
  await getAuth(app).deleteUser(ownerId).catch(() => undefined);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Existing Firestore/Auth emulators are required');
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Expected Android local server at ${baseUrl}`);
  app = initializeApp({ projectId }); db = getFirestore(app); initialized = true;
  await Promise.all(owners.map(async ownerId => { await db.collection('businesses').doc(ownerId).set(business()); await signIn(ownerId); }));
});

afterAll(async () => {
  if (!initialized) return;
  // Only documents bearing this run's randomly generated owner ids are touched.
  await Promise.all(owners.map(cleanupBusiness));
  if (getApps().some(current => current.name === app.name)) { await db.terminate(); await deleteApp(app); }
});

describe('Android dashboard HTTP contract against Firebase emulators', () => {
  it('derives counts and appointments from the authenticated business, never a neighboring tenant', async () => {
    const [ownerId, otherOwnerId] = owners; const tomorrow = addDays(dateKeyInZone(new Date(), zone), 1);
    await db.collection('clients').doc(fixture('client_owner')).set({ businessId: ownerId, name: 'Owner client' });
    await db.collection('clients').doc(fixture('client_other')).set({ businessId: otherOwnerId, name: 'Other client' });
    await db.collection('appointments').doc(fixture('owner_upcoming')).set({ businessId: ownerId, client: 'Owner client', date: at(tomorrow), time: '10:00', status: 'Confirmado' });
    await db.collection('appointments').doc(fixture('other_upcoming')).set({ businessId: otherOwnerId, client: 'Other client', date: at(tomorrow), time: '08:00', status: 'Confirmado' });

    const response = await dashboard(ownerId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ timeZone: zone, totalClients: 1, upcomingAppointmentsCount: 1, upcomingAppointments: [{ id: fixture('owner_upcoming') }] });
  }, 30_000);

  it('counts only pending or confirmed future appointments and returns the first five ordered by time', async () => {
    const ownerId = owners[2]; const tomorrow = addDays(dateKeyInZone(new Date(), zone), 1);
    const candidates = ['15:00', '08:30', '11:00', '09:00', '10:30', '14:00'];
    await Promise.all(candidates.map((time, index) => db.collection('appointments').doc(fixture(`upcoming_${index}`)).set({
      businessId: ownerId, client: `Upcoming ${index}`, date: at(tomorrow), time, status: index % 2 ? 'Pendiente' : 'Confirmado',
    })));
    await Promise.all(['Cancelado', 'Completado'].map((status, index) => db.collection('appointments').doc(fixture(`excluded_${index}`)).set({
      businessId: ownerId, client: status, date: at(tomorrow), time: '07:00', status,
    })));

    const response = await dashboard(ownerId);
    expect(response.status).toBe(200);
    const payload = await response.json() as { upcomingAppointmentsCount: number; upcomingAppointments: Array<{ time: string }> };
    expect(payload.upcomingAppointmentsCount).toBe(6);
    expect(payload.upcomingAppointments.map(appointment => appointment.time)).toEqual(['08:30', '09:00', '10:30', '11:00', '14:00']);
  }, 30_000);

  it('uses the stored completed price when valid and the owning service price only as the legacy fallback', async () => {
    const ownerId = owners[3]; const today = dateKeyInZone(new Date(), zone); const monthKey = today.slice(0, 7);
    const serviceId = fixture('service_fallback');
    await db.collection('services').doc(serviceId).set({ businessId: ownerId, name: 'Servicio fallback', price: '2750,25' });
    await db.collection('appointments').doc(fixture('price_stored')).set({ businessId: ownerId, client: 'Stored', date: at(`${monthKey}-01`), time: '10:00', status: 'Completado', priceAtBooking: 1500.5 });
    await db.collection('appointments').doc(fixture('price_fallback')).set({ businessId: ownerId, client: 'Fallback', date: at(`${monthKey}-02`), time: '11:00', status: 'Completado', priceAtBooking: 'stale string', serviceId, service: 'Servicio fallback' });
    await db.collection('appointments').doc(fixture('price_not_completed')).set({ businessId: ownerId, client: 'Not completed', date: at(`${monthKey}-03`), time: '12:00', status: 'Confirmado', priceAtBooking: 99999 });
    await db.collection('appointments').doc(fixture('price_last_month')).set({ businessId: ownerId, client: 'Last month', date: at(previousMonthDay(monthKey)), time: '13:00', status: 'Completado', priceAtBooking: 99999 });
    await db.collection('appointments').doc(fixture('price_other_tenant')).set({ businessId: owners[1], client: 'Other tenant', date: at(`${monthKey}-04`), time: '14:00', status: 'Completado', priceAtBooking: 99999 });

    const response = await dashboard(ownerId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ monthKey, monthlyRevenue: 4250.75 });
  }, 30_000);
});
