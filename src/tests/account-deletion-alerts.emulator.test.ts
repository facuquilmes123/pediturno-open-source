import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ db: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
vi.mock('@/services/email', () => ({ sendAccountDeletionOperationalAlert: mocks.send }));
import { deliverAccountDeletionAlerts } from '@/lib/account-deletion-alerts';
let app: App; let db: Firestore;
const path = 'maintenanceJobs/account-deletion-ops-alert';
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-deletion-alerts-it' }, 'deletion-alerts-it'); db = getFirestore(app);
});
beforeEach(async () => { await db.doc(path).delete(); vi.stubEnv('ACCOUNT_DELETION_ALERT_TO', 'ops@example.test'); mocks.db.mockReturnValue(db); mocks.send.mockResolvedValue(true); });
afterAll(async () => { await db.doc(path).delete(); vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });
it('deduplicates concurrent monitoring and later retries after successful delivery', async () => {
  const results = await Promise.all([deliverAccountDeletionAlerts({ overdue: 1 }), deliverAccountDeletionAlerts({ overdue: 1 })]);
  expect(results.reduce((sum, row) => sum + row.sent, 0)).toBe(1); expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(await deliverAccountDeletionAlerts({ overdue: 2 })).toMatchObject({ sent: 0, skipped: 1, pending: 0 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('retains a failed incident and retries it after the backoff even if the operational queue recovered', async () => {
  mocks.send.mockResolvedValueOnce(false);
  expect(await deliverAccountDeletionAlerts({ overdue: 1 })).toMatchObject({ failed: 1, pending: 1 });
  expect(await deliverAccountDeletionAlerts({})).toMatchObject({ skipped: 1, pending: 1 });
  await db.doc(path).update({ nextAttemptAt: Timestamp.fromMillis(0) });
  expect(await deliverAccountDeletionAlerts({})).toMatchObject({ sent: 1, pending: 0 });
  expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({ overdue: 1 }));
});
it('stores only aggregate counters and permits a new daily summary after24 hours', async () => {
  await deliverAccountDeletionAlerts({ overdue: 1, clientName: 'private fixture' } as { overdue: number });
  expect(JSON.stringify((await db.doc(path).get()).data())).not.toContain('private fixture');
  await db.doc(path).update({ lastSentAt: Timestamp.fromMillis(Date.now() - 25 * 3600000) });
  expect(await deliverAccountDeletionAlerts({ overdue: 2 })).toMatchObject({ sent: 1 });
});
it('does not send to missing or injected recipient configuration', async () => {
  vi.stubEnv('ACCOUNT_DELETION_ALERT_TO', 'ops@example.test\r\nBcc: other@example.test');
  expect(await deliverAccountDeletionAlerts({ workerFailed: 1 })).toMatchObject({ sent: 0, failed: 1 });
  expect(mocks.send).not.toHaveBeenCalled(); expect((await db.doc(path).get()).exists).toBe(false);
});
