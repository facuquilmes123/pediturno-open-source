import crypto from 'crypto';

export const MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS = 5;

export type SafePushSubscription = {
  endpoint: string;
  keys: { auth: string; p256dh: string };
};

const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
      && (ALLOWED_PUSH_HOSTS.has(hostname) || hostname.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
}

export function normalizePushSubscription(value: unknown): SafePushSubscription | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as { endpoint?: unknown; keys?: { auth?: unknown; p256dh?: unknown } };
  if (!isAllowedPushEndpoint(input.endpoint)
      || typeof input.keys?.auth !== 'string'
      || typeof input.keys?.p256dh !== 'string'
      || !/^[A-Za-z0-9_-]{8,256}$/.test(input.keys.auth)
      || !/^[A-Za-z0-9_-]{40,512}$/.test(input.keys.p256dh)) {
    return null;
  }
  return { endpoint: input.endpoint, keys: { auth: input.keys.auth, p256dh: input.keys.p256dh } };
}

export function pushSubscriptionId(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

export function isCanonicalPushSubscriptionDocument(documentId: string, endpoint: string): boolean {
  return documentId === pushSubscriptionId(endpoint);
}
