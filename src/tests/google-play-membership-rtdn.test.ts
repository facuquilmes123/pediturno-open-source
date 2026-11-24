import { beforeEach, describe, expect, it, vi } from 'vitest';

type RecordData = Record<string, unknown>;
const state = vi.hoisted(() => ({ records: new Map<string, RecordData>(), reconciliationRows: [] as string[], tail: Promise.resolve() }));
const publisher = vi.hoisted(() => ({ getGooglePlaySubscription: vi.fn(), acknowledgeGooglePlaySubscription: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { serverTimestamp: () => 'server-time', increment: (value: number) => ({ increment: value }) },
  Timestamp: { now: () => ({ now: true }), fromDate: (value: Date) => value, fromMillis: (value: number) => new Date(value) },
}));
vi.mock('@/lib/payments/google-play', () => ({
  GOOGLE_PLAY_PRODUCT_ID: 'pediturno_servicios_pro_monthly',
  hashGooglePlayAccount: (uid: string) => `hash:${uid}`,
  hashGooglePlayPurchaseToken: (token: string) => `token:${token}`,
  subscriptionIsEntitled: () => true,
  acknowledgeGooglePlaySubscription: publisher.acknowledgeGooglePlaySubscription,
  getGooglePlaySubscription: publisher.getGooglePlaySubscription,
}));
vi.mock('@/lib/firebase-admin', () => ({
  getAdminFirestore: () => ({
    collection: (name: string) => {
      const ref = (id: string) => ({
        id, path: `${name}/${id}`,
        get: async () => { const value = state.records.get(`${name}/${id}`); return { exists: !!value, get: (key: string) => value?.[key] }; },
        set: async (value: RecordData) => state.records.set(`${name}/${id}`, { ...(state.records.get(`${name}/${id}`) ?? {}), ...value }),
      });
      const query = {
        where: () => query, orderBy: () => query, limit: () => query, startAfter: () => query,
        get: async () => {
          const ids = name === 'googlePlayPurchases' ? state.reconciliationRows : [...state.records.keys()].filter(key => key.startsWith(`${name}/`)).map(key => key.slice(name.length + 1));
          const docs = ids.map(id => ({ id, get: (key: string) => state.records.get(`${name}/${id}`)?.[key], ref: ref(id) }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
      };
      return { doc: ref, where: query.where, orderBy: query.orderBy, limit: query.limit };
    },
    runTransaction: async (callback: (tx: { get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>; set: (ref: { path: string }, value: RecordData) => void }) => Promise<unknown>) => {
      const run = state.tail.then(() => callback({
        get: ref => ref.get(),
        set: (ref, value) => state.records.set(ref.path, { ...(state.records.get(ref.path) ?? {}), ...value }),
      }));
      state.tail = run.then(() => undefined, () => undefined);
      return run;
    },
  }),
}));

import { claimGooglePlayRtdnReplay, completeGooglePlayRtdnReplay, persistGooglePlaySubscription, reconcileGooglePlaySubscriptions, registerGooglePlayAccount, resolveGooglePlaySubscriptionOwner } from '@/lib/payments/google-play-membership';

describe('Google Play expired-token ownership and RTDN replay', () => {
  beforeEach(() => { state.records.clear(); state.reconciliationRows = []; state.tail = Promise.resolve(); vi.clearAllMocks(); });

  it.each(['pro', 'trial', 'lifetime'])('blocks a second sale while legacy %s is current without rewriting either source', async type => {
    const membership = { type, expiresAt: { toDate: () => new Date('2035-01-01T00:00:00.000Z') } };
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services', membership });
    await expect(registerGooglePlayAccount('owner-a')).resolves.toMatchObject({ purchaseAllowed: false, reason: 'existing_membership' });
    expect(state.records.get('businesses/owner-a')?.membership).toBe(membership);
    expect(state.records.has('googlePlayAccounts/hash:owner-a')).toBe(false);
    expect([...state.records.keys()].filter(key => key.startsWith('googlePlayPurchases/'))).toHaveLength(0);
  });

  it.each(['active', 'grace_period'])('does not offer a second Play purchase during %s', async status => {
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services', googlePlayMembership: { status, expiresAt: { toDate: () => new Date('2035-01-01T00:00:00.000Z') } } });
    await expect(registerGooglePlayAccount('owner-a')).resolves.toMatchObject({ purchaseAllowed: false, reason: 'existing_play_membership' });
    expect(state.records.has('googlePlayAccounts/hash:owner-a')).toBe(false);
  });

  it('preserves an expired legacy membership when recording the new verified Play source', async () => {
    const legacy = { type: 'pro', expiresAt: { toDate: () => new Date('2020-01-01T00:00:00.000Z') }, historicalReference: 'legacy-history' };
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services', membership: legacy });
    await persistGooglePlaySubscription({ uid: 'owner-a', packageName: 'com.pediturno.servicios', subscription: {
      accountHash: 'hash:owner-a', purchaseToken: 'new-play-token', productId: 'pediturno_servicios_pro_monthly',
      linkedPurchaseToken: null, expiredPurchaseToken: null, acknowledgement: 'acknowledged',
      expiresAt: new Date('2035-01-01T00:00:00.000Z'), status: 'active', autoRenewing: true,
      rawState: 'SUBSCRIPTION_STATE_ACTIVE', orderId: null
    } as never });
    expect(state.records.get('businesses/owner-a')?.membership).toBe(legacy);
    expect(state.records.get('businesses/owner-a')?.googlePlayMembership).toMatchObject({ status: 'active' });
    expect(state.records.get('googlePlayPurchases/token:new-play-token')).toMatchObject({ uid: 'owner-a', isEntitled: true });
  });

  it.each(['on_hold', 'paused', 'pending'])('requires managing the existing %s subscription instead of selling another plan', async status => {
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services', googlePlayMembership: { status, expiresAt: { toDate: () => new Date('2020-01-01T00:00:00.000Z') } } });
    await expect(registerGooglePlayAccount('owner-a')).resolves.toMatchObject({ purchaseAllowed: false, reason: 'existing_play_membership' });
    expect(state.records.has('googlePlayAccounts/hash:owner-a')).toBe(false);
  });

  it('never rebinds an existing purchase token to another UID', async () => {
    state.records.set('businesses/owner-b', { status: 'active', businessType: 'services' });
    const original = { uid: 'owner-a', accountHash: 'hash:owner-a', firstVerifiedAt: 'immutable-origin' };
    state.records.set('googlePlayPurchases/token:shared-token', original);
    await expect(persistGooglePlaySubscription({ uid: 'owner-b', packageName: 'com.pediturno.servicios', subscription: { accountHash: 'hash:owner-b', purchaseToken: 'shared-token', productId: 'pediturno_servicios_pro_monthly', acknowledgement: 'acknowledged', expiresAt: new Date('2035-01-01T00:00:00.000Z'), status: 'active' } as never })).rejects.toThrow('already bound');
    expect(state.records.get('googlePlayPurchases/token:shared-token')).toBe(original);
    expect(state.records.get('businesses/owner-b')).not.toHaveProperty('googlePlayMembership');
  });

  it('reports a failed acknowledgement to the scheduler and recovers without duplicating the purchase', async () => {
    state.reconciliationRows = ['token:pending-token'];
    state.records.set('googlePlayPurchases/token:pending-token', { uid: 'owner-a', packageName: 'com.pediturno.servicios', purchaseToken: 'pending-token' });
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services' });
    publisher.getGooglePlaySubscription.mockResolvedValue({ accountHash: 'hash:owner-a', purchaseToken: 'pending-token', productId: 'pediturno_servicios_pro_monthly', linkedPurchaseToken: null, expiresAt: new Date('2030-01-01T00:00:00.000Z'), status: 'active', autoRenewing: true, acknowledgement: 'pending', orderId: null, rawState: 'SUBSCRIPTION_STATE_ACTIVE' });
    publisher.acknowledgeGooglePlaySubscription.mockResolvedValue(undefined).mockRejectedValueOnce(new Error('temporary provider failure'));

    await expect(reconcileGooglePlaySubscriptions(1)).resolves.toEqual({ checked: 1, processed: 0, failed: 1 });
    expect(state.records.get('googlePlayPurchases/token:pending-token')).toMatchObject({ acknowledgementState: 'pending', reconciliationFailedAt: 'server-time' });
    await expect(reconcileGooglePlaySubscriptions(1)).resolves.toEqual({ checked: 1, processed: 1, failed: 0 });
    expect(state.records.get('googlePlayPurchases/token:pending-token')).toMatchObject({ acknowledgementState: 'acknowledged', uid: 'owner-a' });
    expect([...state.records.keys()].filter(key => key.startsWith('googlePlayPurchases/'))).toHaveLength(1);
  });

  it('resolves an out-of-app resubscription only from a matching server ledger', async () => {
    state.records.set('googlePlayPurchases/token:expired-token', { uid: 'owner-a', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'expired-token' });
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription: { accountHash: '', expiredPurchaseToken: 'expired-token' } as never })).resolves.toBe('owner-a');
    state.records.set('googlePlayPurchases/token:expired-token', { uid: 'owner-b', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'expired-token' });
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription: { accountHash: '', expiredPurchaseToken: 'expired-token' } as never })).resolves.toBeNull();
  });

  it('retains the verified token owner after acknowledgement removes the expired-token context', async () => {
    const original = { uid: 'owner-a', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'known-token', firstVerifiedAt: 'original-verification' };
    state.records.set('googlePlayPurchases/token:known-token', original);
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services' });
    const subscription = { accountHash: '', expiredPurchaseToken: null, purchaseToken: 'known-token', productId: 'pediturno_servicios_pro_monthly', linkedPurchaseToken: null, acknowledgement: 'acknowledged', expiresAt: new Date('2035-01-01T00:00:00.000Z'), status: 'active', rawState: 'SUBSCRIPTION_STATE_ACTIVE' } as never;
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription })).resolves.toBe('owner-a');
    await persistGooglePlaySubscription({ uid: 'owner-a', packageName: 'com.pediturno.servicios', subscription });
    expect(state.records.get('googlePlayPurchases/token:known-token')).toMatchObject({ uid: 'owner-a', accountHash: 'hash:owner-a', firstVerifiedAt: 'original-verification' });
  });

  it.each([
    { packageName: 'com.pediturno.other' }, { productId: 'other-product' }, { vertical: 'courts' },
    { purchaseToken: 'not-the-same-token' }, { accountHash: 'hash:owner-b' },
  ])('rejects recovery from a mismatched stored token: %j', async override => {
    state.records.set('googlePlayPurchases/token:known-token', { uid: 'owner-a', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'known-token', ...override });
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription: { accountHash: '', expiredPurchaseToken: null, purchaseToken: 'known-token' } as never })).resolves.toBeNull();
  });

  it('never overrides a conflicting explicit Google binding using an older purchase', async () => {
    state.records.set('googlePlayPurchases/token:expired-token', { uid: 'owner-a', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'expired-token' });
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services' });
    const subscription = { accountHash: 'hash:owner-b', expiredPurchaseToken: 'expired-token', purchaseToken: 'new-token', productId: 'pediturno_servicios_pro_monthly', linkedPurchaseToken: null, acknowledgement: 'acknowledged', expiresAt: new Date('2035-01-01T00:00:00.000Z'), status: 'active' } as never;
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription })).resolves.toBeNull();
    await expect(persistGooglePlaySubscription({ uid: 'owner-a', packageName: 'com.pediturno.servicios', subscription })).rejects.toThrow();
    expect(state.records.has('googlePlayPurchases/token:new-token')).toBe(false);
  });
  it('never assigns an acknowledged unbound token without a prior verified ledger', async () => {
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services' });
    const subscription = { accountHash: '', expiredPurchaseToken: null, purchaseToken: 'unknown-token', productId: 'pediturno_servicios_pro_monthly', linkedPurchaseToken: null, acknowledgement: 'acknowledged', expiresAt: new Date('2035-01-01T00:00:00.000Z'), status: 'active' } as never;
    await expect(resolveGooglePlaySubscriptionOwner({ packageName: 'com.pediturno.servicios', subscription })).resolves.toBeNull();
    await expect(persistGooglePlaySubscription({ uid: 'owner-a', packageName: 'com.pediturno.servicios', subscription })).rejects.toThrow();
    expect(state.records.has('googlePlayPurchases/token:unknown-token')).toBe(false);
    expect(state.records.get('businesses/owner-a')).not.toHaveProperty('googlePlayMembership');
  });

  it('leases an awaiting event once and never lets a stale failure overwrite processed', async () => {
    state.records.set('googlePlayRtdnEvents/event-1', { status: 'awaiting_account_mapping', nextAttemptAt: new Date(0), purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    const [first, second] = await Promise.all([claimGooglePlayRtdnReplay('event-1', 1), claimGooglePlayRtdnReplay('event-1', 1)]);
    const claim = first ?? second;
    expect(claim).toMatchObject({ purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    expect(first && second).toBeNull();
    const [processed, staleFailure] = await Promise.all([
      completeGooglePlayRtdnReplay('event-1', claim!.claimId, { status: 'processed' }),
      completeGooglePlayRtdnReplay('event-1', 'stale-claim', { status: 'awaiting_account_mapping', nextAttemptAt: new Date(10_000) }),
    ]);
    expect(processed).toBe(true);
    expect(staleFailure).toBe(false);
    expect(state.records.get('googlePlayRtdnEvents/event-1')).toMatchObject({ status: 'processed' });
  });

  it('reclaims a replay only after its crashed worker lease has expired', async () => {
    state.records.set('googlePlayRtdnEvents/event-crashed', { status: 'replaying', replayClaimId: 'crashed-claim', leaseUntil: new Date(0), purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    await expect(claimGooglePlayRtdnReplay('event-crashed', 1)).resolves.toMatchObject({ purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    state.records.set('googlePlayRtdnEvents/event-live', { status: 'replaying', replayClaimId: 'live-claim', leaseUntil: new Date(10_000), purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    await expect(claimGooglePlayRtdnReplay('event-live', 1)).resolves.toBeNull();
  });

  it('claims a due temporary-delivery failure for the independent reconciliation worker', async () => {
    state.records.set('googlePlayRtdnEvents/temporary-provider-failure', { status: 'retryable_failure', nextAttemptAt: new Date(0), purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    await expect(claimGooglePlayRtdnReplay('temporary-provider-failure', 1)).resolves.toMatchObject({ purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
  });

  it('reconciles an out-of-app event without expired external account identifiers', async () => {
    state.records.set('googlePlayRtdnEvents/event-2', { status: 'awaiting_account_mapping', nextAttemptAt: new Date(0), purchaseToken: 'purchase-token', packageName: 'com.pediturno.servicios' });
    state.records.set('googlePlayPurchases/token:expired-token', { uid: 'owner-a', accountHash: 'hash:owner-a', packageName: 'com.pediturno.servicios', productId: 'pediturno_servicios_pro_monthly', vertical: 'services', purchaseToken: 'expired-token' });
    state.records.set('businesses/owner-a', { status: 'active', businessType: 'services' });
    publisher.getGooglePlaySubscription.mockResolvedValue({ accountHash: '', expiredPurchaseToken: 'expired-token', purchaseToken: 'purchase-token', productId: 'pediturno_servicios_pro_monthly', linkedPurchaseToken: null, expiresAt: new Date('2030-01-01T00:00:00.000Z'), status: 'active', autoRenewing: true, acknowledgement: 'acknowledged', orderId: null, rawState: 'SUBSCRIPTION_STATE_ACTIVE' });
    await expect(reconcileGooglePlaySubscriptions(1)).resolves.toMatchObject({ processed: 1, failed: 0 });
    expect(state.records.get('googlePlayRtdnEvents/event-2')).toMatchObject({ status: 'processed' });
  });
});
