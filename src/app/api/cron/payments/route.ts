import { maintenanceFailureHeaders } from '@/lib/request-failure-journal';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileMembershipPayments } from '@/lib/payments/reconcile-memberships';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 24 || !header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice(7).trim());
  const configured = Buffer.from(expected);
  return received.length === configured.length && timingSafeEqual(received, configured);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await reconcileMembershipPayments();
    // The page did advance (so a bad item cannot starve later work), but an
    // open reconciliation failure must remain observable to the scheduler.
    const causes = result.failed > 0 ? ['RECONCILIATION_ITEMS_FAILED'] : [];
    return NextResponse.json(result, {
      status: causes.length ? 503 : 200,
      headers: await maintenanceFailureHeaders(request, '/api/cron/payments', causes, { 'Cache-Control': 'no-store' }),
    });
  } catch {
    // Provider failures can carry payment metadata; keep logs actionable but
    // do not emit their payloads or identifiers.
    console.error('[Payment reconciliation] Provider or ledger check failed.');
    const headers = await maintenanceFailureHeaders(request, '/api/cron/payments', ['RECONCILIATION_UNAVAILABLE']);
    return NextResponse.json({ error: 'Payment reconciliation unavailable' }, { status: 503, headers });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
