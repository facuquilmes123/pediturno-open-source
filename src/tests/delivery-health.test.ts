import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest: mocks.auth }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
import { GET } from '@/app/api/admin/delivery-health/route';
describe('delivery health admin boundary', () => {
  it('rejects unauthorized users before reading customer communications', async () => {
    mocks.auth.mockResolvedValue({ authorized: false });
    expect((await GET(new Request('https://pediturno.test/api/admin/delivery-health') as never)).status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('returns bounded counts only', async () => {
    mocks.auth.mockResolvedValue({ authorized: true });
    const q = { where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue({ size: 101, docs: [{ secret: 'never-return' }] }) };
    mocks.db.mockReturnValue({ collection: () => q });
    const r = await GET(new Request('https://pediturno.test/api/admin/delivery-health') as never);
    expect(await r.json()).toEqual({ failed: 100, more: true });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
