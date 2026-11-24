/*
 * Local-only fixtures for Android instrumentation. Credentials are generated
 * at runtime and live only in ignored output/android-native-e2e metadata.
 * This never contacts production and never writes a token or password to logs.
 */
const crypto = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { mkdir, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldPath, getFirestore, Timestamp } = require('firebase-admin/firestore');

const PROJECT_ID = 'demo-pediturno-audit';
const FIRESTORE_HOST = '127.0.0.1:8080';
const AUTH_HOST = '127.0.0.1:9099';
const NEXT_ORIGIN = 'http://127.0.0.1:3000';
const OUTPUT_DIR = path.resolve(__dirname, '../output/android-native-e2e');
const METADATA_PATH = path.join(OUTPUT_DIR, 'fixture-metadata.json');
const PREFIX = 'android_native_e2e_';
const PAGE_SIZE = 400;
const WORKSPACE_RESULT_CLIENT_PREFIX = 'Reserva Nativa ';
const zone = 'America/Argentina/Buenos_Aires';
let app;
let db;

function requireDemoRuntime() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_HOST) {
    throw new Error('Refusing native E2E fixture operation outside the loopback Firestore/Auth emulators');
  }
  if (process.env.FIREBASE_PROJECT_ID !== PROJECT_ID || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`Refusing native E2E fixture operation outside ${PROJECT_ID}`);
  }
  const origin = new URL(process.env.PEDITURNO_ANDROID_LOCAL_BASE_URL || NEXT_ORIGIN).origin;
  if (origin !== NEXT_ORIGIN) throw new Error(`Refusing native E2E fixture operation outside ${NEXT_ORIGIN}`);
  return origin;
}

function dateKeyInZone(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localMidnight(dateKey) {
  // Both fixture businesses use America/Argentina/Buenos_Aires (UTC-03).
  return Timestamp.fromDate(new Date(`${dateKey}T03:00:00.000Z`));
}

function assertOwnedId(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Fixture metadata is invalid; refusing cleanup');
  }
}

function validateMetadata(metadata) {
  if (!metadata || metadata.schemaVersion !== 1 || metadata.projectId !== PROJECT_ID || !Array.isArray(metadata.owners) || metadata.owners.length !== 2 || typeof metadata.dateKey !== 'string') {
    throw new Error('Fixture metadata is invalid; refusing operation');
  }
  for (const owner of metadata.owners) {
    if (!owner || typeof owner.email !== 'string' || typeof owner.password !== 'string') throw new Error('Fixture metadata is invalid; refusing operation');
    for (const key of ['uid', 'serviceId', 'clientId', 'existingAppointmentId']) assertOwnedId(owner[key]);
  }
  return metadata;
}

function readMetadata() {
  if (!existsSync(METADATA_PATH)) return null;
  try { return validateMetadata(JSON.parse(readFileSync(METADATA_PATH, 'utf8'))); }
  catch { throw new Error('Fixture metadata cannot be read safely'); }
}

async function health(origin) {
  const response = await fetch(`${origin}/api/health`).catch(() => null);
  if (!response?.ok) throw new Error(`Local Next server ${NEXT_ORIGIN} is unavailable`);
}

async function idToken(owner) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture-api-key', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password: owner.password, returnSecureToken: true }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.idToken !== 'string') throw new Error('Auth emulator could not verify a fixture owner');
  const verified = await getAuth(app).verifyIdToken(payload.idToken);
  if (verified.uid !== owner.uid) throw new Error('Auth emulator returned an unexpected fixture identity');
  return payload.idToken;
}

