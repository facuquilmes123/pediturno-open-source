import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { createOpaqueId } from '@/lib/payments/security';
import { androidError, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';
import { canUseOnlineDeposits, SERVICES_DEPOSITS_UNAVAILABLE } from '@/lib/release-features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const HANDOFF_TTL_SECONDS = 5 * 60;

function originFor(request: NextRequest) {
  // Passenger may expose its internal listener as nextUrl.hostname. Never issue
  // that listener (or a caller-controlled host) as a production OAuth destination.
  return process.env.NODE_ENV === 'production' || request.nextUrl.hostname === 'pediturno.com' || request.nextUrl.hostname.endsWith('.pediturno.com')
    ? 'https://pediturno.com' : request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
    if (!canUseOnlineDeposits(owner.business.businessType)) return androidError(SERVICES_DEPOSITS_UNAVAILABLE, 409, 'DEPOSITS_UNAVAILABLE');
    const handoff = createOpaqueId();
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000);
    await owner.db.collection('androidMarketplaceHandoffs').doc(handoff).create({
      ownerId: owner.uid, expiresAt: Timestamp.fromDate(expiresAt), createdAt: Timestamp.now(),
    });
    const url = new URL('/api/auth/mercadopago/native-handoff', originFor(request));
    url.searchParams.set('handoff', handoff);
    return NextResponse.json({ url: url.toString(), expiresAt: expiresAt.toISOString() }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Marketplace handoff unavailable', 503, 'MARKETPLACE_HANDOFF_UNAVAILABLE');
  }
}
