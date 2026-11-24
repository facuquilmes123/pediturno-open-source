import { NextRequest, NextResponse } from 'next/server';
import { isAccountDeletionWorkerAuthorized } from '@/lib/account-deletion-worker-auth';
import { reconcileMarketplaceFinancialClosure } from '@/lib/payments/marketplace-financial-closure';
import { readLimitedJson } from '@/lib/request-body';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!isAccountDeletionWorkerAuthorized(request)) return reply({ error: 'Unauthorized' }, 401);
  let input: Record<string, unknown>;
  try {
    const value = await readLimitedJson(request, 1024);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reply({ error: 'Invalid request' }, 400);
    input = value as Record<string, unknown>;
  } catch { return reply({ error: 'Invalid request' }, 400); }
  if (Object.keys(input).some(k => !['ownerId', 'apply'].includes(k)) ||
    typeof input.ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.ownerId) || input.apply !== undefined && typeof input.apply !== 'boolean') return reply({ error: 'Invalid request' }, 400);
  try { return reply(await reconcileMarketplaceFinancialClosure(input.ownerId, input.apply === true)); }
  catch { return reply({ error: 'Provider verification unavailable; credentials retained' }, 503); }
}
