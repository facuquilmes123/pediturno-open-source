import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ record: null as Record<string, unknown> | null, verifyGooglePlayPushOidc: vi.fn(), assertGooglePlayPackage: vi.fn(), getGooglePlaySubscription: vi.fn(), acknowledgeGooglePlaySubscription: vi.fn(), persistGooglePlaySubscription: vi.fn(), markGooglePlayAcknowledgement: vi.fn(), resolveGooglePlaySubscriptionOwner: vi.fn(), eventSet: vi.fn(), transactionGet: vi.fn(), accountGet: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: vi.fn(() => 'server-time'), increment: vi.fn(() => 'increment') } }));
vi.mock('@/lib/payments/google-play', () => ({ GooglePlayConfigurationError: class extends Error {}, GooglePlayProviderError: class extends Error {}, GooglePlayVerificationError: class extends Error {}, verifyGooglePlayPushOidc: mocks.verifyGooglePlayPushOidc, assertGooglePlayPackage: mocks.assertGooglePlayPackage, getGooglePlaySubscription: mocks.getGooglePlaySubscription, acknowledgeGooglePlaySubscription: mocks.acknowledgeGooglePlaySubscription }));
vi.mock('@/lib/payments/google-play-membership', () => ({ persistGooglePlaySubscription: mocks.persistGooglePlaySubscription, markGooglePlayAcknowledgement: mocks.markGooglePlayAcknowledgement, resolveGooglePlaySubscriptionOwner: mocks.resolveGooglePlaySubscriptionOwner }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => ({ collection: (name: string) => ({ doc: () => name === 'googlePlayRtdnEvents' ? { set: mocks.eventSet } : { get: mocks.accountGet } }), runTransaction: async (callback: (tx: unknown) => unknown) => callback({ get: mocks.transactionGet, set: (_ref: unknown, value: Record<string, unknown>, options: unknown) => { mocks.record = { ...mocks.record, ...value }; if (value.status !== 'processing') void mocks.eventSet(value, options); } }) }) }));
import { POST } from '@/app/api/google-play/notifications/route';
import { GooglePlayVerificationError } from '@/lib/payments/google-play';
const payload = (messageId = 'rtdn-1') => ({ message: { messageId, data: Buffer.from(JSON.stringify({ packageName: 'com.pediturno.servicios', subscriptionNotification: { version: '1.0', notificationType: 13, purchaseToken: 'purchase-token-1234567890' } })).toString('base64') } });
const request = (body = payload()) => new Request('https://pediturno.test/api/google-play/notifications', { method: 'POST', headers: { authorization: 'Bearer pubsub-oidc-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
describe('Google Play RTDN contract', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.record = null; mocks.verifyGooglePlayPushOidc.mockResolvedValue(undefined); mocks.assertGooglePlayPackage.mockReturnValue('com.pediturno.servicios'); mocks.transactionGet.mockImplementation(async () => ({ exists: !!mocks.record, get: (key: string) => mocks.record?.[key] })); mocks.accountGet.mockResolvedValue({ get: () => 'owner-a' }); mocks.resolveGooglePlaySubscriptionOwner.mockResolvedValue('owner-a'); mocks.getGooglePlaySubscription.mockResolvedValue({ productId: 'pediturno_servicios_pro_monthly', acknowledgement: 'acknowledged', accountHash: 'account-hash' }); mocks.persistGooglePlaySubscription.mockResolvedValue(undefined); mocks.eventSet.mockResolvedValue(undefined); });
  it('rejects unauthenticated pushes before decoding or querying Publisher', async () => { mocks.verifyGooglePlayPushOidc.mockRejectedValue(new Error('bad oidc')); const response = await POST(request()); expect(response.status).toBe(401); expect(mocks.getGooglePlaySubscription).not.toHaveBeenCalled(); });
  it('persists a private replay task when a temporary provider or datastore failure interrupts delivery', async () => {
    mocks.getGooglePlaySubscription.mockRejectedValueOnce(new Error('synthetic-temporary-failure'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.eventSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'retryable_failure', purchaseToken: 'purchase-token-1234567890', packageName: 'com.pediturno.servicios', nextAttemptAt: expect.any(Date) }), { merge: true });
  });
  it('acknowledges a permanently rejected package without repeatedly querying Publisher', async () => {
    mocks.assertGooglePlayPackage.mockImplementationOnce(() => { throw new GooglePlayVerificationError('synthetic-other-package'); });
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(mocks.getGooglePlaySubscription).not.toHaveBeenCalled();
    expect(mocks.eventSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'permanent_failure' }), { merge: true });
  });
  it('deduplicates a processed Pub/Sub message without a second provider query', async () => { mocks.transactionGet.mockResolvedValue({ exists: true, get: (key: string) => key === 'status' ? 'processed' : undefined }); const response = await POST(request()); expect(response.status).toBe(204); expect(mocks.getGooglePlaySubscription).not.toHaveBeenCalled(); });
  it('does not start another delivery while the independent replay worker owns a live lease', async () => {
    mocks.record = { status: 'replaying', leaseUntil: { toMillis: () => Date.now() + 60_000 } };
    expect((await POST(request())).status).toBe(204);
    expect(mocks.getGooglePlaySubscription).not.toHaveBeenCalled();
  });
  it('does not let a late delivery failure overwrite a completed replay', async () => {
    mocks.getGooglePlaySubscription.mockImplementationOnce(async () => {
      mocks.record = { ...mocks.record, status: 'processed' };
      throw new Error('synthetic-delayed-failure');
    });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.record?.status).toBe('processed');
    expect(mocks.eventSet).not.toHaveBeenCalled();
  });
  it('records an out-of-order notification until the account mapping exists', async () => { mocks.resolveGooglePlaySubscriptionOwner.mockResolvedValue(null); const response = await POST(request(payload('out-of-order-1'))); expect(response.status).toBe(204); expect(mocks.getGooglePlaySubscription).toHaveBeenCalledOnce(); expect(mocks.persistGooglePlaySubscription).not.toHaveBeenCalled(); expect(mocks.eventSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_account_mapping' }), { merge: true }); });
  it('uses the expired-token server ledger when Google omits expired external account identifiers', async () => { mocks.getGooglePlaySubscription.mockResolvedValue({ productId: 'pediturno_servicios_pro_monthly', acknowledgement: 'acknowledged', accountHash: '', expiredPurchaseToken: 'expired-token-1234567890' }); const response = await POST(request(payload('out-of-app-without-identifiers'))); expect(response.status).toBe(204); expect(mocks.resolveGooglePlaySubscriptionOwner).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'com.pediturno.servicios' })); expect(mocks.persistGooglePlaySubscription).toHaveBeenCalledWith(expect.objectContaining({ uid: 'owner-a' })); });
});
