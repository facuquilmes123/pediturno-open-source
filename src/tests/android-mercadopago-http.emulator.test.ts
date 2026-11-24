import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const projectId = 'demo-pediturno-audit';
const baseUrl = process.env.PEDITURNO_ANDROID_LOCAL_BASE_URL || 'http://127.0.0.1:3000';
const ownerId = `it_android_mp_${Date.now()}_owner`;
let app: App; let db: Firestore; let token = ''; let initialized = false;

async function request(path: string, options: RequestInit = {}, bearer = token) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(options.headers || {}) },
  });
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Existing Firestore/Auth emulators are required');
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Expected the isolated Android local server at ${baseUrl}`);
  app = initializeApp({ projectId }); db = getFirestore(app); initialized = true;
  const email = `${ownerId}@example.test`; const password = `pw-${ownerId}-A!`;
  await db.collection('businesses').doc(ownerId).set({
    status: 'active', businessType: 'services', name: 'MP fixture', email,
    membership: { type: 'lifetime' },
    // Deliberately stale display value: GET must use the private connection
    // source, not expose this as a connected seller.
    mercadopago: { isConnected: true, requireDeposit: false },
  });
  await getAuth(app).createUser({ uid: ownerId, email, password, emailVerified: true });
  const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture-api-key', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const payload = await login.json() as { idToken?: string };
  if (!login.ok || typeof payload.idToken !== 'string') throw new Error('Could not obtain Firebase Auth emulator token');
  token = payload.idToken;
});

afterAll(async () => {
  if (!initialized) return;
  await Promise.all([
    db.collection('businesses').doc(ownerId).delete().catch(() => undefined),
    db.collection('mercadoPagoConnections').doc(ownerId).delete().catch(() => undefined),
    getAuth(app).deleteUser(ownerId).catch(() => undefined),
  ]);
  if (getApps().some(current => current.name === app.name)) { await db.terminate(); await deleteApp(app); }
});

describe('Android Mercado Pago owner HTTP contract', () => {
  it('rejects missing or invalid Firebase credentials before reading seller state', async () => {
    const none = await request('/api/v1/owner/mercadopago', {}, '');
    expect(none.status).toBe(401);
    await expect(none.json()).resolves.toMatchObject({ code: 'AUTH_REQUIRED' });
    const invalid = await request('/api/v1/owner/mercadopago', {}, 'not-a-firebase-token');
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('derives connection state from the private seller record and refuses client supplied connection booleans', async () => {
    const status = await request('/api/v1/owner/mercadopago');
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ connected: false, canConfigureDeposits: false, settings: { requireDeposit: false } });
    const forbidden = await request('/api/v1/owner/mercadopago', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isConnected: true }),
    });
    expect(forbidden.status).toBe(400);
    await expect(forbidden.json()).resolves.toMatchObject({ code: 'INVALID_DEPOSIT_SETTINGS' });
    expect((await db.collection('businesses').doc(ownerId).get()).get('mercadopago.isConnected')).toBe(true);
  });

  it('keeps deposits disabled without server marketplace enablement and disconnects without calling a provider', async () => {
    const rejected = await request('/api/v1/owner/mercadopago', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireDeposit: true, depositType: 'percentage', depositValue: 30 }),
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({ code: 'DEPOSITS_UNAVAILABLE' });
    expect((await db.collection('businesses').doc(ownerId).get()).get('mercadopago.requireDeposit')).toBe(false);

    const disabled = await request('/api/v1/owner/mercadopago', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requireDeposit: false, depositType: 'percentage', depositValue: 0 }),
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({ settings: { requireDeposit: false, depositType: 'percentage', depositValue: 0 } });

    const disconnected = await request('/api/v1/owner/mercadopago', { method: 'DELETE' });
    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.toMatchObject({ connected: false, settings: { requireDeposit: false } });
    expect((await db.collection('mercadoPagoConnections').doc(ownerId).get()).get('active')).toBe(false);
    expect((await db.collection('businesses').doc(ownerId).get()).get('mercadopago.isConnected')).toBe(false);
  });
});
