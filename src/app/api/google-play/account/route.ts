import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/payments/auth';
import { registerGooglePlayAccount } from '@/lib/payments/google-play-membership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function bearer(request: Request) { const value = request.headers.get('authorization'); return value?.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
export async function POST(request: Request) {
  let user: { uid: string };
  try { user = await requireFirebaseUser(bearer(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }); }
  try {
    const authorization = await registerGooglePlayAccount(user.uid);
    const configuredPlan = process.env.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID?.trim();
    const basePlanId = configuredPlan && /^[A-Za-z0-9_-]{1,63}$/.test(configuredPlan) ? configuredPlan : null;
    return NextResponse.json({
      ...authorization,
      basePlanId,
      ...(!basePlanId && authorization.purchaseAllowed ? {
        purchaseAllowed: false,
        reason: 'El plan mensual todavía no está disponible. No se inició ningún cobro.',
      } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch { return NextResponse.json({ error: 'Membership eligibility unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export async function GET() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
