import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuth, getAdminFirestore, sendTestPushNotification } = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getAdminFirestore: vi.fn(),
  sendTestPushNotification: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({ getAuth }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore }));
vi.mock('@/services/push', () => ({ sendTestPushNotification }));

import { POST } from '@/app/api/push/test/route';

function request() {
  return new Request('https://pediturno.test/api/push/test', {
    method: 'POST',
    headers: { Authorization: 'Bearer synthetic-token' },
  }) as any;
}

describe('test push endpoint', () => {
  beforeEach(() => {
    getAuth.mockReturnValue({ verifyIdToken: vi.fn(async () => ({ uid: 'owner-1' })) });
    getAdminFirestore.mockReturnValue({
      collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
      runTransaction: async (work: (transaction: any) => Promise<void>) => work({
        get: vi.fn(async (ref: { name: string }) => ref.name === 'businesses'
          ? { exists: true, data: () => ({ status: 'active', membership: { type: 'lifetime' } }) }
          : { exists: false, get: () => undefined }),
        set: vi.fn(),
      }),
    });
  });

  it('does not report success when the account has no registered endpoint', async () => {
    sendTestPushNotification.mockResolvedValue({ attempted: 0, delivered: 0 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'No push subscription is registered' });
  });

  it('does not report success when delivery fails or the service is unavailable', async () => {
    sendTestPushNotification.mockResolvedValueOnce({ attempted: 1, delivered: 0 });
    expect((await POST(request())).status).toBe(503);

    sendTestPushNotification.mockResolvedValueOnce({ attempted: 0, delivered: 0, unavailable: true });
    expect((await POST(request())).status).toBe(503);
  });

  it('reports the number of endpoints actually delivered', async () => {
    sendTestPushNotification.mockResolvedValue({ attempted: 1, delivered: 1 });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, delivered: 1 });
  });
});
