import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest: mocks.auth }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
import { POST } from '@/app/api/admin/update-membership/route';
const request = (membership: unknown) => new NextRequest('https://pediturno.test/api/admin/update-membership', { method: 'POST', body: JSON.stringify({ businessId: 'owner', membership }) });
describe('manual membership override validation', () => {
 it('rejects unknown plans and invalid date intervals without writes', async () => {
  mocks.auth.mockResolvedValue({ authorized: true });
  for (const input of [{ type: 'free', expiresAt: null }, { type: 'pro', expiresAt: null }, { type: 'pro', startsAt: '2026-10-04T00:00:00Z', expiresAt: '2026-10-03T00:00:00Z' }]) expect((await POST(request(input))).status).toBe(400);
  expect(mocks.db).not.toHaveBeenCalled();
 });
 it('records actor and prior entitlement atomically with a valid manual grant', async () => {
  mocks.auth.mockResolvedValue({ authorized: true, email: 'admin@example.invalid' });
  const create = vi.fn(); const update = vi.fn(); const prior = { type: 'trial' };
  mocks.db.mockReturnValue({ collection: vi.fn(name => ({ doc: vi.fn(id => ({ path: `${name}/${id || 'generated'}` })) })), runTransaction: vi.fn(fn => fn({ get: vi.fn().mockResolvedValue({ exists: true, get: (key: string) => key === 'status' ? 'active' : prior }), create, update })) });
  expect((await POST(request({ type: 'lifetime', expiresAt: null }))).status).toBe(200);
  expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actor: 'admin@example.invalid', before: prior, businessId: 'owner' }));
  expect(update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ membership: expect.objectContaining({ type: 'lifetime', expiresAt: null }) }));
 });
 it('does not grant or create financial history while account deletion is in progress', async () => {
  mocks.auth.mockResolvedValue({ authorized: true });
  const create = vi.fn(); const update = vi.fn();
  mocks.db.mockReturnValue({ collection: () => ({ doc: () => ({}) }), runTransaction: (fn: any) => fn({ get: async () => ({ exists: true, get: () => 'deleting' }), create, update }) });
  expect((await POST(request({ type: 'lifetime', expiresAt: null }))).status).toBe(404);
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
 });
});
