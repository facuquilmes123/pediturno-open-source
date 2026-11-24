import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { androidAppointmentDto, androidError, isDocumentId, ownerDayBounds, ownerTimeZone, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_LIMIT = 100;

function cursorFor(id: string) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

function readCursor(value: string | null) {
  if (!value || value.length > 256) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { id?: unknown };
    return isDocumentId(parsed.id) ? parsed.id : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const dateKey = request.nextUrl.searchParams.get('date') || request.nextUrl.searchParams.get('dateKey');
    const owner = await requireAndroidOwner(request);
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const zone = ownerTimeZone(owner.business);
    const { start, end } = ownerDayBounds(dateKey || '', zone);
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || MAX_LIMIT);
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 ? Math.min(MAX_LIMIT, requestedLimit) : MAX_LIMIT;
    const cursorId = readCursor(request.nextUrl.searchParams.get('cursor'));
    if (request.nextUrl.searchParams.has('cursor') && !cursorId) return androidError('Invalid cursor', 400, 'INVALID_CURSOR');
    let cursor: FirebaseFirestore.DocumentSnapshot | null = null;
    if (cursorId) {
      cursor = await owner.db.collection('appointments').doc(cursorId).get();
      const value = cursor.data(); const date = value?.date;
      if (!cursor.exists || value?.businessId !== owner.uid || !(date instanceof Timestamp) || date.toMillis() < start.toMillis() || date.toMillis() >= end.toMillis()) {
        return androidError('Invalid cursor', 400, 'INVALID_CURSOR');
      }
    }
    let query = owner.db.collection('appointments').where('businessId', '==', owner.uid)
      .where('date', '>=', start).where('date', '<', end).orderBy('date', 'asc').orderBy(FieldPath.documentId()).limit(limit + 1);
    if (cursor) query = query.startAfter(cursor.get('date'), cursor.id) as typeof query;
    const snapshot = await query.get(); const page = snapshot.docs.slice(0, limit);
    const appointments = page.map(item => androidAppointmentDto(item.id, item.data(), zone))
      .sort((a, b) => a.time.localeCompare(b.time));
    return NextResponse.json({ date: dateKey, timeZone: zone, appointments, nextCursor: snapshot.size > limit ? cursorFor(page.at(-1)!.id) : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Agenda unavailable', 503, 'AGENDA_UNAVAILABLE');
  }
}
