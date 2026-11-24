import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileMembershipPayments } = vi.hoisted(() => ({ reconcileMembershipPayments: vi.fn() }));
vi.mock('@/lib/payments/reconcile-memberships', async () => {
  return { reconcileMembershipPayments };
});

import { POST } from '@/app/api/cron/payments/route';

const request = (authorization?: string) => new Request('https://pediturno.test/api/cron/payments', {
  method: 'POST', headers: authorization ? { authorization } : {},
});

describe('payment reconciliation cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'a'.repeat(32);
  });

  it('rejects missing or wrong cron credentials before reading payment records', async () => {
    const response = await POST(request('Bearer wrong'));
    expect(response.status).toBe(401);
    expect(reconcileMembershipPayments).not.toHaveBeenCalled();
  });

  it('returns a no-store reconciliation result for a valid cron credential', async () => {
    reconcileMembershipPayments.mockResolvedValue({ checkedPayments: 1, processed: 1 });
    const response = await POST(request(`Bearer ${process.env.CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ checkedPayments: 1, processed: 1 });
  });

  it('returns 503 when a persisted item failure requires operational attention', async () => {
    reconcileMembershipPayments.mockResolvedValue({ checkedPayments: 1, processed: 0, failed: 1 });
    const response = await POST(request(`Bearer ${process.env.CRON_SECRET}`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ checkedPayments: 1, processed: 0, failed: 1 });
  });

  it('returns retryable service unavailability when reconciliation infrastructure fails', async () => {
    reconcileMembershipPayments.mockRejectedValue(new Error('synthetic failure'));
    const response = await POST(request(`Bearer ${process.env.CRON_SECRET}`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Payment reconciliation unavailable' });
  });
});
