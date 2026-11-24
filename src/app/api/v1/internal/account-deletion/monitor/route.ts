import { NextRequest, NextResponse } from 'next/server';
import { isAccountDeletionWorkerAuthorized } from '@/lib/account-deletion-worker-auth';
import { getAccountDeletionMonitor } from '@/lib/account-deletion-monitor';
import { deliverAccountDeletionAlerts } from '@/lib/account-deletion-alerts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Independent scheduler invokes monitoring/notifications only. It cannot process deletions. */
export async function POST(request: NextRequest) {
  if (!isAccountDeletionWorkerAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const status = await getAccountDeletionMonitor();
    const alerts = await deliverAccountDeletionAlerts({ overdue: status.overdue, quarantined: status.counts.quarantined, unknownDeadline: status.unknownDeadline, runnerStale: status.runner.scheduled && status.runner.stale ? 1 : 0, workerFailed: status.runner.lastBatchFailedCount });
    return NextResponse.json({ healthy: status.healthy, alerts }, { status: status.healthy && !alerts.failed && !alerts.pending ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Deletion monitor unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
