import { NextRequest, NextResponse } from 'next/server';
import { AndroidOwnerApiError, androidError, requireAndroidOwner } from '@/lib/android-owner-api';
import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const common = ['name', 'status', 'photo', 'workingHours', 'unavailableDates', 'bookingBufferMinutes'];
const fields = {
  services: [...common, 'duration', 'price'],
  canchas: [...common, 'duration', 'price', 'sport'],
  spaces: [...common, 'category', 'description', 'capacity', 'packages', 'preparationMinutes', 'cleanupMinutes', 'photos'],
};
function date(value: unknown): string {
  const input = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : value;
  const result = input instanceof Date ? input : new Date(input as string);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid blocked date');
  return result.toISOString();
}
/** Web DTO preserves catalog fields and date instants, independently of Android DTOs. */
export async function GET(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get('kind');
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
    const cursor = request.nextUrl.searchParams.get('cursor');
    if (!kind || !Object.hasOwn(fields, kind) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor))) return androidError('Invalid catalog request', 400, 'INVALID_CATALOG_REQUEST');
    const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const selected = fields[kind as keyof typeof fields];
    let query = owner.db.collection(kind).where('businessId', '==', owner.uid).orderBy('__name__').select(...selected).limit(limit + 1);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snapshot = await query.get(), page = snapshot.docs.slice(0, limit);
    const items = page.map(doc => {
      const data = doc.data();
      const row: Record<string, unknown> = { id: doc.id, businessId: owner.uid };
      for (const field of selected) if (data[field] !== undefined) row[field] = data[field];
      row.unavailableDates = Array.isArray(data.unavailableDates) ? data.unavailableDates.map(date) : [];
      return row;
    });
    return NextResponse.json({ items, nextCursor: snapshot.size > limit ? page.at(-1)?.id ?? null : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    return error?.status && error?.code ? androidError(error.message, error.status, error.code)
      : androidError('Catalog unavailable', 503, 'CATALOG_UNAVAILABLE');
  }
}
