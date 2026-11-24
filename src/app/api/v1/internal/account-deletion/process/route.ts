import { NextRequest, NextResponse } from 'next/server';
import { processAndroidAccountDeletion, processPendingAndroidAccountDeletions } from '@/lib/android-account-deletion';
import { ACCOUNT_DELETION_HEALTH_DOCUMENT, getAccountDeletionMonitor } from '@/lib/account-deletion-monitor';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { isAccountDeletionWorkerAuthorized as authorized } from '@/lib/account-deletion-worker-auth';
import { deliverAccountDeletionAlerts } from '@/lib/account-deletion-alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

async function recordBatchHealth(value: Record<string, unknown>) {
  await getAdminFirestore().collection('maintenanceJobs').doc(ACCOUNT_DELETION_HEALTH_DOCUMENT).set(value, { merge: true });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let batchAttempt = false;
  try {
    let input;
    try { input = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'ownerId' && key !== 'limit')) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.ownerId !== undefined && input.limit !== undefined || input.ownerId !== undefined && !id(input.ownerId) || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.ownerId === undefined) {
      batchAttempt = true;
      const before = await getAccountDeletionMonitor();
      const result = await processPendingAndroidAccountDeletions(input.limit);
      await recordBatchHealth({
        lastBatchRunAt: FieldValue.serverTimestamp(), lastBatchFailedCount: result.failed, counters: result,
      });
      const alerts = await deliverAccountDeletionAlerts({ overdue: before.overdue, quarantined: before.counts.quarantined, unknownDeadline: before.unknownDeadline, workerFailed: result.failed });
      return NextResponse.json({ ...result, alerts }, { status: result.failed || alerts.failed || alerts.pending ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await processAndroidAccountDeletion(input.ownerId);
    return NextResponse.json(result, { status: result.status === 'not_found' ? 404 : result.status === 'financial_review_required' || result.status === 'processing' ? 202 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (batchAttempt) await recordBatchHealth({
      lastBatchFailedAt: FieldValue.serverTimestamp(), lastBatchFailedCount: 1,
    }).catch(() => undefined);
    if (cause instanceof Error && cause.message === 'FINANCIAL_HISTORY') return NextResponse.json({ status: 'financial_review_required' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ error: 'Deletion worker unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const result = await getAccountDeletionMonitor();
    return NextResponse.json(result, { status: result.healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Deletion monitor unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
