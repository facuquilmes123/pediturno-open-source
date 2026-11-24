import { confirmImagePermits, ImagePermitError } from '@/lib/image-upload-permits';
import { readLimitedJson } from '@/lib/request-body';
import { createHash } from 'node:crypto';
import { queueOwnedImageCleanup, runOwnedImageCleanup } from '@/lib/owned-image-cleanup';
import { NextRequest, NextResponse } from 'next/server';
import { isBusinessOperational } from '@/lib/server-membership';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { dateKeyInZone, localTimeToUtc, BUSINESS_TIME_ZONE } from '@/lib/booking-constraints';
import { validateReservableWorkingHours } from '@/lib/cancha-validation';
import { validateServiceWrite, type ServiceWriteInput } from '@/lib/service-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 16 * 1024;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

function imageOwnedBy(url: string | undefined, uid: string) {
  if (!url) return true;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com' && decodeURIComponent(parsed.pathname).includes(`/o/businesses/${uid}/services/`); } catch { return false; }
}
function dates(input: ServiceWriteInput, zone: string): Record<string, unknown> {
  return input.unavailableDates ? { ...input, unavailableDates: input.unavailableDates.map(value => {
    const date = value instanceof Date ? value
      : typeof value === 'string' && value.length === 10 ? localTimeToUtc(value, '00:00', zone)
        : new Date(value as string);
    return Timestamp.fromDate(date);
  }) } : input;
}
function writeFailure(cause: unknown, operation: string) {
  if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'PROFILE') return response('Business profile required', 409);
  if (message === 'MEMBERSHIP') return response('Active membership required', 403);
  if (message === 'MODALITY') return response('Wrong business modality', 403);
  // Log only fixed operation and provider code, never user data or credentials.
  const code = (cause as { code?: unknown } | null)?.code;
  console.error('[owner/services write]', { operation, code: typeof code === 'number' ? code : 'internal' });
  return response('Save temporarily unavailable', 503);
}

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  try { const value = await readLimitedJson(request, MAX_BODY_BYTES); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
async function owner(request: NextRequest): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  initializeAdminApp();
  return (await getAuth().verifyIdToken(token, true)).uid;
}
async function currentReservations(transaction: FirebaseFirestore.Transaction, uid: string, serviceId: string, serviceName: string, zone: string) {
  const today = Timestamp.fromDate(localTimeToUtc(dateKeyInZone(new Date(), zone), '00:00', zone));
  const bookings = await transaction.get(getAdminFirestore().collection('appointments').where('businessId', '==', uid).where('date', '>=', today).limit(1000));
  if (bookings.size === 1000) return true;
  return bookings.docs.some(doc => {
    const appointment = doc.data();
    return appointment.status !== 'Cancelado' && (appointment.serviceId === serviceId || (!appointment.serviceId && !appointment.canchaId && appointment.service === serviceName));
  });
}

