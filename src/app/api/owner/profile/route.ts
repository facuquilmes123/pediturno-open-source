import { NextResponse } from 'next/server';
import { verifiedWebOwner } from '@/lib/owner-workspace-server';
import { ownerProfileDto } from '@/lib/owner-workspace-dto';
import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { androidError, type AndroidOwnerApiError } from '@/lib/android-owner-api';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const owner = await verifiedWebOwner(request);
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const snapshot = await owner.db.collection('businesses').doc(owner.uid).get();
    return NextResponse.json({ profile: snapshot.exists ? ownerProfileDto(owner.uid, snapshot.data()!) : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    return error?.status && error.code ? androidError(error.message,error.status,error.code) : androidError('Profile unavailable',503,'PROFILE_UNAVAILABLE');
  }
}
