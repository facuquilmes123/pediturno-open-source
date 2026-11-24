import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ send: mocks.send }) }));

import { sendAndroidNewBookingPushNotification } from '@/lib/android-push';

function setup(tokens: Array<{ token: string; platform?: string }> = [{ token: 'token-one' }, { token: 'token-two' }]) {
  const docs = tokens.map((entry, index) => ({
    id: `device-${index}`, get: (field: string) => field === 'token' ? entry.token : field === 'platform' ? entry.platform || 'android' : undefined,
    ref: { delete: mocks.remove },
  }));
  mocks.db.mockReturnValue({ collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => ({ status: 'active', membership: { type: 'lifetime' } }) }),
    collection: () => ({ limit: () => ({ get: async () => ({ size: docs.length, docs }) }) }),
  }) }) });
}

describe('Android FCM delivery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.remove.mockResolvedValue(undefined); setup(); });

  it('delivers a generic booking event without customer data', async () => {
    mocks.send.mockResolvedValue('message-id');
    expect(await sendAndroidNewBookingPushNotification('owner')).toEqual({ attempted: 2, delivered: 2 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ data: { destination: 'agenda', ownerId: 'owner' } }));
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty('notification');
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain('Cliente');
  });

  it('removes an invalid token and keeps a successful device delivery', async () => {
    mocks.send.mockRejectedValueOnce({ code: 'messaging/registration-token-not-registered' }).mockResolvedValueOnce('message-id');
    expect(await sendAndroidNewBookingPushNotification('owner')).toEqual({ attempted: 2, delivered: 1 });
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
