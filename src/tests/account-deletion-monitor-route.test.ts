import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ status: vi.fn(), alerts: vi.fn() }));
vi.mock('@/lib/account-deletion-monitor', () => ({ getAccountDeletionMonitor: mocks.status }));
vi.mock('@/lib/account-deletion-alerts', () => ({ deliverAccountDeletionAlerts: mocks.alerts }));
import { POST } from '@/app/api/v1/internal/account-deletion/monitor/route';
const key = 'synthetic-independent-worker-key';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('ACCOUNT_DELETION_WORKER_KEY', key);
  mocks.status.mockResolvedValue({ healthy: true, overdue: 0, unknownDeadline: 0, counts: { quarantined: 0 }, runner: { scheduled: true, stale: false, lastBatchFailedCount: 0 } });
  mocks.alerts.mockResolvedValue({ sent: 0, skipped: 1, failed: 0, pending: 0 });
});
afterEach(() => vi.unstubAllEnvs());
it('requires the private key and refuses caller-supplied recipients or owner IDs', async () => {
  expect((await POST(new NextRequest('https://pediturno.test/api', { method: 'POST', body: '{}' }))).status).toBe(401);
  expect((await POST(new NextRequest('https://pediturno.test/api', { method: 'POST', headers: { 'x-account-deletion-worker-key': key }, body: '{"ownerId":"other"}' }))).status).toBe(400);
  expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.alerts).not.toHaveBeenCalled();
});
it('only observes and notifies, retaining503 for an unhealthy worker', async () => {
  mocks.status.mockResolvedValue({ healthy: false, overdue: 1, unknownDeadline: 0, counts: { quarantined: 0 }, runner: { scheduled: true, stale: false, lastBatchFailedCount: 0 } });
  const response = await POST(new NextRequest('https://pediturno.test/api', { method: 'POST', headers: { 'x-account-deletion-worker-key': key }, body: '{}' }));
  expect(response.status).toBe(503); expect(mocks.alerts).toHaveBeenCalledWith(expect.objectContaining({ overdue: 1 }));
});
