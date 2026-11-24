import 'server-only';
import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { reportGooglePlayOperationalIncident } from '@/lib/payments/google-play-alerts';
import { acknowledgeGooglePlaySubscription, getGooglePlaySubscription, GOOGLE_PLAY_PRODUCT_ID, hashGooglePlayAccount, hashGooglePlayPurchaseToken, subscriptionIsEntitled, type GooglePlaySubscription } from '@/lib/payments/google-play';

export type GooglePlayEntitlementDto = { plan: 'pro'; status: GooglePlaySubscription['status']; expiresAt: string | null; autoRenewing: boolean; source: 'google_play'; acknowledgement: 'acknowledged' | 'pending_retry' | 'not_required' };
function dto(subscription: GooglePlaySubscription, acknowledgement: GooglePlayEntitlementDto['acknowledgement']): GooglePlayEntitlementDto { return { plan: 'pro', status: subscription.status, expiresAt: subscription.expiresAt?.toISOString() ?? null, autoRenewing: subscription.autoRenewing, source: 'google_play', acknowledgement }; }

/** The Android app registers this mapping before starting BillingFlowParams. */
function activeLegacyMembership(value: unknown): { active: boolean; eligibleAt: string | null } {
  const plan = value as { type?: unknown; expiresAt?: { toDate?: () => Date } | null } | null;
  if (!plan || typeof plan !== 'object') return { active: false, eligibleAt: null };
  if (plan.type === 'lifetime') return { active: true, eligibleAt: null };
  const expiry = plan.expiresAt?.toDate?.();
  return { active: (plan.type === 'pro' || plan.type === 'trial') && !!expiry && expiry.getTime() > Date.now(), eligibleAt: expiry?.toISOString() ?? null };
}
export async function registerGooglePlayAccount(uid: string): Promise<{ obfuscatedAccountId: string; purchaseAllowed: boolean; reason?: string; eligibleAt?: string | null }> {
  const accountHash = hashGooglePlayAccount(uid);
  const db = getAdminFirestore(); const business = await db.collection('businesses').doc(uid).get();
  if (!business.exists || business.get('status') !== 'active') return { obfuscatedAccountId: accountHash, purchaseAllowed: false, reason: 'business_ineligible' };
  const businessType = business.get('businessType');
  if (businessType !== 'services' && businessType !== undefined && businessType !== null) return { obfuscatedAccountId: accountHash, purchaseAllowed: false, reason: 'services_only' };
  const legacy = activeLegacyMembership(business.get('membership'));
  if (legacy.active) return { obfuscatedAccountId: accountHash, purchaseAllowed: false, reason: 'existing_membership', eligibleAt: legacy.eligibleAt };
  const play = business.get('googlePlayMembership') as { status?: unknown; expiresAt?: { toDate?: () => Date } | null } | undefined;
  const playExpiry = play?.expiresAt?.toDate?.();
  if (play?.status === 'on_hold' || play?.status === 'paused' || play?.status === 'pending') return { obfuscatedAccountId: accountHash, purchaseAllowed: false, reason: 'existing_play_membership', eligibleAt: null };
  if ((play?.status === 'active' || play?.status === 'grace_period') && playExpiry && playExpiry.getTime() > Date.now()) return { obfuscatedAccountId: accountHash, purchaseAllowed: false, reason: 'existing_play_membership', eligibleAt: playExpiry.toISOString() };
  await db.collection('googlePlayAccounts').doc(accountHash).set({ uid, accountHash, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { obfuscatedAccountId: accountHash, purchaseAllowed: true };
}
/** Durable per-account throttle before a costly Publisher API call. */
export async function claimGooglePlayVerificationAttempt(uid: string, purchaseToken: string): Promise<boolean> {
  const db = getAdminFirestore(); const accountHash = hashGooglePlayAccount(uid); const accountRef = db.collection('googlePlayVerificationRateLimits').doc(accountHash); const tokenRef = db.collection('googlePlayVerificationTokenRateLimits').doc(`${accountHash}_${hashGooglePlayPurchaseToken(purchaseToken)}`); const window = Math.floor(Date.now() / 60_000);
  return db.runTransaction(async tx => { const [account, token] = await Promise.all([tx.get(accountRef), tx.get(tokenRef)]); const accountCount = account.exists && account.get('window') === window ? Number(account.get('count') ?? 0) : 0; const tokenCount = token.exists && token.get('window') === window ? Number(token.get('count') ?? 0) : 0; if (!Number.isFinite(accountCount) || !Number.isFinite(tokenCount) || accountCount >= 12 || tokenCount >= 4) return false; tx.set(accountRef, { window, count: accountCount + 1, updatedAt: FieldValue.serverTimestamp() }); tx.set(tokenRef, { window, count: tokenCount + 1, updatedAt: FieldValue.serverTimestamp() }); return true; });
}

/**
 * Resolves the server owner of a Publisher subscription without accepting a
 * client supplied identity. Out-of-app resubscriptions can omit external
 * account identifiers, but carry the expired token from our immutable ledger.
 */
function verifiedLedgerOwner(record: { exists: boolean; get: (field: string) => unknown }, packageName: string, token: string, googleAccountHash: string): string | null {
  const uid = record.get('uid'); const accountHash = record.get('accountHash');
  if (!record.exists || typeof uid !== 'string' || !uid || typeof accountHash !== 'string' || accountHash !== hashGooglePlayAccount(uid)) return null;
  if (googleAccountHash && googleAccountHash !== accountHash) return null;
  if (record.get('purchaseToken') !== token || record.get('packageName') !== packageName || record.get('productId') !== GOOGLE_PLAY_PRODUCT_ID || record.get('vertical') !== 'services') return null;
  return uid;
}

export async function resolveGooglePlaySubscriptionOwner(input: { packageName: string; subscription: Pick<GooglePlaySubscription, 'accountHash' | 'expiredPurchaseToken' | 'purchaseToken'> }): Promise<string | null> {
  const { packageName, subscription } = input; const db = getAdminFirestore();
  if (subscription.accountHash) {
    const account = await db.collection('googlePlayAccounts').doc(subscription.accountHash).get(); const uid = account.get('uid');
    if (typeof uid === 'string' && uid && hashGooglePlayAccount(uid) === subscription.accountHash) return uid;
  }
  if (typeof subscription.purchaseToken === 'string' && subscription.purchaseToken) {
    const current = await db.collection('googlePlayPurchases').doc(hashGooglePlayPurchaseToken(subscription.purchaseToken)).get();
    const owner = verifiedLedgerOwner(current, packageName, subscription.purchaseToken, subscription.accountHash);
    if (owner) return owner;
  }
  const expiredToken = subscription.expiredPurchaseToken;
  if (!expiredToken) return null;
  const expired = await db.collection('googlePlayPurchases').doc(hashGooglePlayPurchaseToken(expiredToken)).get();
  return verifiedLedgerOwner(expired, packageName, expiredToken, subscription.accountHash);
}

type GooglePlayRtdnReplay = { claimId: string; purchaseToken: string; packageName: string };
function retryMillis(value: unknown): number | null { if (value instanceof Date) return value.getTime(); const millis = (value as { toMillis?: () => unknown } | null)?.toMillis?.(); return typeof millis === 'number' && Number.isFinite(millis) ? millis : null; }

/** Atomically owns one deferred RTDN before re-querying the Publisher API. */
export async function claimGooglePlayRtdnReplay(eventId: string, now = Date.now()): Promise<GooglePlayRtdnReplay | null> {
  const db = getAdminFirestore(); const eventRef = db.collection('googlePlayRtdnEvents').doc(eventId); const claimId = randomUUID();
  return db.runTransaction(async tx => {
    const event = await tx.get(eventRef); const purchaseToken = event.get('purchaseToken'); const packageName = event.get('packageName'); const status = event.get('status');
    const dueAwaiting = (status === 'awaiting_account_mapping' || status === 'retryable_failure') && retryMillis(event.get('nextAttemptAt')) !== null && retryMillis(event.get('nextAttemptAt'))! <= now;
    const expiredReplay = status === 'replaying' && retryMillis(event.get('leaseUntil')) !== null && retryMillis(event.get('leaseUntil'))! <= now;
    if (!event.exists || (!dueAwaiting && !expiredReplay) || typeof purchaseToken !== 'string' || typeof packageName !== 'string') return null;
    tx.set(eventRef, { status: 'replaying', replayClaimId: claimId, leaseUntil: new Date(now + 5 * 60_000), replayStartedAt: FieldValue.serverTimestamp(), attempts: FieldValue.increment(1) }, { merge: true });
    return { claimId, purchaseToken, packageName };
  });
}

/** A stale worker cannot mutate an RTDN event once another claim owns it. */
export async function completeGooglePlayRtdnReplay(eventId: string, claimId: string, value: { status: 'processed' | 'awaiting_account_mapping' | 'retryable_failure'; nextAttemptAt?: Date; replayedAt?: unknown; replayFailedAt?: unknown }): Promise<boolean> {
  const db = getAdminFirestore(); const eventRef = db.collection('googlePlayRtdnEvents').doc(eventId);
  return db.runTransaction(async tx => {
    const event = await tx.get(eventRef);
    if (!event.exists || event.get('status') !== 'replaying' || event.get('replayClaimId') !== claimId) return false;
    tx.set(eventRef, { ...value, leaseUntil: null, replayClaimId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

/** Idempotent immutable-token ledger and a source-specific entitlement. Legacy membership is never overwritten. */
export async function persistGooglePlaySubscription(input: { uid: string; packageName: string; subscription: GooglePlaySubscription }): Promise<GooglePlayEntitlementDto> {
  const { uid, packageName, subscription } = input; const accountHash = hashGooglePlayAccount(uid);
  if (subscription.accountHash && subscription.accountHash !== accountHash) throw new Error('Google Play account binding does not match this user.');
  const db = getAdminFirestore(); const purchaseHash = hashGooglePlayPurchaseToken(subscription.purchaseToken);
  const purchaseRef = db.collection('googlePlayPurchases').doc(purchaseHash); const businessRef = db.collection('businesses').doc(uid);
  const linkedPurchaseHash = subscription.linkedPurchaseToken ? hashGooglePlayPurchaseToken(subscription.linkedPurchaseToken) : null;
  await db.runTransaction(async tx => {
    const linkedRef = linkedPurchaseHash ? db.collection('googlePlayPurchases').doc(linkedPurchaseHash) : null; const expiredRef = subscription.expiredPurchaseToken ? db.collection('googlePlayPurchases').doc(hashGooglePlayPurchaseToken(subscription.expiredPurchaseToken)) : null;
    const [purchase, business, linked, expired] = await Promise.all([tx.get(purchaseRef), tx.get(businessRef), linkedRef ? tx.get(linkedRef) : Promise.resolve(null), expiredRef ? tx.get(expiredRef) : Promise.resolve(null)]);
    if (!business.exists || business.get('status') !== 'active') throw new Error('Business is not eligible for a membership.');
    const businessType = business.get('businessType');
    if (businessType !== 'services' && businessType !== undefined && businessType !== null) throw new Error('Google Play purchase is only available for Servicios.');
    if (activeLegacyMembership(business.get('membership')).active) throw new Error('An existing membership must expire before Google Play purchase.');
    if (purchase.exists && purchase.get('uid') !== uid) throw new Error('Purchase token is already bound to another account.');
    const retainedOwner = !subscription.accountHash
      ? verifiedLedgerOwner(purchase, packageName, subscription.purchaseToken, '')
        ?? (expired && subscription.expiredPurchaseToken ? verifiedLedgerOwner(expired, packageName, subscription.expiredPurchaseToken, '') : null)
      : null;
    if (subscription.accountHash !== accountHash && retainedOwner !== uid) throw new Error('Expired purchase recovery does not match this user.');
    if (linked && linked.exists && (linked.get('uid') !== uid || linked.get('accountHash') !== accountHash)) throw new Error('Linked purchase belongs to another account.');
    const now = Timestamp.now(); const expiresAt = subscription.expiresAt ? Timestamp.fromDate(subscription.expiresAt) : null;
    tx.set(purchaseRef, {
      uid, accountHash, packageName, productId: GOOGLE_PLAY_PRODUCT_ID, vertical: 'services',
      // Server-only evidence used for re-query and acknowledgement; never returned or logged.
      purchaseToken: subscription.purchaseToken, purchaseHash, subscriptionState: subscription.rawState,
      entitlementStatus: subscription.status, expiresAt, autoRenewing: subscription.autoRenewing,
      acknowledgementState: subscription.acknowledgement, orderId: subscription.orderId, linkedPurchaseHash,
      isEntitled: subscriptionIsEntitled(subscription), updatedAt: now,
      firstVerifiedAt: purchase.exists ? purchase.get('firstVerifiedAt') ?? now : now,
      providerTokenUsableUntil: subscription.expiresAt ? Timestamp.fromMillis(subscription.expiresAt.getTime() + 60 * 24 * 60 * 60 * 1000) : null,
    }, { merge: true });
    const current = business.get('googlePlayMembership') as { purchaseHash?: unknown; status?: unknown; expiresAt?: { toMillis?: () => number } | null } | undefined;
    const currentHash = typeof current?.purchaseHash === 'string' ? current.purchaseHash : null;
    // Only the current token or its authoritative replacement may project to
    // the business. Late RTDN/reconcile for historical tokens stay ledger-only.
    const currentExpiry = current?.expiresAt?.toMillis?.() ?? 0;
    const currentEntitled = (current?.status === 'active' || current?.status === 'grace_period') && currentExpiry > Date.now();
    const mayProject = !currentHash || currentHash === purchaseHash || linkedPurchaseHash === currentHash || (!currentEntitled && subscriptionIsEntitled(subscription));
    if (!mayProject) tx.set(purchaseRef, { overlapReview: true, overlapWithPurchaseHash: currentHash, overlapRecordedAt: now }, { merge: true });
    // server-membership resolves this with legacy membership; do not collapse sources here.
    if (mayProject) tx.set(businessRef, { googlePlayMembership: {
      type: 'pro', source: 'GOOGLE_PLAY', vertical: 'services', productId: GOOGLE_PLAY_PRODUCT_ID, purchaseHash,
      status: subscription.status, expiresAt, autoRenewEnabled: subscription.autoRenewing,
      acknowledgementState: subscription.acknowledgement, updatedAt: now,
    } }, { merge: true });
    if (linkedPurchaseHash) tx.set(db.collection('googlePlayPurchases').doc(linkedPurchaseHash), { replacementPurchaseHash: purchaseHash, replacementRecordedAt: now }, { merge: true });
  });
  return dto(subscription, subscription.acknowledgement === 'acknowledged' ? 'acknowledged' : 'pending_retry');
}

export async function markGooglePlayAcknowledgement(purchaseToken: string, acknowledged: boolean): Promise<void> { await getAdminFirestore().collection('googlePlayPurchases').doc(hashGooglePlayPurchaseToken(purchaseToken)).set({ acknowledgementState: acknowledged ? 'acknowledged' : 'pending', acknowledgementAttemptedAt: FieldValue.serverTimestamp() }, { merge: true }); }
export async function googlePlayStatusForUser(uid: string): Promise<GooglePlayEntitlementDto | null> {
  const record = (await getAdminFirestore().collection('businesses').doc(uid).get()).get('googlePlayMembership') as Record<string, unknown> | undefined;
  if (!record || record.type !== 'pro' || record.source !== 'GOOGLE_PLAY' || record.vertical !== 'services' || record.productId !== GOOGLE_PLAY_PRODUCT_ID || typeof record.purchaseHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.purchaseHash) || typeof record.status !== 'string') return null;
  const expiresAt = (record.expiresAt as { toDate?: () => Date } | null)?.toDate?.() ?? null;
  const allowedStatus = new Set<GooglePlaySubscription['status']>(['active', 'grace_period', 'pending', 'on_hold', 'paused', 'expired', 'revoked']);
  if (!allowedStatus.has(record.status as GooglePlaySubscription['status']) || !expiresAt || !Number.isFinite(expiresAt.getTime()) || ((record.status === 'active' || record.status === 'grace_period') && expiresAt.getTime() <= Date.now())) return null;
  return { plan: 'pro', status: record.status as GooglePlaySubscription['status'], expiresAt: expiresAt?.toISOString() ?? null, autoRenewing: record.autoRenewEnabled === true, source: 'google_play', acknowledgement: record.acknowledgementState === 'acknowledged' ? 'acknowledged' : 'pending_retry' };
}

/** Server-only repair loop: re-queries Google; it never creates, refunds, or cancels a subscription. */
export async function reconcileGooglePlaySubscriptions(limit = 25): Promise<{ checked: number; processed: number; failed: number }> {
  const db = getAdminFirestore(); const pageSize = Math.min(Math.max(limit, 1), 100);
  const stateRef = db.collection('googlePlayReconciliationState').doc('subscriptions-v1');
  const state = await stateRef.get(); const cursor = state.get('cursor');
  let query = db.collection('googlePlayPurchases').orderBy(FieldPath.documentId()).limit(pageSize);
  if (typeof cursor === 'string' && cursor) query = query.startAfter(cursor);
  let rows = await query.get();
  // A completed scan wraps to the first page. This makes terminal revoked and
  // expired tokens observable without starving newer records.
  if (rows.empty && typeof cursor === 'string' && cursor) rows = await db.collection('googlePlayPurchases').orderBy(FieldPath.documentId()).limit(pageSize).get();
  let processed = 0; let failed = 0;
  for (const row of rows.docs) {
    const token = row.get('purchaseToken'); const uid = row.get('uid'); const packageName = row.get('packageName');
    if (typeof token !== 'string' || typeof uid !== 'string' || typeof packageName !== 'string') { failed += 1; continue; }
    try {
      const subscription = await getGooglePlaySubscription(packageName, token);
      await persistGooglePlaySubscription({ uid, packageName, subscription });
      if (subscription.acknowledgement === 'pending') {
        try { await acknowledgeGooglePlaySubscription(packageName, subscription); await markGooglePlayAcknowledgement(token, true); }
        catch { await markGooglePlayAcknowledgement(token, false); throw new Error('acknowledgement retry required'); }
      }
      processed += 1;
    } catch { failed += 1; await row.ref.set({ reconciliationFailedAt: FieldValue.serverTimestamp(), reconciliationAttempts: FieldValue.increment(1) }, { merge: true }); }
  }
  // RTDN can precede the account-registration request. Keep its token private
  // in a durable replay task and retry it here instead of acknowledging a lost
  // notification with no subsequent path to entitlement.
  const waiting = await db.collection('googlePlayRtdnEvents').where('status', '==', 'awaiting_account_mapping').where('nextAttemptAt', '<=', new Date()).orderBy('nextAttemptAt').limit(pageSize).get();
  const retryable = await db.collection('googlePlayRtdnEvents').where('status', '==', 'retryable_failure').where('nextAttemptAt', '<=', new Date()).orderBy('nextAttemptAt').limit(pageSize).get();
  const expiredReplays = await db.collection('googlePlayRtdnEvents').where('status', '==', 'replaying').where('leaseUntil', '<=', new Date()).orderBy('leaseUntil').limit(pageSize).get();
  const staleUnmapped = [...waiting.docs, ...retryable.docs].filter(event => {
    const received = event.get('receivedAt')?.toMillis?.();
    return typeof received === 'number' && received < Date.now() - 15 * 60_000;
  }).length;
  if (staleUnmapped) await reportGooglePlayOperationalIncident({ kind: 'rtdn_unmapped', pending: staleUnmapped });
  for (const event of [...waiting.docs, ...retryable.docs, ...expiredReplays.docs]) {
    const claim = await claimGooglePlayRtdnReplay(event.id);
    if (!claim) continue;
    try {
      const subscription = await getGooglePlaySubscription(claim.packageName, claim.purchaseToken);
      const uid = await resolveGooglePlaySubscriptionOwner({ packageName: claim.packageName, subscription });
      if (!uid) { await completeGooglePlayRtdnReplay(event.id, claim.claimId, { status: 'awaiting_account_mapping', nextAttemptAt: new Date(Date.now() + 5 * 60_000) }); continue; }
      await persistGooglePlaySubscription({ uid, packageName: claim.packageName, subscription });
      if (subscription.acknowledgement === 'pending') {
        try { await acknowledgeGooglePlaySubscription(claim.packageName, subscription); await markGooglePlayAcknowledgement(claim.purchaseToken, true); }
        catch { await markGooglePlayAcknowledgement(claim.purchaseToken, false); throw new Error('acknowledgement retry required'); }
      }
      if (await completeGooglePlayRtdnReplay(event.id, claim.claimId, { status: 'processed', replayedAt: FieldValue.serverTimestamp() })) processed += 1;
    } catch { failed += 1; await completeGooglePlayRtdnReplay(event.id, claim.claimId, { status: 'retryable_failure', replayFailedAt: FieldValue.serverTimestamp(), nextAttemptAt: new Date(Date.now() + 5 * 60_000) }).catch(() => undefined); }
  }
  await stateRef.set({ cursor: rows.docs.at(-1)?.id ?? null, lastRunAt: FieldValue.serverTimestamp(), lastRun: { checked: rows.size, processed, failed } }, { merge: true });
  return { checked: rows.size, processed, failed };
}
