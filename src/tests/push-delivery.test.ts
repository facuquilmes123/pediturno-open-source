import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { pushSubscriptionId } from '@/lib/push-security';
const mocks = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), remove: vi.fn(), docs: [] as any[] }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.send } }));
import { sendPushNotification } from '@/services/push';
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'synthetic-public'); vi.stubEnv('VAPID_PRIVATE_KEY', 'synthetic-private'); vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.invalid');
  mocks.docs = [0, 1].map(index => {
    const subscription = { endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${index}`, keys: { auth: 'auth_key_1234567890', p256dh: 'p256dh_key_1234567890123456789012345678901234567890' } };
    return { id: pushSubscriptionId(subscription.endpoint), get: () => subscription, ref: { delete: mocks.remove } };
  });
  mocks.remove.mockResolvedValue(undefined);
  mocks.db.mockReturnValue({ collection: (name: string) => name === 'businesses' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: 'active', membership: { type: 'lifetime' } }) }) }) } : { where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: mocks.docs }) }) }) } });
});
afterEach(() => vi.unstubAllEnvs());
describe('bounded push delivery', () => {
  it('starts both device deliveries before waiting for a slow device', async () => {
    const release: Array<() => void> = [];
    mocks.send.mockImplementation(() => new Promise<void>(resolve => release.push(resolve)));
    const pending = sendPushNotification('owner', { title: 'Prueba', body: 'Reserva' });
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    release.forEach(resolve => resolve());
    expect(await pending).toEqual({ attempted: 2, delivered: 2 });
  });
  it('removes expired endpoints and preserves successful deliveries', async () => {
    mocks.send.mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce(undefined);
    expect(await sendPushNotification('owner', { title: 'Prueba', body: 'Reserva' })).toEqual({ attempted: 2, delivered: 1 });
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it('does not deliver to a legacy endpoint record from a previous account', async () => {
    mocks.docs = [{ ...mocks.docs[0], id: 'legacy-random-id' }];
    expect(await sendPushNotification('owner', { title: 'Prueba', body: 'Reserva' })).toEqual({ attempted: 0, delivered: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
