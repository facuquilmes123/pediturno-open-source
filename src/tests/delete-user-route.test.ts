import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyAdminRequest, getAdminFirestore, deleteUser, updateUser, revokeRefreshTokens, getUser, getStorage } = vi.hoisted(() => ({
  verifyAdminRequest: vi.fn(), getAdminFirestore: vi.fn(), deleteUser: vi.fn(), updateUser: vi.fn(), revokeRefreshTokens: vi.fn(), getUser: vi.fn(), getStorage: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore, initializeAdminApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ deleteUser, updateUser, revokeRefreshTokens, getUser }) }));
vi.mock('firebase-admin/storage', () => ({ getStorage }));

import { POST } from '@/app/api/admin/delete-user/route';

function request(userIdToDelete: string) {
  return new Request('https://pediturno.test/api/admin/delete-user', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIdToDelete }),
  }) as any;
}

function emptySnapshot() { return { empty: true, size: 0, docs: [] }; }
function documentSnapshot(exists = false) { return { exists, empty: undefined, get: vi.fn(), data: () => ({}), ref: null }; }

function deletionDb(events: string[], options: { businessExists?: boolean; financial?: boolean } = {}) {
  const businessExists = options.businessExists ?? true;
  let workspaceVersionDeleted = false;
  const ref = (name: string, id: string) => ({
    name, id,
    delete: vi.fn(async () => events.push(`${name}/${id}:delete`)),
    get: vi.fn(async () => documentSnapshot(
      (name === 'businesses' && id === 'business_1' && businessExists)
      || (name === 'pushTestRateLimits' && id === 'business_1')
      || (name === 'membershipPaymentOrderLocks' && id === 'business_1'),
    )),
  });
  return {
    collection: vi.fn((name: string) => ({
      doc: vi.fn((id = 'generated') => ref(name, id)),
      where: vi.fn(() => {
        const query = { kind: 'query', name, get: vi.fn(async () => name === 'ownerWorkspaceVersions' && !workspaceVersionDeleted ? {empty:false,size:1,docs:[{ref:ref(name,'business_1')}]} : emptySnapshot()) };
        return { limit: vi.fn(() => query) };
      }),
    })),
    runTransaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback({
      get: vi.fn(async (target: any) => {
        if (target.kind === 'query') return target.name === 'paymentOrders' && options.financial ? { ...emptySnapshot(), empty: false } : emptySnapshot();
        return documentSnapshot(target.name === 'businesses' && businessExists);
      }),
      update: vi.fn(async (target: any) => events.push(`${target.name}/${target.id}:mark-deleting`)),
      set: vi.fn(async (target: any) => events.push(`${target.name}/${target.id}:tombstone`)),
    })),
    batch: vi.fn(() => ({ delete: vi.fn((target:any) => { if (target.name === 'ownerWorkspaceVersions') workspaceVersionDeleted = true; events.push(`${target.name}/${target.id}:batch-delete`); }), commit: vi.fn() })),
  };
}

describe('delete business account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'pediturno-test.appspot.com';
    getStorage.mockReturnValue({ bucket: vi.fn(() => ({ getFiles: vi.fn(async () => [[]]) })) });
    getUser.mockResolvedValue({ email: 'owner@example.test' });
    updateUser.mockImplementation(async () => undefined);
    revokeRefreshTokens.mockImplementation(async () => undefined);
    deleteUser.mockImplementation(async () => undefined);
  });

  it('rejects malformed ids before accessing storage or authentication deletion', async () => {
    verifyAdminRequest.mockResolvedValue({ authorized: true });
    const response = await POST(request('../not-a-user'));
    expect(response.status).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('blocks deletion when any financial or membership-admin history exists', async () => {
    verifyAdminRequest.mockResolvedValue({ authorized: true });
    getAdminFirestore.mockReturnValue(deletionDb([], { financial: true }));
    const response = await POST(request('business_1'));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'FINANCIAL_RETENTION_REQUIRED' });
    expect(updateUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('persists the deletion tombstone and disables/revokes auth before business deletion', async () => {
    const events: string[] = [];
    verifyAdminRequest.mockResolvedValue({ authorized: true, email: 'admin@example.test' });
    getAdminFirestore.mockReturnValue(deletionDb(events));
    updateUser.mockImplementation(async () => { events.push('auth:disable'); });
    revokeRefreshTokens.mockImplementation(async () => { events.push('auth:revoke'); });
    deleteUser.mockImplementation(async () => { events.push('auth:delete'); });

    const response = await POST(request('business_1'));
    expect(response.status).toBe(200);
    expect(events).toEqual(expect.arrayContaining([
      'businesses/business_1:mark-deleting', 'businessDeletions/business_1:tombstone',
      'pushTestRateLimits/business_1:delete', 'membershipPaymentOrderLocks/business_1:delete',
      'ownerWorkspaceVersions/business_1:batch-delete',
      'auth:disable', 'auth:revoke', 'auth:delete', 'businesses/business_1:delete',
    ]));
    expect(events).not.toContain('businessDeletions/business_1:delete');
    expect(events.indexOf('auth:disable')).toBeLessThan(events.indexOf('auth:delete'));
    expect(events.indexOf('auth:revoke')).toBeLessThan(events.indexOf('auth:delete'));
    expect(events.indexOf('auth:delete')).toBeLessThan(events.indexOf('businesses/business_1:delete'));
  });

  it('resumes safely when Authentication was already deleted', async () => {
    const events: string[] = [];
    verifyAdminRequest.mockResolvedValue({ authorized: true, email: 'admin@example.test' });
    getAdminFirestore.mockReturnValue(deletionDb(events, { businessExists: false }));
    getUser.mockRejectedValue({ code: 'auth/user-not-found' });
    updateUser.mockRejectedValue({ code: 'auth/user-not-found' });
    revokeRefreshTokens.mockRejectedValue({ code: 'auth/user-not-found' });
    deleteUser.mockRejectedValue({ code: 'auth/user-not-found' });

    const response = await POST(request('business_1'));
    expect(response.status).toBe(200);
    expect(events).toContain('businessDeletions/business_1:tombstone');
    expect(events).not.toContain('businessDeletions/business_1:delete');
  });

  it('refuses an explicit attempt to delete the current administrator account', async () => {
    verifyAdminRequest.mockResolvedValue({ authorized: true, email: 'admin@example.test' });
    getUser.mockResolvedValue({ email: 'ADMIN@example.test' });
    const response = await POST(request('business_1'));
    expect(response.status).toBe(409);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });
});
