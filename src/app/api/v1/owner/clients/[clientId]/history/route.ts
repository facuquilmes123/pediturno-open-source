import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { Buffer } from 'node:buffer';
import { FieldPath, Filter, Timestamp } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { AndroidOwnerApiError, androidAppointmentDto, androidError, isDocumentId, ownerTimeZone, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Cursor = { dateMillis: number; id: string };

function parseCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (!Number.isSafeInteger(parsed.dateMillis) || !isDocumentId(parsed.id)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new AndroidOwnerApiError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
}

function cursorFor(date: unknown, id: string) {
  const dateMillis = date instanceof Timestamp ? date.toMillis() : date instanceof Date ? date.getTime() : Number.NaN;
  return Number.isSafeInteger(dateMillis) ? Buffer.from(JSON.stringify({ dateMillis, id })).toString('base64url') : null;
}

function failure(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('No se pudo cargar el historial. VolvÃ© a intentar.', 503, 'CLIENT_HISTORY_UNAVAILABLE');
}

/** Historical appointments are queried by the server-derived client id OR its
 * stored phone for legacy records. The outer business filter is mandatory. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params;
    if (!isDocumentId(clientId)) return androidError('Invalid client', 400, 'INVALID_CLIENT');
    const owner = await requireAndroidOwner(request);
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    if (!isBusinessOperational(owner.business)) return androidError('Active membership required', 403, 'MEMBERSHIP_REQUIRED');
    const client = await owner.db.collection('clients').doc(clientId).get();
    if (!client.exists || client.get('businessId') !== owner.uid || typeof client.get('phone') !== 'string') return androidError('Client not found', 404, 'CLIENT_NOT_FOUND');
    const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') || 50) || 50));
    const cursor = parseCursor(request.nextUrl.searchParams.get('cursor'));
    let query = owner.db.collection('appointments')
      .where(Filter.and(
        Filter.where('businessId', '==', owner.uid),
        Filter.or(Filter.where('clientId', '==', clientId), Filter.where('clientPhone', '==', client.get('phone'))),
      ))
      .orderBy('date', 'desc').orderBy(FieldPath.documentId()).limit(limit + 1);
    if (cursor) query = query.startAfter(Timestamp.fromMillis(cursor.dateMillis), cursor.id) as typeof query;
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, limit);
    const zone = ownerTimeZone(owner.business);
    return NextResponse.json({
      clientId,
      appointments: page.map(item => androidAppointmentDto(item.id, item.data(), zone)),
      nextCursor: snapshot.size > limit ? cursorFor(page.at(-1)?.get('date'), page.at(-1)?.id || '') : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}