export async function POST(request: NextRequest) {
  const input = await body(request); const validated = validateServiceWrite(input, true);
  if (!input || !validated.data) return response(validated.error || 'Invalid request', 400);
  const key = request.headers.get('x-idempotency-key');
  if (key !== null && !/^[A-Za-z0-9_-]{16,100}$/.test(key)) return response('Invalid request key', 400);
  let uid: string | null; try { uid = await owner(request); } catch { return response('Authentication required', 401); }
  if (!uid) return response('Authentication required', 401);
  if (!imageOwnedBy(validated.data.photo, uid) || (validated.data.status === 'Activo' && validateReservableWorkingHours(validated.data.workingHours, validated.data.duration))) return response('Invalid service details', 400);
  try {
    const db = getAdminFirestore(); const businessRef = db.collection('businesses').doc(uid); const serviceRef = db.collection('services').doc();
    const requestRef = key ? db.collection('ownerServiceRequests').doc(createHash('sha256').update(`${uid}\0${key}`).digest('hex')) : null;
    const payloadHash = createHash('sha256').update(JSON.stringify(validated.data)).digest('hex');
    const result = await db.runTransaction(async transaction => {
      const [businessSnap, prior] = await Promise.all([transaction.get(businessRef), requestRef ? transaction.get(requestRef) : Promise.resolve(null)]);
      const business = businessSnap.data();
      if (!business) throw new Error('PROFILE');
      if (!isBusinessOperational(business)) throw new Error('MEMBERSHIP');
      if (business.businessType === 'sports_facility') throw new Error('MODALITY');
      if (prior?.exists && prior.get('expiresAt') instanceof Timestamp && prior.get('expiresAt').toMillis() > Date.now()) {
        if (prior.get('payloadHash') !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
        return { id: prior.get('serviceId') as string, repeated: true };
      }
      await confirmImagePermits(transaction, db, uid!, [validated.data!.photo], `services/${serviceRef.id}`);
      transaction.create(serviceRef, { ...dates(validated.data!, typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE), businessId: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
      if (requestRef) transaction.set(requestRef, { businessId: uid, payloadHash, serviceId: serviceRef.id, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) });
      return { id: serviceRef.id, repeated: false };
    });
    return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    if (cause instanceof Error && cause.message === 'IDEMPOTENCY_CONFLICT') return response('La solicitud ya se usó con otros datos.', 409);
    return writeFailure(cause, 'POST');
  }
}

export async function PATCH(request: NextRequest) {
  const input = await body(request); const serviceId = input?.serviceId;
  if (!input || !validId(serviceId)) return response('Invalid request', 400);
  const { serviceId: _serviceId, ...patch } = input; const validated = validateServiceWrite(patch, false);
  if (!validated.data) return response(validated.error || 'Invalid service details', 400);
  let uid: string | null; try { uid = await owner(request); } catch { return response('Authentication required', 401); }
  if (!uid) return response('Authentication required', 401);
  if (!imageOwnedBy(validated.data.photo, uid)) return response('Invalid service image', 400);
  try {
    const db = getAdminFirestore(); const businessRef = db.collection('businesses').doc(uid); const serviceRef = db.collection('services').doc(serviceId);
    await db.runTransaction(async transaction => {
      const [businessSnap, serviceSnap] = await Promise.all([transaction.get(businessRef), transaction.get(serviceRef)]); const business = businessSnap.data(); const service = serviceSnap.data();
      if (!business) throw new Error('PROFILE'); if (!service || service.businessId !== uid) throw new Error('UNAVAILABLE'); if (!isBusinessOperational(business)) throw new Error('MEMBERSHIP'); if (business.businessType === 'sports_facility') throw new Error('MODALITY');
      const zone = typeof business?.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (validated.data!.name && validated.data!.name !== service.name && await currentReservations(transaction, uid, serviceId, service.name, zone)) throw new Error('LEGACY');
      if ((validated.data!.status ?? service.status) === 'Activo' && validateReservableWorkingHours(validated.data!.workingHours ?? service.workingHours, validated.data!.duration ?? service.duration)) throw new Error('HOURS');
      await confirmImagePermits(transaction, db, uid!, [validated.data!.photo], `services/${serviceRef.id}`);
      if (validated.data!.photo !== undefined && validated.data!.photo !== service.photo) queueOwnedImageCleanup(transaction, db, uid!, service.photo, 'services');
      transaction.update(serviceRef, { ...dates(validated.data!, zone), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    await runOwnedImageCleanup(db, uid);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status); if (cause instanceof Error && ['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(cause.message)) return writeFailure(cause, request.method); const message = cause instanceof Error ? cause.message : ''; return response(message === 'LEGACY' ? 'Service has legacy reservations' : message === 'HOURS' ? 'Configure availability before activating the service' : message === 'UNAVAILABLE' ? 'Service unavailable' : 'Save temporarily unavailable', message === 'LEGACY' ? 409 : message === 'HOURS' ? 400 : message === 'UNAVAILABLE' ? 404 : 503); }
}

export async function DELETE(request: NextRequest) {
  const input = await body(request); const serviceId = input?.serviceId;
  if (!input || !validId(serviceId) || Object.keys(input).length !== 1) return response('Invalid request', 400);
  let uid: string | null; try { uid = await owner(request); } catch { return response('Authentication required', 401); }
  if (!uid) return response('Authentication required', 401);
  try {
    const db = getAdminFirestore(); const businessRef = db.collection('businesses').doc(uid); const serviceRef = db.collection('services').doc(serviceId);
    await db.runTransaction(async transaction => { const [businessSnap, serviceSnap] = await Promise.all([transaction.get(businessRef), transaction.get(serviceRef)]); const business = businessSnap.data(); const service = serviceSnap.data(); if (!business) throw new Error('PROFILE'); if (!service || service.businessId !== uid) throw new Error('UNAVAILABLE'); if (!isBusinessOperational(business)) throw new Error('MEMBERSHIP'); if (business.businessType === 'sports_facility') throw new Error('MODALITY'); if (await currentReservations(transaction, uid, serviceId, service.name, typeof business?.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE)) throw new Error('RESERVED'); queueOwnedImageCleanup(transaction, db, uid!, service.photo, 'services'); transaction.delete(serviceRef); transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() }); });
    await runOwnedImageCleanup(db, uid);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status); if (cause instanceof Error && ['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(cause.message)) return writeFailure(cause, request.method); const message = cause instanceof Error ? cause.message : ''; return response(message === 'RESERVED' ? 'Service has active reservations' : message === 'UNAVAILABLE' ? 'Service unavailable' : 'Save temporarily unavailable', message === 'RESERVED' ? 409 : message === 'UNAVAILABLE' ? 404 : 503); }
}
