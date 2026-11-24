import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, getIdToken } = vi.hoisted(() => ({
  getIdToken: vi.fn(async () => 'synthetic-id-token'),
  auth: { currentUser: { uid: 'owner-b', getIdToken: vi.fn(async () => 'synthetic-id-token') } } as any,
}));

vi.mock('@/lib/firebase', () => ({ auth }));

import { initializePushNotifications, unsubscribePushNotifications } from '@/lib/push-client';

describe('push client account isolation', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    keys: { auth: 'auth_key_1234567890', p256dh: 'p256dh_key_1234567890123456789012345678901234567890' },
    options: { applicationServerKey: new Uint8Array([1, 2, 3, 4]).buffer },
    unsubscribe: vi.fn(async () => true),
  };
  const registration = { active: {}, pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn(async () => subscription) } };

  beforeEach(() => {
    auth.currentUser = { uid: 'owner-b', getIdToken };
    getIdToken.mockResolvedValue('synthetic-id-token');
    registration.pushManager.getSubscription.mockResolvedValue(subscription as any);
    registration.pushManager.subscribe.mockResolvedValue(subscription as any);
    subscription.unsubscribe.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        register: vi.fn(async () => registration),
        getRegistration: vi.fn(async () => registration),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('re-associates an existing browser endpoint with the signed-in account', async () => {
    await initializePushNotifications('owner-b');

    expect(fetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-id-token' }),
    }));
  });

  it('removes the server association and invalidates the browser endpoint before logout', async () => {
    await unsubscribePushNotifications('owner-b');

    expect(fetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }));
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('replaces an endpoint created with an old VAPID public key', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQIDBA');
    const oldSubscription = {
      ...subscription,
      endpoint: 'https://fcm.googleapis.com/fcm/send/old',
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(async () => true),
    };
    registration.pushManager.getSubscription.mockResolvedValue(oldSubscription as any);
    Object.defineProperty(window, 'Notification', { value: { permission: 'granted' }, configurable: true });

    await initializePushNotifications('owner-b');

    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
      userVisibleOnly: true,
    }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/push/subscribe', expect.objectContaining({ method: 'DELETE' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/push/subscribe', expect.objectContaining({ method: 'POST' }));
  });
  it('still unsubscribes locally and permits logout after token refresh fails', async () => {
    getIdToken.mockRejectedValue(new Error('Expired session'));
    await expect(unsubscribePushNotifications('owner-b')).resolves.toBeUndefined();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
