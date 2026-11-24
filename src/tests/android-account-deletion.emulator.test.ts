import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { processAndroidAccountDeletion, processPendingAndroidAccountDeletions, purgeMarketplaceCredentialsAfterFinancialClosure } from '@/lib/android-account-deletion';

let app: App; let db: Firestore; let sequence = 0;
const prefix = `it_android_deletion_${Date.now()}_`;
const created: Array<{ collection: string; id: string }> = [];
const seededOwners = new Set<string>();
const authOwners = new Set<string>();
const owner = () => `${prefix}${++sequence}`;
async function set(collection: string, id: string, value: Record<string, unknown>) { await db.collection(collection).doc(id).set(value); created.push({ collection, id }); }

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Existing Firestore/Auth emulators required');
  // Deletion includes bounded Storage cleanup; tests never fall through to a
  // configured bucket outside the existing local emulator.
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= 'demo-pediturno-audit.appspot.com';
  app = initializeApp({ projectId: 'demo-pediturno-audit' }); db = getFirestore(app);
});
afterAll(async () => {
  // Never clear collections globally: this cleanup addresses only fixture IDs.
  const grouped = new Map<string, string[]>();
  for (const row of created) grouped.set(row.collection, [...(grouped.get(row.collection) || []), row.id]);
  for (const [collection, ids] of grouped) {
    for (let offset = 0; offset < ids.length; offset += 400) {
      const batch = db.batch(); ids.slice(offset, offset + 400).forEach(id => batch.delete(db.collection(collection).doc(id)));
      await batch.commit().catch(() => undefined);
    }
  }
  await Promise.all([...seededOwners].map(id => {
    return Promise.all([
      db.doc(`businessDeletions/${id}`).delete().catch(() => undefined),
      db.doc(`accountDeletionAudit/${id}_deleted`).delete().catch(() => undefined),
      db.doc(`accountDeletionAudit/${id}_financial_review_required`).delete().catch(() => undefined),
      getAuth().deleteUser(id).catch(() => undefined),
    ]);
  }));
  await Promise.all([...authOwners].map(id => getAuth().deleteUser(id).catch(() => undefined)));
  await db.doc('maintenanceJobs/account-deletion-batch-fairness').delete().catch(() => undefined);
  if (getApps().some(current => current.name === app.name)) { await db.terminate(); await deleteApp(app); }
});

async function seed(ownerId: string, appointments = 0) {
  seededOwners.add(ownerId);
  const requestId = randomUUID();
  await set('businesses', ownerId, {
    status: 'deletion_requested', name: 'Fixture', email: 'fixture@example.test', phone: '+5491111111111',
    address: { street: 'Calle privada', number: '123', city: 'Ciudad', province: 'BA', country: 'Argentina' },
    whatsappButtonEnabled: true, whatsappNumber: '+5491111111111', location: { lat: -34.6, lng: -58.4 },
    socialLinks: [{ id: 'private', type: 'website', url: 'https://private.example.test' }],
    bookingSettings: { notificationEmail: 'alerts@example.test', bookingLeadTimeHours: 2 }, deletionRequestId: requestId,
  });
  await set('accountDeletionRequests', ownerId, { requestId, ownerId, source: 'android', requestedAt: new Date(), status: 'deletion_requested', nextAttemptAt: new Date(0) });
  await getAuth().createUser({ uid: ownerId, email: `${ownerId}@example.test` }); authOwners.add(ownerId);
  for (let index = 0; index < appointments; index += 1) await set('appointments', `${ownerId}_appointment_${index}`, {
    businessId: ownerId, client: `Client ${index}`, clientPhone: '11111111', clientEmail: 'fixture@example.test',
    ...(index === 0 ? { notes: 'Private free text', internalNotes: 'Sensitive internal text' } : {}),
  });
}