async function getJson(origin, token, pathname) {
  const response = await fetch(`${origin}${pathname}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Fixture owner API verification failed: ${pathname} (${response.status})`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error(`Fixture owner API returned invalid JSON: ${pathname}`);
  return payload;
}

async function removeDocumentsByField(collection, field, ownerId) {
  let cursor;
  while (true) {
    let query = db.collection(collection).where(field, '==', ownerId).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const rows = await query.get();
    if (rows.empty) return;
    const batch = db.batch();
    for (const row of rows.docs) batch.delete(row.ref);
    await batch.commit();
    if (rows.size < PAGE_SIZE) return;
    cursor = rows.docs.at(-1);
  }
}

async function removeDeviceTokens(ownerId) {
  let cursor;
  while (true) {
    let query = db.collection('businesses').doc(ownerId).collection('deviceTokens').orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const rows = await query.get();
    if (rows.empty) return;
    const batch = db.batch();
    for (const row of rows.docs) batch.delete(row.ref);
    await batch.commit();
    if (rows.size < PAGE_SIZE) return;
    cursor = rows.docs.at(-1);
  }
}

async function removeFixture(metadata) {
  for (const owner of metadata.owners) {
    // The debug app may create normal appointment side-effects. Each query is
    // still constrained to the two fixture UIDs and does not touch financial
    // collections or any document belonging to another business.
    await Promise.all([
      // Instrumentation creates resources with server-generated IDs. These
      // bounded queries are safe because owner.uid is validated from ignored
      // metadata, never supplied by a user or test request.
      removeDocumentsByField('appointments', 'businessId', owner.uid),
      removeDocumentsByField('clients', 'businessId', owner.uid),
      removeDocumentsByField('services', 'businessId', owner.uid),
      removeDocumentsByField('publicBusinesses', 'businessId', owner.uid),
      removeDocumentsByField('bookingSlots', 'businessId', owner.uid),
      removeDocumentsByField('bookingCapabilities', 'businessId', owner.uid),
      removeDocumentsByField('bookingEmailOutbox', 'businessId', owner.uid),
      removeDocumentsByField('ownerAppointmentRequests', 'ownerId', owner.uid),
      removeDocumentsByField('androidDeviceTokenIndex', 'ownerId', owner.uid),
      removeDeviceTokens(owner.uid),
    ]);
    await db.collection('businesses').doc(owner.uid).delete();
    await getAuth(app).deleteUser(owner.uid).catch(() => undefined);
  }
}

function newOwner(runId, label) {
  const uid = `${PREFIX}${runId}_owner_${label}`;
  return {
    uid, serviceId: `${PREFIX}${runId}_service_${label}`, clientId: `${PREFIX}${runId}_client_${label}`,
    existingAppointmentId: `${PREFIX}${runId}_web_existing_${label}`,
    email: `android-e2e-${runId}-${label}@example.test`, password: crypto.randomBytes(24).toString('base64url'),
  };
}

async function seedOwner(owner, index, dateKey) {
  const workingHours = Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), { slots: [{ start: '09:00', end: '17:00' }] }])
  );
  await getAuth(app).createUser({ uid: owner.uid, email: owner.email, password: owner.password, emailVerified: true });
  await db.collection('businesses').doc(owner.uid).set({
    status: 'active', businessType: 'services', name: `Android E2E Servicios ${index + 1}`, email: owner.email,
    slug: `android-e2e-${owner.uid.slice(-12).replace(/_/g, '-')}`, timeZone: zone, membership: { type: 'lifetime' },
    bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 2, bookingHorizonDays: 30, appointmentBufferMinutes: 10, remindersEnabled: false, newAppointmentNotificationsEnabled: false, notificationEmail: '' },
  });
  await db.collection('services').doc(owner.serviceId).set({
    businessId: owner.uid, name: `Servicio Android ${index + 1}`, duration: '45', price: 1234.56, status: 'Activo',
    workingHours, unavailableDates: [], bookingBufferMinutes: 10,
  });
  await db.collection('clients').doc(owner.clientId).set({ businessId: owner.uid, name: `Cliente Android ${index + 1}`, phone: `54911000000${index + 1}`, email: '', avatar: '' });
  await db.collection('appointments').doc(owner.existingAppointmentId).set({
    businessId: owner.uid, clientId: owner.clientId, client: `Cliente Android ${index + 1}`, clientPhone: `54911000000${index + 1}`,
    serviceId: owner.serviceId, service: `Servicio Android ${index + 1}`, date: localMidnight(dateKey), time: '10:00', durationMinutes: 45,
    bookingBufferMinutesAtBooking: 10, priceAtBooking: 1234.56, status: 'Confirmado',
  });
}

