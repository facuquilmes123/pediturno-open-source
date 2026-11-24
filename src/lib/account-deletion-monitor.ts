import 'server-only';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { ACCOUNT_DELETION_OPERATIONAL_SLA_DAYS } from '@/lib/account-deletion-policy';

const STATUSES = ['deletion_requested', 'processing', 'quarantined', 'financial_review_required', 'deleted'] as const;
const PAGE = 250;
const MAX_SCAN = 2000;
const MAX_RUN_AGE_MS = 15 * 60_000;
export const ACCOUNT_DELETION_HEALTH_DOCUMENT = 'account-deletion-worker-health';

/** Aggregate diagnostics only. Never claims a request, deletes data, or exposes identities. */
export async function getAccountDeletionMonitor(now = Date.now()) {
  const db = getAdminFirestore();
  const counts = Object.fromEntries(await Promise.all(STATUSES.map(async status =>
    [status, (await db.collection('accountDeletionRequests').where('status', '==', status).count().get()).data().count] as const)));
  let activeScanned = 0; let overdue = 0; let unknownDeadline = 0; let scanComplete = true;
  let oldestDueAt: number | null = null;
  for (const status of ['deletion_requested', 'processing']) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      const remaining = MAX_SCAN - activeScanned;
      if (remaining <= 0) { scanComplete = false; break; }
      let query = db.collection('accountDeletionRequests').where('status', '==', status).orderBy(FieldPath.documentId()).limit(Math.min(PAGE, remaining));
      if (cursor) query = query.startAfter(cursor) as typeof query;
      const rows = await query.get();
      for (const row of rows.docs) {
        activeScanned++;
        const deadline = row.get('operationalDueAt');
        if (!(deadline instanceof Timestamp)) unknownDeadline++;
        else {
          oldestDueAt = Math.min(oldestDueAt ?? Infinity, deadline.toMillis());
          if (deadline.toMillis() <= now) overdue++;
        }
      }
      if (rows.size < Math.min(PAGE, remaining)) break;
      cursor = rows.docs.at(-1);
    }
  }
  const health = await db.collection('maintenanceJobs').doc(ACCOUNT_DELETION_HEALTH_DOCUMENT).get();
  const lastRun = health.get('lastBatchRunAt');
  const lastBatchFailedCount = Number(health.get('lastBatchFailedCount') || 0);
  const scheduled = process.env.ACCOUNT_DELETION_SCHEDULE_ENABLED === 'true';
  const staleRunner = !(lastRun instanceof Timestamp) || now - lastRun.toMillis() > MAX_RUN_AGE_MS || lastRun.toMillis() > now;
  return {
    operationalSlaDays: ACCOUNT_DELETION_OPERATIONAL_SLA_DAYS, counts, activeScanned, scanComplete, overdue, unknownDeadline,
    oldestDueAt: oldestDueAt === null ? null : new Date(oldestDueAt).toISOString(),
    runner: { scheduled, stale: staleRunner, lastBatchRunAt: lastRun instanceof Timestamp ? lastRun.toDate().toISOString() : null, lastBatchFailedCount },
    healthy: scheduled && !staleRunner && lastBatchFailedCount === 0 && counts.quarantined === 0 && scanComplete && overdue === 0 && unknownDeadline === 0,
  };
}
