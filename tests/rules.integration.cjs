/* eslint-disable no-console */
// Runs only through `firebase emulators:exec`; it never contacts production.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const grantId = objectPath => crypto.createHash('sha256').update('synthetic-rules-grant:' + objectPath).digest('hex');
const permittedMetadata = objectPath => ({ contentType: 'image/webp', customMetadata: { imagePermitId: grantId(objectPath) } });
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} = require('firebase/firestore');

const root = path.resolve(__dirname, '..');
// `emulators:exec` supplies the configured Firebase project. Storage rules
// resolve Firestore documents in that same project, so the test environment
// must not use an unrelated hard-coded project ID.
const projectId = process.env.GCLOUD_PROJECT || 'demo-pediturno-audit';
const activeMembership = {
  status: 'active',
  membership: { type: 'lifetime' },
  name: 'Owner',
};

function check(name, assertion) {
  return assertion.then(() => console.log(`PASS ${name}`));
}

async function main() {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
  const [storageHost, storagePort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST || '').split(':');
  if (!projectId.startsWith('demo-') || !['127.0.0.1','localhost'].includes(host) || !['127.0.0.1','localhost'].includes(storageHost)) throw Error('Owned demo emulators required');
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
    storage: { host: storageHost, port: Number(storagePort), rules: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8') },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const paths = ['businesses/owner/logos/logo.webp','businesses/owner/spaces/salon.webp',...['play','play-sports','play-revoked','play-forged'].map(id => `businesses/${id}/logos/logo.webp`)];
      await Promise.all(paths.map(objectPath => setDoc(doc(db,'bookingRateLimits','image-permit-v1_' + grantId(objectPath)), {
        kind: 'image-upload-permit', businessId: objectPath.split('/')[1], category: objectPath.split('/')[2],
        status: 'pending', expiresAt: new Date(Date.now() + 600000), byteSize: 5, contentType: 'image/webp', objectPath,
      })));
      await Promise.all([
        setDoc(doc(db, 'businesses', 'owner'), activeMembership),
        setDoc(doc(db, 'businesses', 'other'), { ...activeMembership, name: 'Other' }),
        setDoc(doc(db, 'businesses', 'expired'), {
          status: 'active',
          businessType: 'sports_facility', membership: { type: 'trial', expiresAt: new Date('2020-01-01T00:00:00Z') },
        }),
        setDoc(doc(db, 'businesses', 'deleting'), { ...activeMembership, status: 'deleting' }),
        ...['play', 'play-sports', 'play-revoked', 'play-forged'].map(id => setDoc(doc(db, 'businesses', id), {
          status: 'active', businessType: id === 'play-sports' ? 'sports_facility' : 'services',
          googlePlayMembership: {
            type: 'pro', source: 'GOOGLE_PLAY', productId: 'pediturno_servicios_pro_monthly',
            purchaseHash: id === 'play-forged' ? '' : 'a'.repeat(64),
            status: id === 'play-revoked' ? 'revoked' : 'active', expiresAt: new Date(Date.now() + 86400000),
          },
        })),
        setDoc(doc(db, 'googlePlayPurchases', 'fixture'), { uid: 'play', purchaseToken: 'synthetic-not-a-secret' }),
        setDoc(doc(db, 'services', 'owner-service'), { businessId: 'owner', name: 'Consultation' }),
        setDoc(doc(db, 'services', 'other-service'), { businessId: 'other', name: 'Other service' }),
        setDoc(doc(db, 'spaces', 'owner-space'), { businessId: 'owner', name: 'Salón' }),
        setDoc(doc(db, 'appointments', 'owner-appointment'), {
          businessId: 'owner', client: 'Private client', date: new Date(), time: '10:00', status: 'Confirmado',
        }),
        setDoc(doc(db, 'clients', 'owner-client'), {
          businessId: 'owner', name: 'Private client', phone: '111111',
        }),
        setDoc(doc(db, 'clients', 'legacy-client'), {
          businessId: 'owner', name: 'Legacy client', phone: '', serverMetadata: 'keep',
        }),
        setDoc(doc(db, 'paymentOrders', 'order-1'), { businessId: 'owner', amount: 4000 }),
        setDoc(doc(db, 'mercadoPagoConnections', 'owner'), { accessToken: 'server-only' }),
        setDoc(doc(db, 'pushSubscriptions', 'push-1'), { userId: 'owner' }),
        setDoc(doc(db, 'bookingSlots', 'slot-1'), { businessId: 'owner' }),
        setDoc(doc(db, 'bookingCapabilities', 'capability-1'), { businessId: 'owner' }),
        setDoc(doc(db, 'bookingEmailOutbox', 'message-1'), { businessId: 'owner' }),
        setDoc(doc(db, 'depositOrders', 'deposit-1'), { businessId: 'owner', amount: 300 }),
        setDoc(doc(db, 'depositPayments', 'receipt-1'), { businessId: 'owner', status: 'approved' }),
      ]);
    });

    const owner = testEnv.authenticatedContext('owner');
    const other = testEnv.authenticatedContext('other');
    const expired = testEnv.authenticatedContext('expired');
    const deleting = testEnv.authenticatedContext('deleting');
    const anonymous = testEnv.unauthenticatedContext();
    const ownerDb = owner.firestore();
    const otherDb = other.firestore();
    const expiredDb = expired.firestore();
    const deletingDb = deleting.firestore();
    const anonymousDb = anonymous.firestore();

    await check('anonymous cannot read a business profile', assertFails(getDoc(doc(anonymousDb, 'businesses', 'owner'))));
    await check('direct SDK denied: owner can read own profile', assertFails(getDoc(doc(ownerDb, 'businesses', 'owner'))));
    await check('cross-tenant profile read is denied', assertFails(getDoc(doc(otherDb, 'businesses', 'owner'))));
    await check('owner cannot change profile fields directly', assertFails(updateDoc(doc(ownerDb, 'businesses', 'owner'), { name: 'Updated' })));
    await check('owner cannot change slug directly', assertFails(updateDoc(doc(ownerDb, 'businesses', 'owner'), { slug: 'takeover-attempt' })));
    await check('owner cannot self-upgrade membership', assertFails(updateDoc(doc(ownerDb, 'businesses', 'owner'), { membership: { type: 'pro', expiresAt: new Date('2099-01-01T00:00:00Z') } })));
    await check('owner cannot unblock own account', assertFails(updateDoc(doc(ownerDb, 'businesses', 'owner'), { status: 'blocked' })));
    await check('browser cannot bootstrap a business profile', assertFails(setDoc(doc(ownerDb, 'businesses', 'new-business'), activeMembership)));

    await check('direct SDK denied: owner can query only own services', assertFails(getDocs(query(collection(ownerDb, 'services'), where('businessId', '==', 'owner')))));
    await check('cross-tenant service read is denied', assertFails(getDoc(doc(otherDb, 'services', 'owner-service'))));
    await check('owner cannot create services directly outside the validated owner route', assertFails(setDoc(doc(ownerDb, 'services', 'new-service'), { businessId: 'owner', name: 'New' })));
    await check('owner cannot move service to another tenant', assertFails(updateDoc(doc(ownerDb, 'services', 'owner-service'), { businessId: 'other' })));
    await check('owner cannot create courts directly outside the validated owner route', assertFails(setDoc(doc(ownerDb, 'canchas', 'new-court'), { businessId: 'owner', name: 'Court' })));
    await check('direct SDK denied: owner can read own space', assertFails(getDoc(doc(ownerDb, 'spaces', 'owner-space'))));
    await check('cross-tenant space read is denied', assertFails(getDoc(doc(otherDb, 'spaces', 'owner-space'))));
    await check('browser cannot create spaces directly outside the validated owner route', assertFails(setDoc(doc(ownerDb, 'spaces', 'new-space'), { businessId: 'owner', name: 'Salón nuevo' })));
    await check('expired membership cannot create premium resource', assertFails(setDoc(doc(expiredDb, 'services', 'expired-service'), { businessId: 'expired', name: 'Blocked' })));
    await check('deleting business cannot create premium resource', assertFails(setDoc(doc(deletingDb, 'services', 'deleting-service'), { businessId: 'deleting', name: 'Blocked' })));

    await check('direct SDK denied: owner can read own appointment', assertFails(getDoc(doc(ownerDb, 'appointments', 'owner-appointment'))));
    await check('cross-tenant appointment read is denied', assertFails(getDoc(doc(otherDb, 'appointments', 'owner-appointment'))));
    await check('owner cannot update appointment status directly', assertFails(updateDoc(doc(ownerDb, 'appointments', 'owner-appointment'), { status: 'Completado' })));
    await check('owner cannot rewrite appointment PII', assertFails(updateDoc(doc(ownerDb, 'appointments', 'owner-appointment'), { client: 'Changed' })));
    await check('owner cannot create an appointment directly', assertFails(setDoc(doc(ownerDb, 'appointments', 'manual-owner'), {
      businessId: 'owner', client: 'Manual client', clientPhone: '111111', clientId: 'manual-client',
      date: new Date(), time: '11:00', status: 'Confirmado', avatar: '',
    })));
    await check('owner cannot create an appointment in another agenda', assertFails(setDoc(doc(ownerDb, 'appointments', 'cross-tenant-bypass'), {
      businessId: 'other', client: 'Cross tenant', clientPhone: '111111', clientId: 'cross-client',
      date: new Date(), time: '11:00', status: 'Confirmado', avatar: '',
    })));

    await check('direct SDK denied: owner can read own client', assertFails(getDoc(doc(ownerDb, 'clients', 'owner-client'))));
    await check('cross-tenant client read is denied', assertFails(getDoc(doc(otherDb, 'clients', 'owner-client'))));
    await check('direct SDK denied: active owner can create a manual client in its own tenant', assertFails(setDoc(doc(ownerDb, 'clients', 'manual-client'), { businessId: 'owner', name: 'Manual client', phone: '111111' })));
    await check('direct SDK denied: owner can edit client name and avatar', assertFails(updateDoc(doc(ownerDb, 'clients', 'manual-client'), { name: 'Edited client', avatar: '' })));
    await check('direct SDK denied: client edits preserve unchanged legacy fields', assertFails(updateDoc(doc(ownerDb, 'clients', 'legacy-client'), { name: 'Edited legacy client' })));
    await check('client edits cannot add arbitrary fields', assertFails(updateDoc(doc(ownerDb, 'clients', 'manual-client'), { privileged: true })));
    await check('client edits cannot forge booking history', assertFails(updateDoc(doc(ownerDb, 'clients', 'manual-client'), { lastAppointment: new Date() })));
    await check('client edits enforce field lengths', assertFails(updateDoc(doc(ownerDb, 'clients', 'manual-client'), { name: 'x'.repeat(121) })));
    await check('client creation rejects invalid optional data', assertFails(setDoc(doc(ownerDb, 'clients', 'invalid-client'), { businessId: 'owner', name: 'Client', phone: '111111', email: { unexpected: true } })));
    await check('owner cannot create a client in another tenant', assertFails(setDoc(doc(ownerDb, 'clients', 'cross-tenant-client'), { businessId: 'other', name: 'Cross tenant', phone: '111111' })));

    await check('payment orders are private even to the owner browser', assertFails(getDoc(doc(ownerDb, 'paymentOrders', 'order-1'))));
    await check('deposit orders are private even to the owner browser', assertFails(getDoc(doc(ownerDb, 'depositOrders', 'deposit-1'))));
    await check('deposit receipts cannot be read directly', assertFails(getDoc(doc(ownerDb, 'depositPayments', 'receipt-1'))));
    await check('browser cannot forge a paid deposit', assertFails(setDoc(doc(ownerDb, 'depositPayments', 'forged'), { businessId: 'owner', status: 'approved' })));
    await check('Mercado Pago tokens are private even to the owner browser', assertFails(getDoc(doc(ownerDb, 'mercadoPagoConnections', 'owner'))));
    await check('push subscriptions have no direct SDK access', assertFails(getDoc(doc(ownerDb, 'pushSubscriptions', 'push-1'))));
    await check('booking slots have no direct SDK access', assertFails(getDoc(doc(ownerDb, 'bookingSlots', 'slot-1'))));
    await check('booking capabilities have no direct SDK access', assertFails(getDoc(doc(ownerDb, 'bookingCapabilities', 'capability-1'))));
    await check('booking email capability records have no direct SDK access', assertFails(getDoc(doc(ownerDb, 'bookingEmailOutbox', 'message-1'))));

    const ownerStorage = owner.storage();
    const play = testEnv.authenticatedContext('play');
    await check('direct SDK denied: verified Play Services membership permits client creation', assertFails(setDoc(doc(play.firestore(), 'clients', 'play-client'), { businessId: 'play', name: 'Sample', phone: '123456' })));
    await check('Play purchase ledger is inaccessible to its owner SDK', assertFails(getDoc(doc(play.firestore(), 'googlePlayPurchases', 'fixture'))));
    await check('verified Play Services membership permits image upload', assertSucceeds(play.storage().ref('businesses/play/logos/logo.webp').putString('image', 'raw', permittedMetadata('businesses/play/logos/logo.webp'))));
    for (const id of ['play-sports', 'play-revoked', 'play-forged']) {
      const context = testEnv.authenticatedContext(id);
      await check(`${id} direct client SDK write is denied`, assertFails(setDoc(doc(context.firestore(), 'clients', `${id}-client`), { businessId: id, name: 'Sample', phone: '123456' })));
      await check(`${id} image access respects vertical Gratis policy`, (id === 'play-sports' ? assertFails : assertSucceeds)(context.storage().ref(`businesses/${id}/logos/logo.webp`).putString('image', 'raw', permittedMetadata(`businesses/${id}/logos/logo.webp`))));
    }
    const otherStorage = other.storage();
    const expiredStorage = expired.storage();
    const deletingStorage = deleting.storage();
    await check('owner can upload a tenant-scoped image', assertSucceeds(ownerStorage.ref('businesses/owner/logos/logo.webp').putString('image', 'raw', permittedMetadata('businesses/owner/logos/logo.webp'))));
    await check('owner can upload a space image', assertSucceeds(ownerStorage.ref('businesses/owner/spaces/salon.webp').putString('image', 'raw', permittedMetadata('businesses/owner/spaces/salon.webp'))));
    await check('cross-tenant space image upload is denied', assertFails(otherStorage.ref('businesses/owner/spaces/other.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    await check('expired membership cannot upload an asset', assertFails(expiredStorage.ref('businesses/expired/logos/expired.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    const expiredAdminStorage = testEnv.authenticatedContext('expired', { email: 'admin@example.com', email_verified: true }).storage();
    await check('an admin email cannot bypass a missing persisted entitlement', assertFails(expiredAdminStorage.ref('businesses/expired/logos/admin.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    await check('deleting business cannot upload an asset', assertFails(deletingStorage.ref('businesses/deleting/logos/deleting.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    await check('cross-tenant asset upload is denied', assertFails(otherStorage.ref('businesses/owner/logos/other.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    await check('legacy global asset path is denied', assertFails(ownerStorage.ref('logos/legacy.webp').putString('image', 'raw', { contentType: 'image/webp' })));
    await check('non-image asset upload is denied', assertFails(ownerStorage.ref('businesses/owner/logos/not-image.txt').putString('no', 'raw', { contentType: 'text/plain' })));
    await check('SVG upload is denied', assertFails(ownerStorage.ref('businesses/owner/logos/active.svg').putString('<svg/>', 'raw', { contentType: 'image/svg+xml' })));
    await check('oversized image upload is denied', assertFails(ownerStorage.ref('businesses/owner/logos/too-large.webp').putString('x'.repeat(2 * 1024 * 1024 + 1), 'raw', { contentType: 'image/webp' })));
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
