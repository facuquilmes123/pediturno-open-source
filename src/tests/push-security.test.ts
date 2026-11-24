import { describe, expect, it } from 'vitest';
import { isAllowedPushEndpoint, isCanonicalPushSubscriptionDocument, normalizePushSubscription, pushSubscriptionId } from '@/lib/push-security';

const keys = {
  auth: 'auth_key_1234567890',
  p256dh: 'p256dh_key_1234567890123456789012345678901234567890',
};

describe('push subscription security', () => {
  it('accepts known Web Push providers and rejects arbitrary or private destinations', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/synthetic')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/synthetic')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/synthetic')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-db5p.notify.windows.com/w/?token=synthetic')).toBe(true);
    expect(isAllowedPushEndpoint('https://example.test/push')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/push')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/push')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pass@fcm.googleapis.com/push')).toBe(false);
  });

  it('normalizes only bounded base64url key material', () => {
    expect(normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys })).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      keys,
    });
    expect(normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', keys: { ...keys, auth: 'bad value' } })).toBeNull();
  });

  it('uses a stable opaque document id without storing the endpoint in the id', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic';
    const id = pushSubscriptionId(endpoint);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain('fcm');
    expect(pushSubscriptionId(endpoint)).toBe(id);
    expect(isCanonicalPushSubscriptionDocument(id, endpoint)).toBe(true);
    expect(isCanonicalPushSubscriptionDocument('legacy-random-id', endpoint)).toBe(false);
  });
});
