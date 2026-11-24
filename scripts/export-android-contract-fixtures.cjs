/*
 * Exports a deliberately small, authenticated v1 owner API snapshot for the
 * Android contract test. It is fail-closed: it can run only against the named
 * loopback emulators and the already-running local Next server.
 */
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const PROJECT_ID = 'demo-pediturno-audit';
const EMULATOR_HOST = '127.0.0.1:8080';
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const BASE_URL = 'http://127.0.0.1:3000';
const OUTPUT = path.resolve(__dirname, '../android/pediturno-servicios/app/src/test/resources/owner-api-contract.json');
const zone = 'America/Argentina/Buenos_Aires';
const prefix = `contract_owner_${Date.now()}_`;
const ownerId = `${prefix}owner`;
const serviceId = `${prefix}service`;
const clientId = `${prefix}client`;
const agendaAppointmentId = `${prefix}agenda`;
const completedAppointmentId = `${prefix}completed`;
let app;
let db;

function requireLocalEmulators() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_EMULATOR_HOST) {
    throw new Error('Refusing fixture export: require FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099');
  }
  if ((process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT) !== PROJECT_ID) {
    throw new Error(`Refusing fixture export: require project ${PROJECT_ID}`);
  }
  const base = new URL(process.env.PEDITURNO_ANDROID_LOCAL_BASE_URL || BASE_URL);
  if (base.origin !== BASE_URL) throw new Error(`Refusing fixture export: require local Next server ${BASE_URL}`);
  return base;
}

function dateKeyInZone(date) {
  const fields = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const field = (type) => fields.find(item => item.type === type)?.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localMidnight(dateKey) {
  // Argentina uses UTC-03; the fixture business fixes this same named zone.
  return Timestamp.fromDate(new Date(`${dateKey}T03:00:00.000Z`));
}

async function json(base, token, pathname) {
  const response = await fetch(new URL(pathname, base), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Fixture endpoint failed: ${pathname} (${response.status})`);
  const result = await response.json();
  if (!result || typeof result !== 'object') throw new Error(`Fixture endpoint returned invalid JSON: ${pathname}`);
  return result;
}

async function tokenForFixtureOwner() {
  const email = `${ownerId}@example.test`;
  const password = `fixture-${ownerId}-A!`;
  await getAuth(app).createUser({ uid: ownerId, email, password, emailVerified: true });
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture-api-key', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.idToken !== 'string') throw new Error('Fixture Auth emulator could not issue an ID token');
  return payload.idToken;
}

async function seed(dateKey) {
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const monthKey = dateKey.slice(0, 7);
  await db.collection('businesses').doc(ownerId).set({
    status: 'active', businessType: 'services', name: 'Contrato Servicios', email: 'owner@example.test', slug: 'contrato-servicios',
    description: 'Perfil de contrato generado en emulador.', logo: 'https://example.test/logo.png', timeZone: zone,
    address: { street: 'Calle de prueba', number: '123', city: 'Buenos Aires', province: 'Buenos Aires', postalCode: '1000', country: 'Argentina' },
    whatsappButtonEnabled: true, whatsappNumber: '+54 9 11 5555 0000', socialLinks: [{ id: 'instagram', type: 'instagram', url: 'https://instagram.com/contrato', title: 'Instagram' }],
    theme: 'menta', location: { lat: -34.6037, lng: -58.3816 }, membership: { type: 'lifetime' },
    bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 2, bookingHorizonDays: 30, appointmentBufferMinutes: 10, remindersEnabled: true, newAppointmentNotificationsEnabled: true, notificationEmail: 'alerts@example.test' },
  });
  await db.collection('services').doc(serviceId).set({
    businessId: ownerId, name: 'Servicio contrato', duration: '45', price: 1234.56, status: 'Activo', photo: 'https://example.test/service.png',
    workingHours: { [String(weekday)]: { slots: [{ start: '09:00', end: '17:00' }] } }, unavailableDates: [], bookingBufferMinutes: 10,
  });
  await db.collection('clients').doc(clientId).set({ businessId: ownerId, name: 'Cliente contrato', phone: '5491112345678', avatar: '' });
  await db.collection('appointments').doc(agendaAppointmentId).set({
    businessId: ownerId, clientId, client: 'Cliente contrato', clientPhone: '5491112345678', date: localMidnight(dateKey), time: '10:00',
    serviceId, service: 'Servicio contrato', durationMinutes: 45, priceAtBooking: 1234.56, status: 'Confirmado',
  });
  await db.collection('appointments').doc(completedAppointmentId).set({
    businessId: ownerId, clientId, client: 'Cliente contrato', clientPhone: '5491112345678', date: localMidnight(`${monthKey}-01`), time: '11:00',
    serviceId, service: 'Servicio contrato', durationMinutes: 45, priceAtBooking: 1234.56, status: 'Completado',
  });
}

async function cleanup() {
  if (!db || !app) return;
  await Promise.all([
    db.collection('appointments').doc(agendaAppointmentId).delete(),
    db.collection('appointments').doc(completedAppointmentId).delete(),
    db.collection('clients').doc(clientId).delete(),
    db.collection('services').doc(serviceId).delete(),
    db.collection('businesses').doc(ownerId).delete(),
    getAuth(app).deleteUser(ownerId).catch(() => undefined),
  ]);
  await deleteApp(app);
}

async function main() {
  const base = requireLocalEmulators();
  const health = await fetch(new URL('/api/health', base)).catch(() => null);
  if (!health?.ok) throw new Error(`Refusing fixture export: local Next server ${BASE_URL} is unavailable`);
  app = initializeApp({ projectId: PROJECT_ID }, `android-contract-export-${Date.now()}`);
  db = getFirestore(app);
  const dateKey = addDays(dateKeyInZone(new Date()), 1);
  try {
    await seed(dateKey);
    const token = await tokenForFixtureOwner();
    const responses = {
      bootstrap: await json(base, token, '/api/v1/owner/bootstrap'),
      services: await json(base, token, '/api/v1/owner/services?limit=100'),
      clients: await json(base, token, '/api/v1/owner/clients?limit=100'),
      agenda: await json(base, token, `/api/v1/owner/agenda?date=${encodeURIComponent(dateKey)}`),
      settings: await json(base, token, '/api/v1/owner/settings'),
      mercadopago: await json(base, token, '/api/v1/owner/mercadopago'),
      dashboard: await json(base, token, '/api/v1/owner/dashboard'),
      availability: await json(base, token, `/api/v1/owner/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(dateKey)}`),
    };
    await mkdir(path.dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify({ ownerId, dateKey, responses }, null, 2)}\n`, 'utf8');
    console.log(`Wrote Android owner API contract fixture: ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  // Do not print request headers, Auth tokens, or the generated password.
  console.error(error instanceof Error ? error.message : 'Fixture export failed');
  process.exitCode = 1;
});
