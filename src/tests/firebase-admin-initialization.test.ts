import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ cert: vi.fn(), getApp: vi.fn(), getApps: vi.fn(), initializeApp: vi.fn(), getFirestore: vi.fn() }));
vi.mock('firebase-admin/app', () => sdk);
vi.mock('firebase-admin/firestore', () => ({ getFirestore: sdk.getFirestore }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-pediturno-audit');
  vi.stubEnv('GCLOUD_CLIENT_EMAIL', 'test@example.invalid');
  vi.stubEnv('GCLOUD_PRIVATE_KEY_BASE64', Buffer.from('test-private-key').toString('base64'));
  sdk.getApps.mockReturnValue([]);
  sdk.cert.mockReturnValue({ testCredential: true });
  sdk.initializeApp.mockReturnValue({ name: '[DEFAULT]' });
});
afterEach(() => vi.unstubAllEnvs());

describe('modular Firebase Admin initialization', () => {
  it('initializes once with a decoded server credential', async () => {
    const { initializeAdminApp } = await import('@/lib/firebase-admin');
    expect(initializeAdminApp()).toBe(initializeAdminApp());
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.cert).toHaveBeenCalledWith({ projectId: 'demo-pediturno-audit', clientEmail: 'test@example.invalid', privateKey: 'test-private-key' });
  });
  it('reuses the existing default application', async () => {
    const app = { name: '[DEFAULT]' }; sdk.getApps.mockReturnValue([app]); sdk.getApp.mockReturnValue(app);
    const { initializeAdminApp } = await import('@/lib/firebase-admin');
    expect(initializeAdminApp()).toBe(app);
    expect(sdk.cert).not.toHaveBeenCalled();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });
  it('fails closed when server credentials are missing', async () => {
    vi.stubEnv('GCLOUD_PRIVATE_KEY_BASE64', '');
    const { initializeAdminApp } = await import('@/lib/firebase-admin');
    expect(() => initializeAdminApp()).toThrow('credentials are not set');
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });
  it('binds Firestore to the initialized application', async () => {
    const db = { testDatabase: true }; sdk.getFirestore.mockReturnValue(db);
    const { getAdminFirestore } = await import('@/lib/firebase-admin');
    expect(getAdminFirestore()).toBe(db);
    expect(sdk.getFirestore).toHaveBeenCalledWith({ name: '[DEFAULT]' });
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
  });
});
