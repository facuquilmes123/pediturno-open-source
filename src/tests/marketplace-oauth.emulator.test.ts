import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ db: vi.fn(), exchange: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: vi.fn(async () => ({ uid: 'owner' })) }) }));
vi.mock('@/lib/payments/marketplace', async () => ({ ...await vi.importActual<typeof import('@/lib/payments/marketplace')>('@/lib/payments/marketplace'), exchangeMarketplaceToken: mocks.exchange, mercadoPagoRequest: mocks.request }));
import { POST as start } from '@/app/api/auth/mercadopago/start/route';
import { GET as finish } from '@/app/api/auth/mercadopago/callback/route';
let app: App; let db: Firestore;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  app = initializeApp({ projectId: 'pediturno-oauth-it' }, 'oauth-it'); db = getFirestore(app);
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  vi.stubEnv('MP_MARKETPLACE_APP_ID', '123'); vi.stubEnv('MP_MARKETPLACE_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('BOOKING_CAPABILITY_OUTBOX_KEY', Buffer.alloc(32, 4).toString('base64'));
  mocks.db.mockReturnValue(db);
  mocks.exchange.mockResolvedValue({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user_id: 555, live_mode: false, expires_in: 3600 });
  mocks.request.mockResolvedValue({ id: 555, site_id: 'MLA' });
  await db.doc('businesses/owner').set({ name: 'Prueba', status: 'active', businessType: 'sports_facility', membership: { type: 'lifetime' } });
});
afterAll(async () => { vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });
async function begin() {
  const response = await start(new NextRequest('https://canchas.pediturno.com/api/auth/mercadopago/start', { method: 'POST', headers: { authorization: `Bearer ${'synthetic'.repeat(16)}` } }));
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('Domain=.pediturno.com');
  const url = new URL((await response.json()).url);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  return url.searchParams.get('state')!;
}
const callback = (state: string, query = 'code=synthetic-code') => new NextRequest(`https://pediturno.com/api/auth/mercadopago/callback?state=${state}&${query}`, { headers: { cookie: `mp_oauth_state=${state}` } });
describe('marketplace OAuth boundaries', () => {
  it('keeps tokens encrypted, consumes state once, and returns a court owner to their portal', async () => {
    const state = await begin();
    expect((await db.doc(`oauthStates/${state}`).get()).get('verifier')).toBeUndefined();
    expect((await finish(callback(state))).headers.get('location')).toBe('https://canchas.pediturno.com/dashboard/ajustes?mp_status=connected');
    const connection = (await db.doc('mercadoPagoConnections/owner').get()).data()!;
    expect(connection.encryptedAccessToken.ciphertext).toBeTruthy(); expect(connection.accessToken).toBeUndefined();
    expect((await db.doc(`oauthStates/${state}`).get()).get('encryptedVerifier')).toBeUndefined();
    expect((await finish(callback(state))).headers.get('location')).toContain('mp_error=connection_failed');
    expect(mocks.exchange).toHaveBeenCalledOnce();
  });
  it('rejects a previously issued OAuth state when the business is now Servicios', async () => {
    const state = await begin();
    await db.doc('businesses/owner').update({ businessType: 'services' });
    const response = await finish(callback(state));
    expect(response.headers.get('location')).toContain('mp_error=connection_failed');
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect((await db.doc('businesses/owner').get()).get('mercadopago.isConnected')).toBeUndefined();
    expect((await db.doc(`oauthStates/${state}`).get()).get('usedAt')).toBeUndefined();
  });
  it.each(['MLB', 'MLC', 'MLM'])('rejects a %s seller while deposits are limited to Argentina', async site => {
    const state = await begin();
    mocks.request.mockResolvedValue({ id: 555, site_id: site });
    expect((await finish(callback(state))).headers.get('location')).toContain('mp_error=invalid_seller');
    expect((await db.doc('mercadoPagoConnections/owner').get()).exists).toBe(false);
    expect((await db.doc('businesses/owner').get()).get('mercadopago.isConnected')).toBeUndefined();
  });
  it('returns a denied space authorization to the spaces portal without exchanging tokens', async () => {
    await db.doc('businesses/owner').update({ businessType: 'spaces' });
    const state = await begin();
    expect((await finish(callback(state, 'error=access_denied'))).headers.get('location')).toBe('https://espacios.pediturno.com/dashboard/ajustes?mp_error=authorization_denied');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it('rejects a callback that lacks the browser state cookie', async () => {
    const state = await begin();
    const response = await finish(new NextRequest(`https://pediturno.com/api/auth/mercadopago/callback?state=${state}&code=synthetic-code`));
    expect(response.headers.get('location')).toContain('mp_error=invalid_state');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
