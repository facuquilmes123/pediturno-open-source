import { beforeEach, describe, expect, it, vi } from 'vitest';
const reconcileGooglePlaySubscriptions = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/google-play-membership', () => ({ reconcileGooglePlaySubscriptions }));
import { POST } from '@/app/api/google-play/reconcile/route';
const request = (authorization?: string) => new Request('https://pediturno.test/api/google-play/reconcile', { method: 'POST', headers: authorization ? { authorization } : {} });
describe('Google Play reconciliation route', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.GOOGLE_PLAY_RECONCILE_SECRET = 'p'.repeat(32); });
  it('does not query subscriptions with missing or wrong scheduler auth', async () => { expect((await POST(request())).status).toBe(401); expect((await POST(request('Bearer wrong'))).status).toBe(401); expect(reconcileGooglePlaySubscriptions).not.toHaveBeenCalled(); });
  it('reports item failures as retryable without granting a duplicate right', async () => { reconcileGooglePlaySubscriptions.mockResolvedValue({ checked: 3, processed: 2, failed: 1 }); const response = await POST(request(`Bearer ${process.env.GOOGLE_PLAY_RECONCILE_SECRET}`)); expect(response.status).toBe(503); await expect(response.json()).resolves.toEqual({ checked: 3, processed: 2, failed: 1 }); });
});
