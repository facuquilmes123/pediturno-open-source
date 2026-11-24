import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  app: { name: 'test' }, auth: { currentUser: null }, db: {}, storage: {}, appCheck: {},
  getAuth: vi.fn(), getFirestore: vi.fn(), getStorage: vi.fn(),
  connectAuth: vi.fn(), connectFirestore: vi.fn(), connectStorage: vi.fn(),
  loader: vi.fn(), initializeAppCheck: vi.fn(), getToken: vi.fn(), getLimitedUseToken: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => sdk.app, getApps: () => [], getApp: () => sdk.app }));
vi.mock('firebase/auth', () => ({ getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuth, GoogleAuthProvider: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getFirestore: sdk.getFirestore, connectFirestoreEmulator: sdk.connectFirestore }));
vi.mock('firebase/storage', () => ({ getStorage: sdk.getStorage, connectStorageEmulator: sdk.connectStorage }));
vi.mock('firebase/app-check', () => ({ initializeAppCheck: sdk.initializeAppCheck,
  ReCaptchaEnterpriseProvider: vi.fn(), getToken: sdk.getToken, getLimitedUseToken: sdk.getLimitedUseToken }));
vi.mock('@/lib/recaptcha-enterprise-loader', () => ({ ensureRecaptchaEnterpriseLoaded: sdk.loader }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'synthetic-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-bootstrap');
  vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY', 'synthetic-site-key');
  vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'false');
  vi.stubEnv('NEXT_PUBLIC_ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS', 'false');
  sdk.getAuth.mockReturnValue(sdk.auth); sdk.getFirestore.mockReturnValue(sdk.db); sdk.getStorage.mockReturnValue(sdk.storage);
  sdk.loader.mockResolvedValue(undefined); sdk.initializeAppCheck.mockReturnValue(sdk.appCheck);
  sdk.getToken.mockResolvedValue({ token: 'regular-token' });
  sdk.getLimitedUseToken.mockResolvedValue({ token: 'limited-token' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear(); });

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

describe('browser Firebase initialization', () => {
  it('does not start Auth or attestation just by importing the module', async () => {
    const subject = await import('@/lib/firebase');
    expect(subject.app).toBe(sdk.app); expect(subject.auth).toBeNull();
    expect(sdk.loader).not.toHaveBeenCalled(); expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it('shares initialization and waits for both the alternate loader and token before Auth', async () => {
    const loader = deferred<void>(); const token = deferred<{ token: string }>();
    sdk.loader.mockReturnValue(loader.promise); sdk.getToken.mockReturnValue(token.promise);
    const subject = await import('@/lib/firebase');
    const first = subject.ensureFirebaseReady(); const second = subject.ensureFirebaseReady();
    expect(first).toBe(second); expect(sdk.getAuth).not.toHaveBeenCalled();
    loader.resolve();
    await vi.waitFor(() => expect(sdk.getToken).toHaveBeenCalledOnce());
    expect(sdk.getAuth).not.toHaveBeenCalled();
    token.resolve({ token: 'attested' }); await first;
    expect(subject.auth).toBe(sdk.auth); expect(subject.clientAppCheck).toBe(sdk.appCheck);
    expect(sdk.getToken.mock.invocationCallOrder[0]).toBeLessThan(sdk.getAuth.mock.invocationCallOrder[0]);
    await subject.ensureFirebaseReady();
    expect(sdk.getAuth).toHaveBeenCalledOnce(); expect(sdk.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it('keeps Auth and the stored session untouched on attestation failure, then retries', async () => {
    localStorage.setItem('synthetic-persisted-session', 'preserved');
    sdk.getToken.mockRejectedValueOnce(new Error('provider unavailable'));
    const subject = await import('@/lib/firebase');
    await expect(subject.ensureFirebaseReady()).rejects.toThrow('provider unavailable');
    expect(subject.auth).toBeNull(); expect(sdk.getAuth).not.toHaveBeenCalled();
    expect(localStorage.getItem('synthetic-persisted-session')).toBe('preserved');
    await subject.ensureFirebaseReady();
    expect(subject.auth).toBe(sdk.auth); expect(sdk.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it('does not start Auth when a timed-out token arrives late', async () => {
    vi.useFakeTimers(); const token = deferred<{ token: string }>(); sdk.getToken.mockReturnValue(token.promise);
    const subject = await import('@/lib/firebase');
    const result = subject.ensureFirebaseReady().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatch(/Timed out/);
    token.resolve({ token: 'late' }); await vi.advanceTimersByTimeAsync(0);
    expect(sdk.getAuth).not.toHaveBeenCalled();
    sdk.getToken.mockResolvedValue({ token: 'fresh' });
    await subject.ensureFirebaseReady(); expect(sdk.getAuth).toHaveBeenCalledOnce();
  });

  it('does not silently disable protection when the site key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY', '');
    const subject = await import('@/lib/firebase');
    await expect(subject.ensureFirebaseReady()).rejects.toThrow('not configured');
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it('keeps SSR and local demo emulators independent from browser attestation', async () => {
    vi.stubGlobal('window', undefined);
    const subject = await import('@/lib/firebase');
    await subject.ensureFirebaseReady(); expect(sdk.getAuth).toHaveBeenCalledOnce(); expect(sdk.loader).not.toHaveBeenCalled();
  });

  it('connects only explicitly enabled loopback demo emulators', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_HOST', '127.0.0.1');
    const subject = await import('@/lib/firebase'); await subject.ensureFirebaseReady();
    expect(sdk.connectAuth).toHaveBeenCalledWith(sdk.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    expect(sdk.connectFirestore).toHaveBeenCalledWith(sdk.db, '127.0.0.1', 8080);
    expect(sdk.connectStorage).toHaveBeenCalledWith(sdk.storage, '127.0.0.1', 9199);
    expect(sdk.loader).not.toHaveBeenCalled();
  });

  it('rejects emulator routing to real projects before creating any services', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'real-project');
    await expect(import('@/lib/firebase')).rejects.toThrow('local demo projects');
    expect(sdk.getAuth).not.toHaveBeenCalled();
  });

  it('obtains a fresh limited-use token per consumed public request', async () => {
    sdk.getLimitedUseToken.mockResolvedValueOnce({ token: 'limited-1' }).mockResolvedValueOnce({ token: 'limited-2' });
    const { publicAppCheckHeaders } = await import('@/lib/app-check-client');
    expect(await publicAppCheckHeaders({ consume: true })).toEqual({ 'X-Firebase-AppCheck': 'limited-1' });
    expect(await publicAppCheckHeaders({ consume: true })).toEqual({ 'X-Firebase-AppCheck': 'limited-2' });
    expect(await publicAppCheckHeaders()).toEqual({ 'X-Firebase-AppCheck': 'regular-token' });
    expect(sdk.getLimitedUseToken).toHaveBeenCalledTimes(2);
    expect(sdk.getAuth).toHaveBeenCalledOnce();
  });
});
