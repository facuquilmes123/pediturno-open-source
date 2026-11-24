
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID;
// These are assumed to be set in the environment.
const gcloudClientEmail = process.env.GCLOUD_CLIENT_EMAIL;
const gcloudPrivateKeyBase64 = process.env.GCLOUD_PRIVATE_KEY_BASE64;


// A cache to prevent re-initialization
let adminApp: App | null = null;

export function initializeAdminApp(): App {
    if (adminApp) {
        return adminApp;
    }

    if (getApps().length > 0) {
        adminApp = getApp();
        return adminApp;
    }

    const emulatorHosts = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST].filter(Boolean);
    if (emulatorHosts.length) {
        if (!projectId?.startsWith('demo-') || emulatorHosts.some(host => !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(host!))) {
            throw new Error('Emulators require an isolated demo project and loopback endpoints.');
        }
        adminApp = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
        return adminApp;
    }

    if (!gcloudPrivateKeyBase64 || !gcloudClientEmail || !projectId) {
        throw new Error('Firebase Admin SDK credentials are not set in server environment variables.');
    }

    // Decode the Base64 private key
    const privateKey = Buffer.from(gcloudPrivateKeyBase64, 'base64').toString('utf-8');

    adminApp = initializeApp({
        credential: cert({
            projectId,
            clientEmail: gcloudClientEmail,
            privateKey: privateKey,
        }),
    });
    
    return adminApp;
}

// Export a pre-initialized firestore instance for convenience
export function getAdminFirestore() {
    return getFirestore(initializeAdminApp());
}
