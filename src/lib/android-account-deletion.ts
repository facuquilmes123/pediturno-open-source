import 'server-only';

import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getAdminFirestore } from '@/lib/firebase-admin';

const PAGE = 250;
const CLAIM_LEASE_MS = 5 * 60_000;
const MAX_BATCH_SIZE = 20;
const financialCollections = ['paymentOrders', 'processedPayments', 'membershipPaymentCredits', 'membershipAdminChanges', 'depositOrders', 'depositPayments'];
const operationalCollections: Array<[string, string]> = [
  ['services', 'businessId'], ['canchas', 'businessId'], ['spaces', 'businessId'], ['clients', 'businessId'],
  ['pushSubscriptions', 'userId'], ['oauthStates', 'uid'], ['publicBusinesses', 'businessId'], ['bookingRequests', 'businessId'],
  ['ownerWorkspaceVersions', 'businessId'], ['bookingRateLimits', 'businessId'], ['availabilityRateLimits', 'businessId'], ['bookingSlots', 'businessId'],
  ['bookingCapabilities', 'businessId'], ['bookingEmailOutbox', 'businessId'], ['ownerEmailNotifications', 'businessId'], ['reminderDeliveries', 'businessId'],
  ['ownerAppointmentRequests', 'ownerId'], ['androidMarketplaceHandoffs', 'ownerId'],
  // This is an account-routing helper, not a financial ledger. It must not
  // retain an erased owner's uid just because a BillingFlow was opened.
  ['googlePlayAccounts', 'uid'], ['androidDeviceTokenIndex', 'ownerId'],
];

export type AccountDeletionResult = { status: 'deleted' | 'financial_review_required' | 'processing' | 'not_found'; deleted?: Record<string, number> };
export type AccountDeletionBatchResult = { attempted: number; deleted: number; financialReviewRequired: number; processing: number; skipped: number; failed: number };

class LeaseLostError extends Error {}

function isGooglePlayFinancialLedger(row: FirebaseFirestore.QueryDocumentSnapshot) {
  // Account mappings and acknowledgement-only placeholders are not purchase
  // evidence. A persisted subscription ledger has the immutable token binding
  // and product scope written by persistGooglePlaySubscription().
  return typeof row.get('purchaseToken') === 'string' && row.get('purchaseToken').length >= 20 &&
    row.get('productId') === 'pediturno_servicios_pro_monthly' && row.get('vertical') === 'services';
}

function snapshotsHaveFinancialHistory(snapshots: FirebaseFirestore.QuerySnapshot[]) {
  return snapshots.some(snapshot => !snapshot.empty);
}

async function hasGooglePlayFinancialHistory(
  ownerId: string,
  read: (query: FirebaseFirestore.Query) => Promise<FirebaseFirestore.QuerySnapshot> = query => query.get(),
  heartbeat?: () => Promise<void>,
) {
  const db = getAdminFirestore();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    await heartbeat?.();
    let query = db.collection('googlePlayPurchases').where('uid', '==', ownerId).orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const rows = await read(query);
    if (rows.docs.some(isGooglePlayFinancialLedger)) return true;
    if (rows.size < PAGE) return false;
    cursor = rows.docs.at(-1);
  }
}

async function existsFinancialHistory(ownerId: string, heartbeat?: () => Promise<void>) {
  const db = getAdminFirestore();
  const [googlePlay, snapshots] = await Promise.all([
    hasGooglePlayFinancialHistory(ownerId, undefined, heartbeat),
    Promise.all(financialCollections.map(name => db.collection(name).where('businessId', '==', ownerId).limit(1).get())),
  ]);
  return googlePlay || snapshotsHaveFinancialHistory(snapshots);
}

