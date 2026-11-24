import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCredential, GoogleAuthProvider,
  signOut, sendEmailVerification, sendPasswordResetEmail, updateProfile, reload, applyActionCode, checkActionCode, verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';

const port = process.env.PEDITURNO_AUTH_TEST_PORT;
describe.skipIf(!port)('real Firebase SDK against isolated Auth emulator', () => {
  const requests: Array<{ path: string; attested: boolean }> = [];
  let subject: typeof import('@/lib/firebase');
  const nativeFetch = globalThis.fetch;
  const project = 'demo-pediturno-auth-p103';
  const token = ['eyJhbGciOiJub25lIn0', Buffer.from(JSON.stringify({ iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, sub: 'synthetic-app-check' })).toString('base64url'), 'synthetic'].join('.');
  beforeAll(async () => {
    expect(process.env.PEDITURNO_AUTH_NETWORK_GUARD).toBe('active');
    if (!port || !/^\d+$/.test(port)) throw new Error('Missing isolated Auth emulator port');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'synthetic-key');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', project);
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'synthetic-app');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', project+'.appspot.com');
    vi.stubEnv('NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY', 'synthetic-site-key');
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'false');
    let solved: (() => void) | undefined;
    // Only the attestation provider boundary is simulated. Auth and App Check
    // are the installed, unmocked Firebase SDK; account operations hit the
    // actual official in-memory emulator. No Google/provider acceptance claim.
    vi.stubGlobal('grecaptcha', { enterprise: {
      ready(callback: () => void) { callback(); },
      render(_element: unknown, options: { callback: () => void }) { solved=options.callback; return 1; },
      execute() { solved?.(); return Promise.resolve('synthetic-recaptcha-response'); },
    }});
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'content-firebaseappcheck.googleapis.com' && url.pathname.includes(':exchangeRecaptchaEnterpriseToken')) {
        return new Response(JSON.stringify({ token, ttl: '3600s' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.hostname !== '127.0.0.1' || url.port !== port) throw new Error('External network denied in Auth integration');
      requests.push({ path: url.pathname, attested: new Headers(init?.headers).get('X-Firebase-AppCheck') === token });
      return nativeFetch(input, init);
    });
    subject = await import('@/lib/firebase');
    expect(subject.auth).toBeNull();
    await subject.ensureFirebaseReady();
    if (!subject.auth) throw new Error('Auth was not initialized');
    connectAuthEmulator(subject.auth, 'http://127.0.0.1:'+port, { disableWarnings: true });
    await subject.auth.authStateReady();
  }, 15000);

  afterAll(async () => { if (subject?.app) await deleteApp(subject.app); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('attaches App Check to signup, account lookup/update, password and Google credential exchange, token refresh, email verification and completed password reset', async () => {
    const auth = subject.auth!;
    const cred = await createUserWithEmailAndPassword(auth, 'synthetic-owner@example.test', 'Only-Emulator-123!');
    await updateProfile(cred.user, { displayName: 'Synthetic owner' });
    await reload(cred.user);
    await sendEmailVerification(cred.user);
    await sendPasswordResetEmail(auth, 'synthetic-owner@example.test');
    const actions = await (await nativeFetch('http://127.0.0.1:'+port+'/emulator/v1/projects/'+project+'/oobCodes')).json() as { oobCodes: Array<{ requestType: string; oobCode: string }> };
    const verify = actions.oobCodes.find(row => row.requestType === 'VERIFY_EMAIL');
    const reset = actions.oobCodes.find(row => row.requestType === 'PASSWORD_RESET');
    expect(verify).toBeDefined(); expect(reset).toBeDefined();
    const verifiedInfo = await checkActionCode(auth, verify!.oobCode);
    expect(verifiedInfo.operation).toBe('VERIFY_EMAIL');
    expect(verifiedInfo.data.email).toBe('synthetic-owner@example.test');
    await applyActionCode(auth, verify!.oobCode);
    await reload(cred.user); expect(cred.user.emailVerified).toBe(true);
    expect(await verifyPasswordResetCode(auth, reset!.oobCode)).toBe('synthetic-owner@example.test');
    // Refresh before resetting: a password reset can revoke the old session.
    await cred.user.getIdToken(true);
    await confirmPasswordReset(auth, reset!.oobCode, 'New-Only-Emulator-123!');
    await signOut(auth);
    const restored = await signInWithEmailAndPassword(auth, 'synthetic-owner@example.test', 'New-Only-Emulator-123!');
    expect(restored.user.uid).toBe(cred.user.uid);
    await signOut(auth);
    // Official emulator accepts synthetic identity-provider credentials; this
    // exercises the real SDK request, not Google account/provider acceptance.
    const googleToken = ['eyJhbGciOiJub25lIn0', Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com', aud: 'synthetic-client', sub: 'synthetic-google-owner',
      email: 'synthetic-google@example.test', email_verified: true,
      iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    })).toString('base64url'), 'synthetic'].join('.');
    const google = await signInWithCredential(auth, GoogleAuthProvider.credential(googleToken));
    expect(google.user.email).toBe('synthetic-google@example.test');
    expect(google.user.providerData[0]?.providerId).toBe('google.com');
    const delivered = await (await nativeFetch('http://127.0.0.1:'+port+'/p103-trace')).json() as Array<{ path: string; attested: boolean; synthetic: boolean }>;
    requests.splice(0, requests.length, ...delivered.map(row => ({ path: row.path, attested: row.attested && row.synthetic })));
    for (const operation of ['accounts:signUp', 'accounts:update', 'accounts:lookup', 'accounts:sendOobCode', 'accounts:signInWithPassword', 'accounts:signInWithIdp', 'accounts:resetPassword', '/token']) {
      const matching = requests.filter(row => row.path.includes(operation));
      expect(matching.length, operation+' was actually requested').toBeGreaterThan(0);
      expect(matching.every(row => row.attested), operation+' App Check header').toBe(true);
    }
    expect(requests.filter(row => row.path.includes('accounts:sendOobCode'))).toHaveLength(2);
    expect(requests.filter(row => row.path.includes('accounts:resetPassword'))).toHaveLength(3);
  }, 15000);
});
