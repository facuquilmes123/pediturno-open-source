import { NextRequest, NextResponse } from 'next/server';
import { requireFirebaseUser } from '@/lib/payments/auth';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { createMarketplaceAuthorizationStart, marketplaceStateCookie } from '@/lib/marketplace-oauth-start';
import { marketplaceConfiguration } from '@/lib/payments/marketplace';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let user;
  try { user = await requireFirebaseUser(request.headers.get('authorization')?.replace(/^Bearer /, '')); }
  catch { return NextResponse.json({ error: 'Authentication required' }, { status: 401 }); }
  try {
    const connection = await getAdminFirestore().collection('mercadoPagoConnections').doc(user.uid).get();
    const business = await getAdminFirestore().collection('businesses').doc(user.uid).get();
    let configured = false;
    try { marketplaceConfiguration(); configured = true; } catch { /* Return availability only. */ }
    configured = configured && canUseOnlineDeposits(business.get('businessType'));
    return NextResponse.json({ configured, connected: !!connection.get('encryptedAccessToken') && connection.get('active') !== false, depositsEnabled: configured && process.env.MP_MARKETPLACE_ENABLED === 'true' && !!process.env.MP_MARKETPLACE_WEBHOOK_SECRET && /^(true|false)$/.test(process.env.MP_MARKETPLACE_EXPECT_LIVE_MODE || '') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Service unavailable' }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  let user;
  try { user = await requireFirebaseUser(request.headers.get('authorization')?.replace(/^Bearer /, '')); }
  catch { return NextResponse.json({ error: 'Authentication required' }, { status: 401 }); }
  try {
    const started = await createMarketplaceAuthorizationStart(user.uid);
    const response = NextResponse.json({ url: started.url }, { headers: { 'Cache-Control': 'no-store' } });
    const cookie = marketplaceStateCookie(started.state, request.nextUrl.hostname);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === 'RATE_LIMIT' ? 'Esperá unos segundos antes de volver a vincular.' : 'La vinculación todavía no está configurada. Contactá a soporte.' }, { status: error instanceof Error && error.message === 'RATE_LIMIT' ? 429 : 503 });
  }
}
