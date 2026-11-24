import { NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/payments/auth';
import { googlePlayStatusForUser } from '@/lib/payments/google-play-membership';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
function bearer(request: Request) { const value = request.headers.get('authorization'); return value?.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
export async function GET(request: Request) {
  let user: { uid: string };
  try { user = await requireFirebaseUser(bearer(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }); }
  try { return NextResponse.json({ entitlement: await googlePlayStatusForUser(user.uid) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Google Play status unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export async function POST() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
