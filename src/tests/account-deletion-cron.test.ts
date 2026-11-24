import { expect, it, vi } from 'vitest';
import { runAccountDeletionCron } from '../../scripts/hostinger-account-deletion.mjs';
const env = { ACCOUNT_DELETION_WORKER_KEY: 'synthetic-independent-worker-key', ACCOUNT_DELETION_SCHEDULE_ENABLED: 'true' };
it('refuses disabled or missing configuration without contacting production', async () => {
  const fetchImpl = vi.fn();
  expect((await runAccountDeletionCron({ env: {}, fetchImpl })).ok).toBe(false); expect(fetchImpl).not.toHaveBeenCalled();
});
it('uses a bounded fixed-destination POST and logs only counters', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ attempted: 1, deleted: 1, financialReviewRequired: 0, processing: 0, skipped: 0, failed: 0, privatePayload: 'do not expose' }) }));
  const result = await runAccountDeletionCron({ env, fetchImpl });
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).not.toContain('do not expose'); expect(JSON.stringify(result)).not.toContain(env.ACCOUNT_DELETION_WORKER_KEY);
  const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://pediturno.com/api/v1/internal/account-deletion/process'); expect(options.method).toBe('POST'); expect(options.redirect).toBe('error'); expect(JSON.parse(options.body as string)).toEqual({ limit: 5 });
});
it('performs only a read on check mode and treats unhealthy status as failure', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ healthy: false, overdue: 1, unknownDeadline: 0 }) }));
  expect(await runAccountDeletionCron({ env, fetchImpl, checkOnly: true })).toMatchObject({ ok: false, overdue: 1 });
  expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ method: 'GET' });
});
it('uses the independent non-deletion monitor route when requested', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ healthy: true, alerts: { sent: 0, failed: 0, pending: 0 } }) }));
  expect((await runAccountDeletionCron({ env, fetchImpl, monitorOnly: true })).ok).toBe(true);
  const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://pediturno.com/api/v1/internal/account-deletion/monitor'); expect(JSON.parse(options.body as string)).toEqual({});
});
