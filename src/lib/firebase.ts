import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getAuth, connectAuthEmulator, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getStorage, connectStorageEmulator, type FirebaseStorage } from "firebase/storage";
import type { AppCheck } from "firebase/app-check";
import { ensureRecaptchaEnterpriseLoaded } from "@/lib/recaptcha-enterprise-loader";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "pediturno-app.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Legacy server action imports; these values are never NEXT_PUBLIC variables.
export const gcloudPrivateKeyBase64 = process.env.GCLOUD_PRIVATE_KEY_BASE64;
export const gcloudClientEmail = process.env.GCLOUD_CLIENT_EMAIL;

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;
export let clientAppCheck: AppCheck | null = null;
let initialized = false;
let initialization: Promise<void> | null = null;
const isConfigValid = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';

if (useEmulators && (process.env.NODE_ENV === 'production'
    || !firebaseConfig.projectId?.startsWith('demo-')
    || !['127.0.0.1', 'localhost'].includes(emulatorHost))) {
  throw new Error('Firebase emulators are restricted to local demo projects.');
}

function initializeServices(): void {
  if (initialized || !app) return;
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
  if (useEmulators) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
    connectStorageEmulator(storage, emulatorHost, 9199);
  }
  initialized = true;
}

async function prepareAppCheck(): Promise<void> {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!app || !siteKey) throw new Error('App Check is not configured');
  await ensureRecaptchaEnterpriseLoaded();
  const { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } = await import('firebase/app-check');
  clientAppCheck ??= initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const result = await getToken(clientAppCheck);
  if (!result.token) throw new Error('App Check token unavailable');
}

/**
 * Auth restores persisted sessions as soon as getAuth runs. Attestation must be
 * ready first, including on a hard reload. A failed/slow attestation therefore
 * leaves Auth and its persisted session untouched, with an explicit UI retry.
 * Start only when authentication or a protected public request is needed.
 */
export function ensureFirebaseReady(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!app) return Promise.reject(new Error('Firebase is not configured'));
  if (initialization) return initialization;
  const attempt = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        prepareAppCheck(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out preparing App Check')), 30_000);
        }),
      ]);
      // This is deliberately outside prepareAppCheck: a late token after a
      // timeout may populate the cache, but must not silently start Auth.
      initializeServices();
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  initialization = attempt;
  void attempt.catch(() => { if (initialization === attempt) initialization = null; });
  return attempt;
}

if (isConfigValid) {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  if (typeof window === 'undefined' || useEmulators) initializeServices();
}

export { app, db, auth, storage, isConfigValid, GoogleAuthProvider };