describe('Android account deletion worker on shared emulator', () => {
  it.each(['initial scan', 'final transactional recheck'] as const)('finds a real Play ledger after 250 placeholders during %s', async stage => {
    const id = owner(); await seed(id);
    const batch = db.batch();
    for (let index = 0; index < 250; index += 1) {
      const documentId = `${id}_purchase_${String(index).padStart(4, '0')}`;
      batch.set(db.collection('googlePlayPurchases').doc(documentId), { uid: id, acknowledgementState: 'pending' });
      created.push({ collection: 'googlePlayPurchases', id: documentId });
    }
    await batch.commit();
    const addLedger = () => set('googlePlayPurchases', `${id}_purchase_9999`, {
      uid: id, purchaseToken: 'synthetic-emulator-purchase-token', productId: 'pediturno_servicios_pro_monthly', vertical: 'services',
    });
    if (stage === 'initial scan') await addLedger();
    const auth = getAuth(); const originalDelete = auth.deleteUser.bind(auth);
    const spy = stage === 'final transactional recheck' ? vi.spyOn(auth, 'deleteUser').mockImplementation(async uid => {
      await originalDelete(uid);
      if (uid === id) await addLedger();
    }) : null;
    try {
      const result = await processAndroidAccountDeletion(id);
      expect(result.status).toBe('financial_review_required');
      expect((await db.doc(`businessDeletions/${id}`).get()).get('status')).toBe('financial_review_required');
      expect((await db.doc(`googlePlayPurchases/${id}_purchase_9999`).get()).exists).toBe(true);
    } finally { spy?.mockRestore(); }
  }, 60_000);
  it('anonymizes more than one page, deletes Auth, and preserves a tombstone', async () => {
    const id = owner(); await seed(id, 251);
    const result = await processAndroidAccountDeletion(id);
    expect(result.status).toBe('deleted');
    const appointments = await db.collection('appointments').where('businessId', '==', id).get();
    expect(appointments.size).toBe(251);
    expect(appointments.docs.every(row => row.get('client') === 'Deleted client' && row.get('clientEmail') === '' && row.get('notes') === undefined && row.get('internalNotes') === undefined)).toBe(true);
    await expect(getAuth().getUser(id)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect((await db.doc(`businessDeletions/${id}`).get()).get('status')).toBe('deleted');
    expect((await db.doc(`accountDeletionRequests/${id}`).get()).get('operationalCompletedAt').toDate()).toBeInstanceOf(Date);
  }, 30_000);

  it('purges business and operational PII but retains an actual Google Play ledger under review', async () => {
    const id = owner(); await seed(id, 1);
    await set('googlePlayPurchases', `${id}_purchase`, {
      uid: id, purchaseToken: 'fixture-purchase-token-which-is-long-enough', purchaseHash: 'a'.repeat(64),
      productId: 'pediturno_servicios_pro_monthly', vertical: 'services', acknowledgementState: 'acknowledged',
    });
    await set('androidDeviceTokenIndex', `${id}_token_index`, { ownerId: id, deviceId: 'fixture-device' });
    await set('mercadoPagoConnections', id, { encryptedAccessToken: 'emulator-only-encrypted-value', active: true });
    await db.doc(`businesses/${id}/deviceTokens/fixture-device`).set({ ownerId: id, token: 'fixture-token', platform: 'android' });
    const result = await processAndroidAccountDeletion(id);
    expect(result.status).toBe('financial_review_required');
    expect((await db.doc(`accountDeletionRequests/${id}`).get()).get('operationalCompletedAt').toDate()).toBeInstanceOf(Date);
    expect((await db.doc(`googlePlayPurchases/${id}_purchase`).get()).exists).toBe(true);
    expect((await db.collection('appointments').where('businessId', '==', id).get()).docs[0].get('client')).toBe('Deleted client');
    const business = (await db.doc(`businesses/${id}`).get()).data()!;
    expect(business.status).toBe('deletion_requested');
    expect(business.name).toBe(''); expect(business.email).toBe('');
    for (const key of ['address', 'phone', 'whatsappButtonEnabled', 'whatsappNumber', 'location', 'socialLinks', 'bookingSettings', 'mercadopago']) expect(business[key]).toBeUndefined();
    expect((await db.doc(`businessDeletions/${id}`).get()).get('status')).toBe('financial_review_required');
    expect((await db.doc(`androidDeviceTokenIndex/${id}_token_index`).get()).exists).toBe(false);
    expect((await db.doc(`mercadoPagoConnections/${id}`).get()).exists).toBe(false);
    expect((await db.doc(`businesses/${id}/deviceTokens/fixture-device`).get()).exists).toBe(false);
    await expect(getAuth().getUser(id)).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });

  it('does not classify a pre-purchase Google Play account mapping as financial history', async () => {
    const id = owner(); await seed(id, 0);
    await set('googlePlayAccounts', `${id}_account_mapping`, { uid: id, accountHash: 'fixture-account-hash' });
    const result = await processAndroidAccountDeletion(id);
    expect(result.status).toBe('deleted');
    expect((await db.doc(`googlePlayAccounts/${id}_account_mapping`).get()).exists).toBe(false);
    expect((await db.doc(`businessDeletions/${id}`).get()).get('status')).toBe('deleted');
  });

  it('does not take over a live processing lease', async () => {
    const id = owner();
    await seed(id);
    await db.doc(`accountDeletionRequests/${id}`).update({ status: 'processing', claimId: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) });
    expect((await processAndroidAccountDeletion(id)).status).toBe('processing');
  });

  it('quarantines malformed tickets without deleting an active business, Auth, Storage, Marketplace, or appointments', async () => {
    const cases = [owner(), owner(), owner()];
    for (const [index, id] of cases.entries()) {
      const requestId = randomUUID();
      await set('businesses', id, { status: index === 0 ? 'active' : 'deletion_requested', deletionRequestId: requestId, name: 'Preserve me' });
      await set('appointments', `${id}_preserve`, { businessId: id, client: 'Preserve client' });
      await set('mercadoPagoConnections', id, { encryptedAccessToken: { ciphertext: 'preserve' }, active: true });
      await getAuth().createUser({ uid: id, email: `${id}@example.test` }); authOwners.add(id);
      const request = { requestId, ownerId: index === 1 ? `${id}_other` : id, source: 'android', requestedAt: new Date(), status: index === 2 ? 'processing' : 'deletion_requested', nextAttemptAt: new Date(0) } as Record<string, unknown>;
      if (index === 2) request.leaseUntil = new Date(Date.now() - 1_000); // Missing claimId is invalid.
      await set('accountDeletionRequests', id, request);
      expect((await processAndroidAccountDeletion(id)).status).toBe('not_found');
      expect((await db.doc(`accountDeletionRequests/${id}`).get()).get('status')).toBe('quarantined');
      expect((await db.doc(`businesses/${id}`).get()).get('name')).toBe('Preserve me');
      expect((await db.doc(`appointments/${id}_preserve`).get()).exists).toBe(true);
      expect((await db.doc(`mercadoPagoConnections/${id}`).get()).exists).toBe(true);
      await expect(getAuth().getUser(id)).resolves.toMatchObject({ uid: id });
    }
  });

  it('deletes only exact business Storage objects before reaching deleted', async () => {
    const id = owner(); await seed(id);
    const bucket = getStorage().bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!);
    const ownA = bucket.file(`businesses/${id}/avatar.png`); const ownB = bucket.file(`businesses/${id}/nested/photo.png`);
    const neighbor = bucket.file(`businesses/${prefix}neighbor/avatar.png`);
    await Promise.all([ownA.save('a'), ownB.save('b'), neighbor.save('c')]);
    try {
      expect((await processAndroidAccountDeletion(id)).status).toBe('deleted');
      await expect(ownA.exists()).resolves.toEqual([false]); await expect(ownB.exists()).resolves.toEqual([false]);
      await expect(neighbor.exists()).resolves.toEqual([true]);
    } finally { await neighbor.delete().catch(() => undefined); }
  }, 30_000);

  it('retains only inactive encrypted Marketplace credentials while a deposit is not financially closed', async () => {
    const id = owner(); await seed(id);
    await set('depositOrders', `${id}_open_deposit`, { businessId: id, status: 'pending', appointmentId: 'retained-reference' });
    await set('mercadoPagoConnections', id, {
      connectionId: 'connection-fixture', encryptedAccessToken: { ciphertext: 'access' }, encryptedRefreshToken: { ciphertext: 'refresh' },
      merchantUserId: '123456', liveMode: false, active: true, tokenExpiresAt: new Date(Date.now() + 60_000), ownerSettings: { shouldBeRemoved: true }, refreshLeaseUntil: new Date(),
    });
    expect((await processAndroidAccountDeletion(id)).status).toBe('financial_review_required');
    const retained = (await db.doc(`mercadoPagoConnections/${id}`).get()).data()!;
    expect(retained.active).toBe(false); expect(retained.encryptedAccessToken).toEqual({ ciphertext: 'access' });
    expect(retained.ownerSettings).toBeUndefined(); expect(retained.refreshLeaseUntil).toBeUndefined();
    await db.doc(`depositOrders/${id}_open_deposit`).update({ financialClosedAt: new Date() });
    await expect(purgeMarketplaceCredentialsAfterFinancialClosure(id)).resolves.toEqual({ purged: false });
    await db.doc(`depositOrders/${id}_open_deposit`).update({ financialClosure: { source: 'MERCADO_PAGO_FULL_REFUND', evidenceHash: 'a'.repeat(64) } });
    await expect(purgeMarketplaceCredentialsAfterFinancialClosure(id)).resolves.toEqual({ purged: true });
    expect((await db.doc(`mercadoPagoConnections/${id}`).get()).exists).toBe(false);
  });

  it('never purges Marketplace credentials for an active account or a mismatched retention marker', async () => {
    const activeId = owner();
    await set('businesses', activeId, { status: 'active', name: 'Active owner' });
    await set('mercadoPagoConnections', activeId, { encryptedAccessToken: { ciphertext: 'active' }, active: true });
    await expect(purgeMarketplaceCredentialsAfterFinancialClosure(activeId)).resolves.toEqual({ purged: false });
    expect((await db.doc(`mercadoPagoConnections/${activeId}`).get()).exists).toBe(true);
    expect((await db.doc(`businessDeletions/${activeId}`).get()).exists).toBe(false);

    const retainedId = owner(); await seed(retainedId);
    await db.doc(`accountDeletionRequests/${retainedId}`).update({ status: 'financial_review_required' });
    await set('businessDeletions', retainedId, { businessId: retainedId, status: 'financial_review_required' });
    await set('mercadoPagoConnections', retainedId, { encryptedAccessToken: { ciphertext: 'retained' }, active: false, deletionRetention: { reason: 'wrong_marker' } });
    await expect(purgeMarketplaceCredentialsAfterFinancialClosure(retainedId)).resolves.toEqual({ purged: false });
    expect((await db.doc(`mercadoPagoConnections/${retainedId}`).get()).exists).toBe(true);
  });

  it('batch-processes only due fixture requests, recovers expired leases, and excludes terminal or deferred requests', async () => {
    const fresh = owner(); const expired = owner(); const live = owner(); const terminal = owner(); const deferred = owner();
    await Promise.all([seed(fresh), seed(expired), seed(live), seed(terminal), seed(deferred)]);
    await db.doc(`accountDeletionRequests/${expired}`).update({ status: 'processing', claimId: randomUUID(), leaseUntil: new Date(Date.now() - 1_000) });
    await db.doc(`accountDeletionRequests/${live}`).update({ status: 'processing', claimId: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) });
    await db.doc(`accountDeletionRequests/${terminal}`).update({ status: 'financial_review_required' });
    await db.doc(`accountDeletionRequests/${deferred}`).update({ nextAttemptAt: new Date(Date.now() + 60_000) });

    const result = await processPendingAndroidAccountDeletions(4);
    expect(result).toMatchObject({ attempted: 2, deleted: 2, financialReviewRequired: 0, failed: 0 });
    expect((await db.doc(`accountDeletionRequests/${fresh}`).get()).get('status')).toBe('deleted');
    expect((await db.doc(`accountDeletionRequests/${expired}`).get()).get('status')).toBe('deleted');
    expect((await db.doc(`accountDeletionRequests/${live}`).get()).get('status')).toBe('processing');
    expect((await db.doc(`accountDeletionRequests/${terminal}`).get()).get('status')).toBe('financial_review_required');
    expect((await db.doc(`accountDeletionRequests/${deferred}`).get()).get('status')).toBe('deletion_requested');
  }, 30_000);

  it('alternates a recovered lease ahead of replenished fresh work when limit is one', async () => {
    const freshA = owner(); const recovered = owner(); await Promise.all([seed(freshA), seed(recovered)]);
    await db.doc('maintenanceJobs/account-deletion-batch-fairness').set({ nextQueue: 'requested' });
    await db.doc(`accountDeletionRequests/${recovered}`).update({ status: 'processing', claimId: randomUUID(), leaseUntil: new Date(Date.now() - 1_000) });
    expect((await processPendingAndroidAccountDeletions(1)).deleted).toBe(1);
    expect((await db.doc(`accountDeletionRequests/${freshA}`).get()).get('status')).toBe('deleted');
    const freshB = owner(); await seed(freshB);
    expect((await processPendingAndroidAccountDeletions(1)).deleted).toBe(1);
    expect((await db.doc(`accountDeletionRequests/${recovered}`).get()).get('status')).toBe('deleted');
    expect((await db.doc(`accountDeletionRequests/${freshB}`).get()).get('status')).toBe('deletion_requested');
    await db.doc(`accountDeletionRequests/${freshB}`).update({ nextAttemptAt: new Date(Date.now() + 60_000) });
    await db.doc('maintenanceJobs/account-deletion-batch-fairness').delete();
  }, 30_000);

  it('does not starve a due request behind more than one bounded page of deferred retries', async () => {
    const deferredIds = Array.from({ length: 501 }, () => owner());
    await Promise.all(deferredIds.map(id => set('accountDeletionRequests', id, {
      requestId: randomUUID(), ownerId: id, source: 'android', requestedAt: new Date(), status: 'deletion_requested', nextAttemptAt: new Date(Date.now() + 60 * 60_000),
    })));
    const due = owner(); await seed(due);
    const result = await processPendingAndroidAccountDeletions(1);
    expect(result).toMatchObject({ attempted: 1, deleted: 1, failed: 0 });
    expect((await db.doc(`accountDeletionRequests/${due}`).get()).get('status')).toBe('deleted');
    expect((await db.doc(`accountDeletionRequests/${deferredIds[0]}`).get()).get('status')).toBe('deletion_requested');
  }, 30_000);

  it('records a bounded retry after a real operational cleanup failure instead of claiming deletion', async () => {
    const id = owner(); await seed(id);
    const previousBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    try {
      await expect(processAndroidAccountDeletion(id)).rejects.toThrow();
    } finally {
      if (previousBucket === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = previousBucket;
    }
    const request = await db.doc(`accountDeletionRequests/${id}`).get();
    expect(request.get('status')).toBe('deletion_requested');
    expect(request.get('errorCount')).toBe(1);
    expect(request.get('lastErrorCode')).toBe('DELETION_WORKER_RETRY');
    expect(request.get('nextAttemptAt').toDate().getTime()).toBeGreaterThan(Date.now());
    expect((await db.doc(`businesses/${id}`).get()).get('status')).toBe('deletion_requested');
  }, 30_000);
});
