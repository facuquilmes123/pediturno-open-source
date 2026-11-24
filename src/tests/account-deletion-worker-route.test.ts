import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ process: vi.fn(), batch: vi.fn(), monitor: vi.fn(), health: vi.fn(), alerts: vi.fn() }));
vi.mock('@/lib/android-account-deletion', () => ({ processAndroidAccountDeletion: mocks.process, processPendingAndroidAccountDeletions: mocks.batch }));
vi.mock('@/lib/account-deletion-monitor', () => ({ getAccountDeletionMonitor: mocks.monitor, ACCOUNT_DELETION_HEALTH_DOCUMENT: 'account-deletion-worker-health' }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ set: mocks.health }) }) }) }));
vi.mock('@/lib/account-deletion-alerts', () => ({ deliverAccountDeletionAlerts: mocks.alerts }));
import { POST, GET } from '@/app/api/v1/internal/account-deletion/process/route';
const key = 'synthetic-worker-key-for-unit-tests';
const request = (method: string, input?: unknown, credential: string | null = key) => new NextRequest('https://pediturno.test/api', {
  method, headers: credential === null ? {} : { 'x-account-deletion-worker-key': credential }, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
});
describe('private deletion worker and monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('ACCOUNT_DELETION_WORKER_KEY', key); mocks.health.mockResolvedValue(undefined);
    mocks.monitor.mockResolvedValue({ healthy: true, overdue: 0, unknownDeadline: 0, counts: { quarantined: 0 } });
    mocks.alerts.mockResolvedValue({ sent: 0, skipped: 0, failed: 0, pending: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('rejects unauthenticated status and mutations before touching the queue', async () => {
    expect((await GET(request('GET', undefined, null))).status).toBe(401);
    expect((await POST(request('POST', {}, null))).status).toBe(401);
    expect(mocks.monitor).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('rejects equal-character but different-byte credentials without throwing', async () => {
    vi.stubEnv('ACCOUNT_DELETION_WORKER_KEY', 'é'.repeat(32));
    expect((await GET(request('GET', undefined, 'x'.repeat(32)))).status).toBe(401);
  });
  it('refuses ambiguous exact-owner and batch modes', async () => {
    expect((await POST(request('POST', { ownerId: 'owner', limit: 1 }))).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON instead of defaulting to a destructive batch', async () => {
    const malformed = new NextRequest('https://pediturno.test/api', { method: 'POST', headers: { 'x-account-deletion-worker-key': key }, body: '{' });
    expect((await POST(malformed)).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('returns only monitor aggregates and performs no deletion on GET', async () => {
    mocks.monitor.mockResolvedValue({ healthy: true, operationalSlaDays: 7, overdue: 0 });
    const response = await GET(request('GET'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ healthy: true, overdue: 0 });
    expect(mocks.process).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled(); expect(mocks.health).not.toHaveBeenCalled();
  });
  it('exposes an unhealthy or unavailable monitor as503', async () => {
    mocks.monitor.mockResolvedValue({ healthy: false }); expect((await GET(request('GET'))).status).toBe(503);
    mocks.monitor.mockRejectedValue(new Error('synthetic failure')); expect((await GET(request('GET'))).status).toBe(503);
  });
  it('records bounded batch metrics and does not report partial failure as success', async () => {
    mocks.batch.mockResolvedValue({ attempted: 1, deleted: 0, failed: 1 });
    expect((await POST(request('POST', { limit: 5 }))).status).toBe(503);
    expect(mocks.batch).toHaveBeenCalledWith(5);
    expect(mocks.health).toHaveBeenCalledWith(expect.objectContaining({ lastBatchFailedCount: 1 }), { merge: true });
  });
  it('preserves the exact-owner route and records no batch heartbeat for it', async () => {
    mocks.process.mockResolvedValue({ status: 'financial_review_required' });
    expect((await POST(request('POST', { ownerId: 'owner' }))).status).toBe(202);
    expect(mocks.process).toHaveBeenCalledWith('owner'); expect(mocks.health).not.toHaveBeenCalled();
  });
});
