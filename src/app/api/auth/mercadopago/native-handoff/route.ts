import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { createMarketplaceAuthorizationStart, marketplaceStateCookie } from '@/lib/marketplace-oauth-start';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function failed() { return NextResponse.json({ error: 'Invalid or expired marketplace handoff' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(request: NextRequest) {
  const handoff = request.nextUrl.searchParams.get('handoff');
  if (!handoff || !/^[A-Za-z0-9_-]{20,128}$/.test(handoff)) return failed();
  try {
    const db = getAdminFirestore();
    const handoffRef = db.collection('androidMarketplaceHandoffs').doc(handoff);
    const ownerId = await db.runTransaction(async transaction => {
      const record = await transaction.get(handoffRef);
      const expiresAt = record.get('expiresAt');
      const ownerId = record.get('ownerId');
      if (!record.exists || record.get('usedAt') || !(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now() || typeof ownerId !== 'string') throw new Error('INVALID_HANDOFF');
      transaction.update(handoffRef, { usedAt: FieldValue.serverTimestamp() });
      return ownerId;
    });
    const started = await createMarketplaceAuthorizationStart(ownerId);
    const response = NextResponse.redirect(started.url);
    const cookie = marketplaceStateCookie(started.state, request.nextUrl.hostname);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    return failed();
  }
}
