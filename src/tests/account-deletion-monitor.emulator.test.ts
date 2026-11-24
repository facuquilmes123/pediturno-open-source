import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));
import { ACCOUNT_DELETION_HEALTH_DOCUMENT, getAccountDeletionMonitor } from '@/lib/account-deletion-monitor';
let app: App; let db: Firestore;
const now = Date.now(); const created = new Set<string>();
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-account-monitor-it' }, 'account-monitor-it'); db = getFirestore(app);
});
async function clean() {
  const ids = [...created];
  for (let index = 0; index < ids.length; index += 400) {
    const batch = db.batch(); ids.slice(index, index + 400).forEach(id => batch.delete(db.doc('accountDeletionRequests/' + id))); await batch.commit();
  }
  created.clear(); await db.doc('maintenanceJobs/' + ACCOUNT_DELETION_HEALTH_DOCUMENT).delete();
}
beforeEach(async () => { await clean(); vi.stubEnv('ACCOUNT_DELETION_SCHEDULE_ENABLED', 'true'); mocks.db.mockReturnValue(db); });
afterAll(async () => { await clean(); vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });
async function request(id: string, status: string, dueAt?: number) {
  created.add(id); await db.doc('accountDeletionRequests/' + id).set({ status, ...(dueAt === undefined ? {} : { operationalDueAt: Timestamp.fromMillis(dueAt) }) });
}
async function heartbeat(at = now) { await db.doc('maintenanceJobs/' + ACCOUNT_DELETION_HEALTH_DOCUMENT).set({ lastBatchRunAt: Timestamp.fromMillis(at), lastBatchFailedCount: 0 }); }
it('reports a scheduled and fresh operational worker without mutating requests', async () => {
  await request('future-fixture', 'deletion_requested', now + 60000); await heartbeat();
  const before = (await db.doc('accountDeletionRequests/future-fixture').get()).data();
  const result = await getAccountDeletionMonitor(now);
  expect(result).toMatchObject({ healthy: true, overdue: 0, unknownDeadline: 0, operationalSlaDays: 7, activeScanned: 1 });
  expect((await db.doc('accountDeletionRequests/future-fixture').get()).data()).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('future-fixture');
});
it('counts overdue operational work separately from completed financial review', async () => {
  await request('late-fixture', 'processing', now - 1); await request('finance-fixture', 'financial_review_required', now - 1); await heartbeat();
  expect(await getAccountDeletionMonitor(now)).toMatchObject({ healthy: false, overdue: 1, counts: { financial_review_required: 1 }, activeScanned: 1 });
});
it('flags legacy missing deadlines and quarantine rather than assuming a compliant SLA', async () => {
  await request('legacy-fixture', 'deletion_requested'); await request('invalid-fixture', 'quarantined'); await heartbeat();
  expect(await getAccountDeletionMonitor(now)).toMatchObject({ healthy: false, unknownDeadline: 1, counts: { quarantined: 1 } });
});
it('does not claim healthy scheduling without a fresh successful batch or an enabled schedule', async () => {
  expect((await getAccountDeletionMonitor(now)).healthy).toBe(false);
  await heartbeat(now - 16 * 60000); expect((await getAccountDeletionMonitor(now)).healthy).toBe(false);
  await heartbeat(); vi.stubEnv('ACCOUNT_DELETION_SCHEDULE_ENABLED', 'false'); expect((await getAccountDeletionMonitor(now)).healthy).toBe(false);
});
it('fails closed when the bounded scan cannot inspect every active request', async () => {
  for (let offset = 0; offset < 2001; offset += 400) {
    const batch = db.batch();
    for (let index = offset; index < Math.min(offset + 400, 2001); index++) {
      const id = 'bounded-fixture-' + index; created.add(id);
      batch.set(db.doc('accountDeletionRequests/' + id), { status: 'deletion_requested', operationalDueAt: Timestamp.fromMillis(now + 60000) });
    }
    await batch.commit();
  }
  await heartbeat(); expect(await getAccountDeletionMonitor(now)).toMatchObject({ healthy: false, scanComplete: false, activeScanned: 2000 });
}, 60_000);
