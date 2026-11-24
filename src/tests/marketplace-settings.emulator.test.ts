import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ db: vi.fn(), seller: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('@/lib/payments/auth', () => ({ requireFirebaseUser: vi.fn(async () => ({ uid: 'owner' })) }));
vi.mock('@/lib/payments/deposits', () => ({ depositsAvailable: () => true }));
vi.mock('@/lib/payments/marketplace', () => ({ getSellerConnection: mocks.seller }));
import { updateMercadoPagoSettings } from '@/services/mercadopago';
let app: App; let db: Firestore;
const settings = { requireDeposit: true, depositType: 'fixed' as const, depositValue: 90 };
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  app = initializeApp({ projectId: 'pediturno-settings-it' }, 'settings-it'); db = getFirestore(app);
});
beforeEach(async () => {
  vi.stubEnv('MP_MARKETPLACE_EXPECT_LIVE_MODE', 'true'); mocks.db.mockReturnValue(db);
  mocks.seller.mockResolvedValue({ merchantUserId: '555', liveMode: true });
  await db.doc('businesses/owner').set({ status: 'active', businessType: 'services', membership: null });
  await db.doc('mercadoPagoConnections/owner').set({ active: true, merchantUserId: '555', encryptedAccessToken: { ciphertext: 'synthetic' } });
});
afterAll(async () => { vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });
it('rejects new Servicios deposits and still allows disabling old settings without granting Pro', async () => {
  expect((await updateMercadoPagoSettings('synthetic', settings)).success).toBe(false);
  expect((await db.doc('businesses/owner').get()).get('mercadopago.requireDeposit')).toBeUndefined();
  expect((await db.doc('businesses/owner').get()).get('membership')).toBeNull();
  expect((await updateMercadoPagoSettings('synthetic', { ...settings, requireDeposit: false })).success).toBe(true);
  expect((await db.doc('businesses/owner').get()).get('mercadopago.requireDeposit')).toBe(false);
});
it.each(['sports_facility', 'spaces'])('preserves membership requirements for %s', async businessType => {
  await db.doc('businesses/owner').update({ businessType });
  expect((await updateMercadoPagoSettings('synthetic', settings)).success).toBe(false);
  await db.doc('businesses/owner').update({ membership: { type: 'lifetime' } });
  expect((await updateMercadoPagoSettings('synthetic', settings)).success).toBe(true);
});
it.each(['inactive', 'wrong-seller', 'wrong-mode', 'disabled-business'])('rejects an invalid seller/business boundary: %s', async boundary => {
  if (boundary === 'inactive') await db.doc('mercadoPagoConnections/owner').update({ active: false });
  if (boundary === 'wrong-seller') mocks.seller.mockResolvedValue({ merchantUserId: 'other', liveMode: true });
  if (boundary === 'wrong-mode') mocks.seller.mockResolvedValue({ merchantUserId: '555', liveMode: false });
  if (boundary === 'disabled-business') await db.doc('businesses/owner').update({ status: 'disabled' });
  expect((await updateMercadoPagoSettings('synthetic', settings)).success).toBe(false);
  expect((await db.doc('businesses/owner').get()).get('mercadopago.requireDeposit')).toBeUndefined();
});