async function verify(origin, metadata) {
  for (const owner of metadata.owners) {
    const token = await idToken(owner);
    const [bootstrap, clients, agenda, availability] = await Promise.all([
      getJson(origin, token, '/api/v1/owner/bootstrap'),
      getJson(origin, token, '/api/v1/owner/clients?limit=100'),
      getJson(origin, token, `/api/v1/owner/agenda?date=${encodeURIComponent(metadata.dateKey)}`),
      getJson(origin, token, `/api/v1/owner/availability?serviceId=${encodeURIComponent(owner.serviceId)}&date=${encodeURIComponent(metadata.dateKey)}`),
    ]);
    if (bootstrap.business?.id !== owner.uid || !clients.clients?.some(client => client.id === owner.clientId) || !agenda.appointments?.some(appointment => appointment.id === owner.existingAppointmentId) || availability.serviceId !== owner.serviceId) {
      throw new Error('Fixture API data did not match its explicitly created owner resources');
    }
  }
}

async function verifyWorkspaceResult(origin, metadata) {
  const [ownerA, ownerB] = metadata.owners;
  const rescheduledDate = addDays(metadata.dateKey, 1);
  const [ownerAToken, ownerBToken] = await Promise.all([idToken(ownerA), idToken(ownerB)]);
  const [ownerAAgenda, ownerBAgenda] = await Promise.all([
    getJson(origin, ownerAToken, `/api/v1/owner/agenda?date=${encodeURIComponent(rescheduledDate)}`),
    getJson(origin, ownerBToken, `/api/v1/owner/agenda?date=${encodeURIComponent(rescheduledDate)}`),
  ]);
  const matches = (ownerAAgenda.appointments || []).filter(appointment => typeof appointment.client === 'string' && appointment.client.startsWith(WORKSPACE_RESULT_CLIENT_PREFIX));
  if (matches.length !== 1 || matches[0].status !== 'Completado' || !/^\d{2}:\d{2}$/.test(matches[0].time || '')) {
    throw new Error('Native workspace result was not created, rescheduled, and completed through the owner API');
  }
  if ((ownerBAgenda.appointments || []).some(appointment => typeof appointment.client === 'string' && appointment.client.startsWith(WORKSPACE_RESULT_CLIENT_PREFIX))) {
    throw new Error('Native workspace result leaked into the second owner agenda');
  }
}

async function writeMetadata(metadata) {
  await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  const mode = process.argv[2] || 'seed';
  if (!['seed', 'verify', 'verify-workspace', 'cleanup'].includes(mode)) throw new Error('Usage: node scripts/android-native-e2e-fixtures.cjs [seed|verify|verify-workspace|cleanup]');
  const origin = requireDemoRuntime();
  await health(origin);
  app = initializeApp({ projectId: PROJECT_ID }, `android-native-e2e-${Date.now()}`);
  db = getFirestore(app);
  let provisional = null;
  try {
    const existing = readMetadata();
    if (mode === 'cleanup') {
      if (!existing) throw new Error('No native E2E fixture metadata exists to clean');
      await removeFixture(existing); await unlink(METADATA_PATH).catch(() => undefined);
      console.log('Native Android E2E fixtures cleaned');
      return;
    }
    if (mode === 'verify') {
      if (!existing) throw new Error('No native E2E fixture metadata exists to verify');
      await verify(origin, existing);
      console.log('Native Android E2E fixtures verified');
      return;
    }
    if (mode === 'verify-workspace') {
      if (!existing) throw new Error('No native E2E fixture metadata exists to verify');
      await verifyWorkspaceResult(origin, existing);
      console.log('Native Android workspace result verified');
      return;
    }
    if (existing) await removeFixture(existing);
    const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const dateKey = addDays(dateKeyInZone(new Date()), 1);
    const metadata = { schemaVersion: 1, projectId: PROJECT_ID, createdAt: new Date().toISOString(), dateKey, owners: [newOwner(runId, 'a'), newOwner(runId, 'b')] };
    // Keep exact IDs in memory before the first write so a failed seed cannot
    // strand a partial fixture in the shared emulator.
    provisional = metadata;
    await Promise.all(metadata.owners.map((owner, index) => seedOwner(owner, index, dateKey)));
    await verify(origin, metadata);
    await writeMetadata(metadata);
    provisional = null;
    console.log('Native Android E2E fixtures seeded and verified');
  } catch (error) {
    if (provisional) await removeFixture(provisional).catch(() => undefined);
    throw error;
  } finally {
    if (app) await deleteApp(app);
  }
}

main().catch(error => {
  // Error text is intentionally credential-free; never print metadata.
  console.error(error instanceof Error ? error.message : 'Native Android E2E fixture operation failed');
  process.exitCode = 1;
});
