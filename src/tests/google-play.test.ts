import { describe, expect, it } from 'vitest';
import { GOOGLE_PLAY_PRODUCT_ID, hashGooglePlayAccount, hashGooglePlayPurchaseToken, parseGooglePlaySubscription, subscriptionIsEntitled } from '@/lib/payments/google-play';

const future = '2030-01-01T00:00:00.000Z';
function response(overrides: Record<string, unknown> = {}) {
  return { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING', latestOrderId: 'GPA.1234-5678-9012-34567', externalAccountIdentifiers: { obfuscatedExternalAccountId: hashGooglePlayAccount('owner-a') }, lineItems: [{ productId: GOOGLE_PLAY_PRODUCT_ID, expiryTime: future, autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: 'monthly-usd4' } }], ...overrides };
}

describe('Google Play server verification parser', () => {
  process.env.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID = 'monthly-usd4';
  it('only entitles a current active purchase and does not expose its token in derived data', () => {
    const result = parseGooglePlaySubscription(response(), 'token-private-1234567890', Date.parse('2029-01-01T00:00:00Z'));
    expect(result.status).toBe('active'); expect(subscriptionIsEntitled(result, Date.parse('2029-01-01T00:00:00Z'))).toBe(true);
    expect(hashGooglePlayPurchaseToken(result.purchaseToken)).not.toContain(result.purchaseToken);
  });
  it('keeps a cancelled subscription only until its server-provided expiry', () => {
    const current = parseGooglePlaySubscription(response({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }), 'token-12345678901234567890', Date.parse('2029-01-01T00:00:00Z'));
    const elapsed = parseGooglePlaySubscription(response({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems: [{ productId: GOOGLE_PLAY_PRODUCT_ID, expiryTime: '2028-01-01T00:00:00Z', offerDetails: { basePlanId: 'monthly-usd4' } }] }), 'token-22345678901234567890', Date.parse('2029-01-01T00:00:00Z'));
    expect(current.status).toBe('active'); expect(elapsed.status).toBe('expired'); expect(subscriptionIsEntitled(elapsed, Date.parse('2029-01-01T00:00:00Z'))).toBe(false);
  });
  it.each(['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'])('never grants %s', state => {
    const item = parseGooglePlaySubscription(response({ subscriptionState: state }), `token-${state}-12345678901234567890`, Date.parse('2029-01-01T00:00:00Z'));
    expect(subscriptionIsEntitled(item, Date.parse('2029-01-01T00:00:00Z'))).toBe(false);
  });
  it('parses acknowledged purchases after Google retires their context without inventing an owner', () => {
    const parsed = parseGooglePlaySubscription(response({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED', externalAccountIdentifiers: undefined, outOfAppPurchaseContext: undefined }), 'known-token-after-ack');
    expect(parsed.accountHash).toBe('');
    expect(parsed.expiredPurchaseToken).toBeNull();
    expect(parsed.acknowledgement).toBe('acknowledged');
  });
  it('rejects a different product, absent account binding and malformed expiry', () => {
    expect(() => parseGooglePlaySubscription(response({ lineItems: [{ productId: 'other', expiryTime: future }] }), 'token-a-12345678901234567890')).toThrow();
    expect(() => parseGooglePlaySubscription(response({ externalAccountIdentifiers: {} }), 'token-b-12345678901234567890')).toThrow();
    expect(() => parseGooglePlaySubscription(response({ lineItems: [{ productId: GOOGLE_PLAY_PRODUCT_ID, expiryTime: 'bad-date', offerDetails: { basePlanId: 'monthly-usd4' } }] }), 'token-c-12345678901234567890')).toThrow();
  });
});
