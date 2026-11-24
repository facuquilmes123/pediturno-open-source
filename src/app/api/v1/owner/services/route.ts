import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { DELETE as deleteService, PATCH as patchService, POST as createService } from '@/app/api/owner/services/route';
import { AndroidOwnerApiError, androidError, androidServiceDto, ownerTimeZone, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fields = new Set(['id', 'name', 'duration', 'price', 'status', 'photo', 'workingHours', 'unavailableDates', 'bookingBufferMinutes']);

function proxiedRequest(request: NextRequest, method: 'POST' | 'PATCH' | 'DELETE', payload: Record<string, unknown>) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new NextRequest(new URL('/api/owner/services', request.url), { method, headers, body: JSON.stringify(payload) });
}

function legacyPayload(input: Record<string, unknown>, method: 'POST' | 'PATCH' | 'DELETE'): Record<string, unknown> {
  if (Object.keys(input).some(field => !fields.has(field))) throw new AndroidOwnerApiError(400, 'INVALID_SERVICE', 'Invalid service details');
  const id = input.id;
  if (method === 'DELETE') {
    if (typeof id !== 'string' || Object.keys(input).length !== 1) throw new AndroidOwnerApiError(400, 'INVALID_SERVICE', 'Invalid service details');
    return { serviceId: id };
  }
  const { id: _id, duration, ...rest } = input;
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 10 || duration > 1440)) {
    throw new AndroidOwnerApiError(400, 'INVALID_SERVICE', 'Invalid service duration');
  }
  const result: Record<string, unknown> = { ...rest, ...(duration === undefined ? {} : { duration: String(duration) }) };
  if (method === 'PATCH') {
    if (typeof id !== 'string') throw new AndroidOwnerApiError(400, 'INVALID_SERVICE', 'Invalid service details');
    return { serviceId: id, ...result };
  }
  if (id !== undefined) throw new AndroidOwnerApiError(400, 'INVALID_SERVICE', 'New services cannot include an id');
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request);
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') || 100) || 100));
    const cursor = request.nextUrl.searchParams.get('cursor');
    if (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) return androidError('Invalid cursor', 400, 'INVALID_CURSOR');
    let query = owner.db.collection('services').where('businessId', '==', owner.uid).orderBy('__name__').limit(limit + 1);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snapshot = await query.get(); const page = snapshot.docs.slice(0, limit);
    return NextResponse.json({ services: page.map(item => androidServiceDto(item.id, item.data(), ownerTimeZone(owner.business))), nextCursor: snapshot.size > limit ? page.at(-1)?.id || null : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Services unavailable', 503, 'SERVICES_UNAVAILABLE');
  }
}

export async function POST(request: NextRequest) {
  try { return await createService(proxiedRequest(request, 'POST', legacyPayload(await readAndroidOwnerJson(request), 'POST'))); }
  catch (cause) { const error = cause as AndroidOwnerApiError; return error?.status ? androidError(error.message, error.status, error.code) : androidError('Service unavailable', 503, 'SERVICE_UNAVAILABLE'); }
}

export async function PATCH(request: NextRequest) {
  try { return await patchService(proxiedRequest(request, 'PATCH', legacyPayload(await readAndroidOwnerJson(request), 'PATCH'))); }
  catch (cause) { const error = cause as AndroidOwnerApiError; return error?.status ? androidError(error.message, error.status, error.code) : androidError('Service unavailable', 503, 'SERVICE_UNAVAILABLE'); }
}

export async function DELETE(request: NextRequest) {
  try { return await deleteService(proxiedRequest(request, 'DELETE', legacyPayload(await readAndroidOwnerJson(request), 'DELETE'))); }
  catch (cause) { const error = cause as AndroidOwnerApiError; return error?.status ? androidError(error.message, error.status, error.code) : androidError('Service unavailable', 503, 'SERVICE_UNAVAILABLE'); }
}
