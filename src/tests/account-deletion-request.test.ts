import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ owner: vi.fn() }));
vi.mock('@/lib/android-owner-api', async () => ({ ...await vi.importActual<typeof import('@/lib/android-owner-api')>('@/lib/android-owner-api'), requireAndroidOwner: mocks.owner }));
import { DELETE } from '@/app/api/v1/owner/account/delete-request/route';

describe('deletion request ownership and operational deadline', () => {
  const rows = new Map<string, Record<string, unknown>>();
  const create = vi.fn((ref: { path: string }, value: Record<string, unknown>) => rows.set(ref.path, value));
  const update = vi.fn();
  const tx = { get: vi.fn(async (ref: { path: string }) => ({ exists: rows.has(ref.path), get: (key: string) => rows.get(ref.path)?.[key] })), create, update };
  beforeEach(() => {
    rows.clear(); vi.clearAllMocks();
    mocks.owner.mockResolvedValue({ uid: 'owner', authTime: Math.floor(Date.now() / 1000), db: {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
      runTransaction: async (fn: (transaction: typeof tx) => unknown) => fn(tx),
    } });
  });
  it('persists seven days from verified ownership, independently of financial retention', async () => {
    const response = await DELETE(new NextRequest('https://pediturno.test/api', { method: 'DELETE' }));
    expect(response.status).toBe(202);
    const data = rows.get('accountDeletionRequests/owner')!;
    expect(data.identityVerifiedAt).toBeInstanceOf(Timestamp);
    expect((data.operationalDueAt as Timestamp).toMillis() - (data.identityVerifiedAt as Timestamp).toMillis()).toBe(7 * 86400000);
    expect(data.operationalSlaDays).toBe(7);
    expect(data.retention).toMatchObject({ financialRecords: 'preserve' });
    expect(data.financialClosedAt).toBeUndefined();
  });
  it('returns the durable ticket without resetting the original deadline', async () => {
    const before = Timestamp.fromMillis(1234);
    rows.set('accountDeletionRequests/owner', { requestId: 'existing', status: 'deletion_requested', operationalDueAt: before });
    const response = await DELETE(new NextRequest('https://pediturno.test/api', { method: 'DELETE' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId: 'existing' });
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(rows.get('accountDeletionRequests/owner')?.operationalDueAt).toBe(before);
  });
  it('requires recent authentication before creating a ticket or deadline', async () => {
    const owner = await mocks.owner(); owner.authTime = Math.floor(Date.now() / 1000) - 301;
    mocks.owner.mockResolvedValue(owner);
    const response = await DELETE(new NextRequest('https://pediturno.test/api', { method: 'DELETE' }));
    expect(response.status).toBe(403); expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
});