async function audit(ownerId: string, event: string, extra: Record<string, unknown> = {}) {
  await getAdminFirestore().collection('accountDeletionAudit').doc(`${ownerId}_${event}`).set({ ownerId, event, ...extra, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function deleteByField(collection: string, field: string, ownerId: string, summary: Record<string, number>, heartbeat?: () => Promise<void>) {
  const db = getAdminFirestore();
  while (true) {
    await heartbeat?.();
    const snapshot = await db.collection(collection).where(field, '==', ownerId).limit(PAGE).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach(row => batch.delete(row.ref));
    await batch.commit();
    summary[collection] = (summary[collection] || 0) + snapshot.size;
  }
}

async function anonymizeAppointments(ownerId: string, summary: Record<string, number>, heartbeat?: () => Promise<void>) {
  const db = getAdminFirestore();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    await heartbeat?.();
    let query = db.collection('appointments').where('businessId', '==', ownerId).orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snapshot = await query.get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach(row => batch.update(row.ref, {
      client: 'Deleted client', clientId: FieldValue.delete(), clientPhone: '', clientEmail: '', avatar: '',
      // Legacy web/mobile records may contain unstructured PII. Retain only
      // scheduling/financial references that are needed for reconciliation.
      notes: FieldValue.delete(), note: FieldValue.delete(), internalNotes: FieldValue.delete(), clientNotes: FieldValue.delete(),
      comments: FieldValue.delete(), description: FieldValue.delete(), clientAddress: FieldValue.delete(),
      privacyAnonymizedAt: FieldValue.serverTimestamp(),
    }));
    await batch.commit();
    summary.appointmentsAnonymized = (summary.appointmentsAnonymized || 0) + snapshot.size;
    cursor = snapshot.docs.at(-1);
  }
}

async function deleteDeviceTokens(ownerId: string, summary: Record<string, number>, heartbeat?: () => Promise<void>) {
  const db = getAdminFirestore();
  while (true) { await heartbeat?.(); const snapshot = await db.collection('businesses').doc(ownerId).collection('deviceTokens').limit(PAGE).get(); if (snapshot.empty) return; const batch = db.batch(); snapshot.docs.forEach(row => batch.delete(row.ref)); await batch.commit(); summary.deviceTokens = (summary.deviceTokens || 0) + snapshot.size; }
}

async function hasUnclosedMarketplaceObligation(ownerId: string, heartbeat?: () => Promise<void>) {
  const db = getAdminFirestore();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    await heartbeat?.();
    let query = db.collection('depositOrders').where('businessId', '==', ownerId).orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const rows = await query.get();
    if (rows.docs.some(row => !(row.get('financialClosedAt') instanceof Timestamp))) return true;
    if (rows.size < PAGE) break;
    cursor = rows.docs.at(-1);
  }
  cursor = undefined;
  while (true) {
    await heartbeat?.();
    let query = db.collection('depositPayments').where('businessId', '==', ownerId).where('status', 'in', ['approved', 'review']).orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const rows = await query.get();
    if (rows.docs.some(row => !(row.get('financialClosedAt') instanceof Timestamp))) return true;
    if (rows.size < PAGE) return false;
    cursor = rows.docs.at(-1);
  }
}

async function retainOrDeleteMarketplaceConnection(ownerId: string, retain: boolean, summary: Record<string, number>) {
  const db = getAdminFirestore();
  const ref = db.collection('mercadoPagoConnections').doc(ownerId); const row = await ref.get();
  if (!row.exists) return;
  if (!retain) { await ref.delete(); summary.mercadoPagoConnections = (summary.mercadoPagoConnections || 0) + 1; return; }
  const value = row.data() || {};
  // Keep only what getSellerConnection(..., true) needs for a future signed
  // settlement. `active:false` prevents every owner/new-checkout path.
  await ref.set({
    ...(typeof value.connectionId === 'string' ? { connectionId: value.connectionId } : {}),
    ...(value.encryptedAccessToken ? { encryptedAccessToken: value.encryptedAccessToken } : {}),
    ...(value.encryptedRefreshToken ? { encryptedRefreshToken: value.encryptedRefreshToken } : {}),
    ...(typeof value.merchantUserId === 'string' ? { merchantUserId: value.merchantUserId } : {}),
    ...(typeof value.liveMode === 'boolean' ? { liveMode: value.liveMode } : {}),
    ...(value.tokenExpiresAt instanceof Timestamp ? { tokenExpiresAt: value.tokenExpiresAt } : {}),
    active: false, deletionRetention: { reason: 'unclosed_deposit_obligation', retainedAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp(),
  });
  summary.mercadoPagoConnectionRetained = (summary.mercadoPagoConnectionRetained || 0) + 1;
}

async function deletePrivateOperationalDocuments(ownerId: string, retainMarketplaceCredentials: boolean, summary: Record<string, number>) {
  const db = getAdminFirestore();
  await retainOrDeleteMarketplaceConnection(ownerId, retainMarketplaceCredentials, summary);
  // These documents are keyed by uid rather than carrying businessId.
  for (const collection of ['pushTestRateLimits', 'membershipPaymentOrderLocks']) {
    const ref = db.collection(collection).doc(ownerId);
    const row = await ref.get();
    if (row.exists) { await ref.delete(); summary[collection] = (summary[collection] || 0) + 1; }
  }
}

/** Compatibility entry point: a timestamp alone is never proof of closure. */
export async function purgeMarketplaceCredentialsAfterFinancialClosure(ownerId: string) {
  if (await hasUnclosedMarketplaceObligation(ownerId)) return { purged: false as const };
  const db = getAdminFirestore();
  const purged = await db.runTransaction(async tx => {
    const requestRef = db.collection('accountDeletionRequests').doc(ownerId); const tombstoneRef = db.collection('businessDeletions').doc(ownerId); const connectionRef = db.collection('mercadoPagoConnections').doc(ownerId);
    const [request, tombstone, connection, orders, payments] = await Promise.all([
      tx.get(requestRef), tx.get(tombstoneRef), tx.get(connectionRef),
      tx.get(db.collection('depositOrders').where('businessId', '==', ownerId).limit(PAGE + 1)),
      tx.get(db.collection('depositPayments').where('businessId', '==', ownerId).limit(PAGE + 1)),
    ]);
    const marker = connection.data()?.deletionRetention;
    const eligible = request.get('status') === 'financial_review_required' && tombstone.get('status') === 'financial_review_required' &&
      connection.exists && connection.get('active') === false && marker && marker.reason === 'unclosed_deposit_obligation' &&
      orders.size <= PAGE && payments.size <= PAGE && [...orders.docs, ...payments.docs].every(row => row.get('financialClosedAt') instanceof Timestamp &&
        row.get('financialClosure.source') === 'MERCADO_PAGO_FULL_REFUND' && /^[a-f0-9]{64}$/.test(row.get('financialClosure.evidenceHash') || ''));
    if (!eligible) return false;
    tx.delete(connectionRef);
    tx.set(tombstoneRef, { marketplaceCredentialsPurgedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  return { purged };
}

async function deleteExactBusinessStorage(ownerId: string, summary: Record<string, number>, heartbeat?: () => Promise<void>) {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  // A silent skip would mark the account deleted while public object URLs
  // still resolve. Missing configuration is a retryable worker failure.
  if (!bucketName || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName)) throw new Error('STORAGE_CONFIGURATION_MISSING');
  const prefix = `businesses/${ownerId}/`;
  let pageToken: string | undefined;
  while (true) {
    await heartbeat?.();
    const [files, nextQuery] = await getStorage().bucket(bucketName).getFiles({ prefix, autoPaginate: false, maxResults: PAGE, pageToken });
    for (const [index, file] of files.entries()) {
      // One lease renewal per small sub-batch bounds a slow Storage page
      // without introducing an extra Firestore round-trip for every object.
      if (index > 0 && index % 25 === 0) await heartbeat?.();
      if (file.name.startsWith(prefix)) await file.delete();
    }
    summary.storageObjects = (summary.storageObjects || 0) + files.filter(file => file.name.startsWith(prefix)).length;
    pageToken = nextQuery?.pageToken;
    if (!pageToken) return;
  }
}

function profilePiiPurge(status: 'deleted' | 'deletion_requested', deletionRequestStatus: 'deleted' | 'financial_review_required') {
  return {
    status,
    // Keep the business document only as a closed/tombstone reference. Every
    // public/profile/contact value is removed or blanked, including the email
    // nested in booking settings. Financial ledgers keep their own minimal
    // immutable references and do not need this operational profile.
    name: '', email: '', slug: FieldValue.delete(), logo: FieldValue.delete(), description: FieldValue.delete(),
    address: FieldValue.delete(), phone: FieldValue.delete(), whatsappButtonEnabled: FieldValue.delete(), whatsappNumber: FieldValue.delete(),
    location: FieldValue.delete(), socialLinks: FieldValue.delete(), theme: FieldValue.delete(), customTheme: FieldValue.delete(),
    bookingSettings: FieldValue.delete(), mercadopago: FieldValue.delete(), googlePlayMembership: FieldValue.delete(),
    deletionRequestStatus, privacyAnonymizedAt: FieldValue.serverTimestamp(),
  };
}

async function markFinancialReview(ownerId: string, claimId: string, retainMarketplaceCredentials: boolean, summary: Record<string, number>) {
  const db = getAdminFirestore(); const requestRef = db.collection('accountDeletionRequests').doc(ownerId); const businessRef = db.collection('businesses').doc(ownerId);
  await db.runTransaction(async tx => {
    const [request, business] = await Promise.all([tx.get(requestRef), tx.get(businessRef)]);
    if (!request.exists || !business.exists) throw new Error('DELETION_SOURCE_MISSING');
    if (request.get('status') !== 'processing' || request.get('claimId') !== claimId) throw new LeaseLostError();
    tx.update(requestRef, { status: 'financial_review_required', operationalCompletedAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete(), claimId: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), deleted: summary });
    tx.update(businessRef, profilePiiPurge('deletion_requested', 'financial_review_required'));
    // A returned/recreated Auth uid must not resurrect the erased public
    // profile while immutable purchase evidence remains for reconciliation.
    tx.set(db.collection('businessDeletions').doc(ownerId), {
      businessId: ownerId, status: 'financial_review_required', completedAt: FieldValue.serverTimestamp(), retention: retainMarketplaceCredentials ? 'financial-ledger-and-marketplace-settlement-preserved' : 'financial-ledger-preserved',
    }, { merge: true });
  });
  await audit(ownerId, 'financial_review_required', { deleted: summary }).catch(() => undefined);
  return { status: 'financial_review_required' as const, deleted: summary };
}

function retryDelayMs(errorCount: number) {
  return Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.max(0, Math.min(12, errorCount - 1)));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDeletionTicket(ownerId: string, request: FirebaseFirestore.DocumentSnapshot, business: FirebaseFirestore.DocumentSnapshot) {
  if (!request.exists || !business.exists || request.get('ownerId') !== ownerId || !UUID_PATTERN.test(String(request.get('requestId') || '')) || request.get('source') !== 'android') return false;
  if (!(request.get('requestedAt') instanceof Timestamp) || business.get('status') !== 'deletion_requested' || business.get('deletionRequestId') !== request.get('requestId')) return false;
  if (request.get('status') === 'processing') {
    const lease = request.get('leaseUntil');
    if (!(lease instanceof Timestamp) || !UUID_PATTERN.test(String(request.get('claimId') || ''))) return false;
  }
  return true;
}

async function scheduleRetry(ownerId: string, claimId: string) {
  const db = getAdminFirestore(); const requestRef = db.collection('accountDeletionRequests').doc(ownerId); const businessRef = db.collection('businesses').doc(ownerId);
  const scheduled = await db.runTransaction(async tx => {
    const [request, business] = await Promise.all([tx.get(requestRef), tx.get(businessRef)]);
    if (!request.exists || request.get('status') !== 'processing' || request.get('claimId') !== claimId) return false;
    const errorCount = Math.max(0, Number(request.get('errorCount') || 0) || 0) + 1;
    tx.update(requestRef, {
      status: 'deletion_requested', claimId: FieldValue.delete(), leaseUntil: FieldValue.delete(),
      errorCount, lastErrorCode: 'DELETION_WORKER_RETRY', lastErrorAt: FieldValue.serverTimestamp(),
      nextAttemptAt: Timestamp.fromMillis(Date.now() + retryDelayMs(errorCount)), updatedAt: FieldValue.serverTimestamp(),
    });
    if (business.exists) tx.update(businessRef, { status: 'deletion_requested', deletionRequestStatus: 'retry_scheduled' });
    return true;
  });
  if (scheduled) await audit(ownerId, 'retry_scheduled', { retryScheduled: true }).catch(() => undefined);
  return scheduled;
}

async function renewDeletionClaim(ownerId: string, claimId: string) {
  const db = getAdminFirestore(); const requestRef = db.collection('accountDeletionRequests').doc(ownerId);
  const renewed = await db.runTransaction(async tx => {
    const request = await tx.get(requestRef);
    if (!request.exists || request.get('status') !== 'processing' || request.get('claimId') !== claimId) return false;
    tx.update(requestRef, { leaseUntil: Timestamp.fromMillis(Date.now() + CLAIM_LEASE_MS), claimHeartbeatAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!renewed) throw new LeaseLostError();
}

export async function processAndroidAccountDeletion(ownerId: string): Promise<AccountDeletionResult> {
  const db = getAdminFirestore();
  const requestRef = db.collection('accountDeletionRequests').doc(ownerId);
  const businessRef = db.collection('businesses').doc(ownerId);
  const claimId = randomUUID();
  const initial = await db.runTransaction(async tx => {
    const [request, business] = await Promise.all([tx.get(requestRef), tx.get(businessRef)]);
    if (!request.exists) return 'not_found' as const;
    const status = request.get('status');
    if (status === 'deleted') return 'deleted' as const;
    if (status === 'financial_review_required') return 'financial_review_required' as const;
    if (!validDeletionTicket(ownerId, request, business)) {
      // Corrupt/partial tickets are quarantined server-side. Crucially, their
      // business/auth/data are untouched and cron will not retry them.
      tx.update(requestRef, { status: 'quarantined', quarantineReason: 'INVALID_DELETION_TICKET', quarantinedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return 'invalid' as const;
    }
    if (status !== 'deletion_requested' && status !== 'processing') return 'not_found' as const;
    const now = Date.now(); const lease = request.get('leaseUntil'); const nextAttempt = request.get('nextAttemptAt');
    if (status === 'deletion_requested' && nextAttempt instanceof Timestamp && nextAttempt.toMillis() > now) return 'backoff' as const;
    if (status === 'processing' && lease instanceof Timestamp && lease.toMillis() > now) return 'leased' as const;
    tx.update(requestRef, { status: 'processing', claimId, leaseUntil: Timestamp.fromMillis(now + CLAIM_LEASE_MS), updatedAt: FieldValue.serverTimestamp() });
    tx.update(businessRef, { status: 'deletion_requested', deletionRequestStatus: 'processing' });
    return 'acquired' as const;
  });
  if (initial === 'not_found' || initial === 'invalid') return { status: 'not_found' };
  if (initial === 'deleted') return { status: 'deleted' };
  if (initial === 'financial_review_required') return { status: 'financial_review_required' };
  if (initial === 'leased' || initial === 'backoff') return { status: 'processing' };
  const summary: Record<string, number> = {};
  try {
    const heartbeat = () => renewDeletionClaim(ownerId, claimId);
    await heartbeat();
    const financial = await existsFinancialHistory(ownerId, heartbeat);
    const retainMarketplaceCredentials = financial && await hasUnclosedMarketplaceObligation(ownerId, heartbeat);
    await anonymizeAppointments(ownerId, summary, heartbeat);
    for (const [collection, field] of operationalCollections) await deleteByField(collection, field, ownerId, summary, heartbeat);
    await deleteDeviceTokens(ownerId, summary, heartbeat);
    await heartbeat(); await deletePrivateOperationalDocuments(ownerId, retainMarketplaceCredentials, summary);
    await deleteExactBusinessStorage(ownerId, summary, heartbeat);
    await heartbeat();
    // Auth is disabled/revoked rather than relying on a client flag. The business tombstone prevents recreation.
    await getAuth().updateUser(ownerId, { disabled: true }).catch(cause => { if ((cause as { code?: string }).code !== 'auth/user-not-found') throw cause; });
    await getAuth().revokeRefreshTokens(ownerId).catch(cause => { if ((cause as { code?: string }).code !== 'auth/user-not-found') throw cause; });
    await getAuth().deleteUser(ownerId).catch(cause => { if ((cause as { code?: string }).code !== 'auth/user-not-found') throw cause; });
    if (financial) return await markFinancialReview(ownerId, claimId, retainMarketplaceCredentials, summary);
    await db.runTransaction(async tx => {
      const [lateGooglePlay, lateFinancial] = await Promise.all([
        hasGooglePlayFinancialHistory(ownerId, query => tx.get(query)),
        Promise.all(financialCollections.map(name => tx.get(db.collection(name).where('businessId', '==', ownerId).limit(1)))),
      ]);
      const request = await tx.get(requestRef);
      if (!request.exists || request.get('status') !== 'processing' || request.get('claimId') !== claimId) throw new LeaseLostError();
      if (lateGooglePlay || snapshotsHaveFinancialHistory(lateFinancial)) throw new Error('FINANCIAL_HISTORY');
      tx.update(businessRef, { ...profilePiiPurge('deleted', 'deleted'), deletionCompletedAt: FieldValue.serverTimestamp() });
      tx.update(requestRef, { status: 'deleted', completedAt: FieldValue.serverTimestamp(), operationalCompletedAt: FieldValue.serverTimestamp(), claimId: FieldValue.delete(), leaseUntil: FieldValue.delete(), nextAttemptAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), deleted: summary });
      tx.set(db.collection('businessDeletions').doc(ownerId), { businessId: ownerId, status: 'deleted', completedAt: FieldValue.serverTimestamp(), retention: 'financial-ledger-preserved' }, { merge: true });
    });
  } catch (cause) {
    if (cause instanceof LeaseLostError) return { status: 'processing' };
    if (cause instanceof Error && cause.message === 'FINANCIAL_HISTORY') {
      const retainMarketplaceCredentials = await hasUnclosedMarketplaceObligation(ownerId);
      try { return await markFinancialReview(ownerId, claimId, retainMarketplaceCredentials, summary); }
      catch (reviewCause) { if (reviewCause instanceof LeaseLostError) return { status: 'processing' }; throw reviewCause; }
    }
    await scheduleRetry(ownerId, claimId).catch(() => undefined);
    throw cause;
  }
  await audit(ownerId, 'deleted', { deleted: summary }).catch(() => undefined);
  return { status: 'deleted', deleted: summary };
}

async function pendingRequestIds(status: 'deletion_requested' | 'processing', limit: number, now: number) {
  const db = getAdminFirestore(); const deadline = Timestamp.fromMillis(now);
  const rows = status === 'deletion_requested'
    ? await db.collection('accountDeletionRequests').where('status', '==', status).where('nextAttemptAt', '<=', deadline).orderBy('nextAttemptAt', 'asc').orderBy(FieldPath.documentId()).limit(limit).get()
    : await db.collection('accountDeletionRequests').where('status', '==', status).where('leaseUntil', '<=', deadline).orderBy('leaseUntil', 'asc').orderBy(FieldPath.documentId()).limit(limit).get();
  return rows.docs.map(row => row.id);
}

/**
 * Bounded cron worker. It only claims durable requests already in a retryable
 * state and intentionally never rescans terminal financial/deleted requests.
 * Requests created before `nextAttemptAt` existed are deliberately excluded
 * from cron; review them and invoke the exact ownerId mode rather than
 * migrating historical privacy tickets blindly.
 */
export async function processPendingAndroidAccountDeletions(limit = 10): Promise<AccountDeletionBatchResult> {
  const bounded = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(limit) || 10));
  const db = getAdminFirestore();
  const first = await db.runTransaction(async tx => {
    const ref = db.collection('maintenanceJobs').doc('account-deletion-batch-fairness'); const current = await tx.get(ref);
    const next = current.get('nextQueue') === 'recovered' ? 'recovered' : 'requested';
    tx.set(ref, { nextQueue: next === 'requested' ? 'recovered' : 'requested', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next as 'requested' | 'recovered';
  });
  const now = Date.now(); const each = bounded;
  const [requested, recovered] = await Promise.all([
    pendingRequestIds('deletion_requested', each, now), pendingRequestIds('processing', each, now),
  ]);
  const ids: string[] = [];
  const primary = first === 'requested' ? requested : recovered;
  const secondary = first === 'requested' ? recovered : requested;
  // Persisted alternation means a recovered lease wins every other run even
  // with limit=1 and a continuously replenished fresh queue.
  while (ids.length < bounded && (requested.length || recovered.length)) {
    if (primary.length) ids.push(primary.shift()!);
    if (ids.length < bounded && secondary.length) ids.push(secondary.shift()!);
  }
  const summary: AccountDeletionBatchResult = { attempted: 0, deleted: 0, financialReviewRequired: 0, processing: 0, skipped: 0, failed: 0 };
  for (const ownerId of ids) {
    summary.attempted += 1;
    try {
      const result = await processAndroidAccountDeletion(ownerId);
      if (result.status === 'deleted') summary.deleted += 1;
      else if (result.status === 'financial_review_required') summary.financialReviewRequired += 1;
      else if (result.status === 'processing') summary.processing += 1;
      else summary.skipped += 1;
    } catch {
      // processAndroidAccountDeletion schedules a bounded retry only while it
      // still owns the claim. The batch never leaks IDs or error text.
      summary.failed += 1;
    }
  }
  return summary;
}
