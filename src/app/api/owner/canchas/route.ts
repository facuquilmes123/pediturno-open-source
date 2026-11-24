import { confirmImagePermits, ImagePermitError } from '@/lib/image-upload-permits';
import { readLimitedJson } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { hasActiveBusinessMembership } from '@/lib/server-membership';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { dateKeyInZone, localTimeToUtc, BUSINESS_TIME_ZONE } from '@/lib/booking-constraints';
import { validateCanchaWrite, validateReservableWorkingHours, type CanchaWriteInput } from '@/lib/cancha-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function ownerImageUrl(url: string | undefined, uid: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com' &&
      decodeURIComponent(parsed.pathname).includes(`/o/businesses/${uid}/canchas/`);
  } catch {
    return false;
  }
}

function timestamps(input: CanchaWriteInput): Record<string, unknown> {
  if (!input.unavailableDates) return input;
  return {
    ...input,
    unavailableDates: input.unavailableDates.map(value => Timestamp.fromDate(value instanceof Date ? value : new Date(value as string))),
  };
}

function writeFailure(cause: unknown, operation: string) {
  if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'PROFILE') return response('Business profile required', 409);
  if (message === 'MEMBERSHIP') return response('Active membership required', 403);
  if (message === 'MODALITY') return response('Wrong business modality', 403);
  // Log only fixed operation and provider code, never user data or credentials.
  const code = (cause as { code?: unknown } | null)?.code;
  console.error('[owner/canchas write]', { operation, code: typeof code === 'number' ? code : 'internal' });
  return response('Save temporarily unavailable', 503);
}

async function ownerId(request: NextRequest): Promise<string | null> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  initializeAdminApp();
  return (await getAuth().verifyIdToken(token, true)).uid;
}

async function inputBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  try {
    const value = await readLimitedJson(request, MAX_BODY_BYTES);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function requireOwner(request: NextRequest): Promise<string | NextResponse> {
  try {
    const uid = await ownerId(request);
    return uid || response('Authentication required', 401);
  } catch {
    return response('Authentication required', 401);
  }
}

async function hasCurrentOrLegacyReservations(transaction: FirebaseFirestore.Transaction, uid: string, canchaId: string, canchaName: string, zone: string): Promise<boolean> {
  const today = dateKeyInZone(new Date(), zone);
  const startOfToday = Timestamp.fromDate(localTimeToUtc(today, '00:00', zone));
  const reservations = await transaction.get(
    getAdminFirestore().collection('appointments').where('businessId', '==', uid).where('date', '>=', startOfToday).limit(1000),
  );
  if (reservations.size === 1000) return true;
  return reservations.docs.some(snapshot => {
    const appointment = snapshot.data();
    return appointment.status !== 'Cancelado' &&
      (appointment.canchaId === canchaId || (!appointment.canchaId && appointment.cancha === canchaName));
  });
}

export async function POST(request: NextRequest) {
  const input = await inputBody(request);
  if (!input) return response('Invalid request', 400);
  const validated = validateCanchaWrite(input, true);
  if (!validated.data) return response(validated.error || 'Invalid cancha details', 400);

  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;
  if (!ownerImageUrl(validated.data.photo, owner)) return response('Invalid cancha image', 400);
  if (validated.data.status === 'Activo' && validateReservableWorkingHours(validated.data.workingHours, validated.data.duration)) {
    return response('Configure availability before activating the cancha', 400);
  }

  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const canchaRef = db.collection('canchas').doc();
    await db.runTransaction(async transaction => {
      const business = (await transaction.get(businessRef)).data();
      if (!business) throw new Error('PROFILE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (!['hybrid', 'sports_facility'].includes(business.businessType)) throw new Error('MODALITY');
      await confirmImagePermits(transaction, db, owner, [validated.data!.photo], `canchas/${canchaRef.id}`);
      transaction.create(canchaRef, {
        ...timestamps(validated.data!),
        businessId: owner,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ id: canchaRef.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    return writeFailure(cause, 'POST');
  }
}

export async function PATCH(request: NextRequest) {
  const input = await inputBody(request);
  const canchaId = input?.canchaId;
  if (!input || !validId(canchaId)) return response('Invalid request', 400);
  const { canchaId: _canchaId, ...patch } = input;
  const validated = validateCanchaWrite(patch, false);
  if (!validated.data) return response(validated.error || 'Invalid cancha details', 400);

  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;
  if (!ownerImageUrl(validated.data.photo, owner)) return response('Invalid cancha image', 400);

  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const canchaRef = db.collection('canchas').doc(canchaId);
    await db.runTransaction(async transaction => {
      const [businessSnapshot, canchaSnapshot] = await Promise.all([transaction.get(businessRef), transaction.get(canchaRef)]);
      const business = businessSnapshot.data();
      const cancha = canchaSnapshot.data();
      if (!business) throw new Error('PROFILE');
      if (!cancha || cancha.businessId !== owner) throw new Error('UNAVAILABLE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (!['hybrid', 'sports_facility'].includes(business.businessType)) throw new Error('MODALITY');
      const zone = typeof business?.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (validated.data!.name && validated.data!.name !== cancha.name &&
          await hasCurrentOrLegacyReservations(transaction, owner, canchaId, cancha.name, zone)) {
        throw new Error('LEGACY_RESERVATIONS');
      }
      const nextHours = validated.data!.workingHours ?? cancha.workingHours;
      const nextStatus = validated.data!.status ?? cancha.status;
      if (nextStatus === 'Activo') {
        const hoursError = validateReservableWorkingHours(nextHours, validated.data!.duration ?? cancha.duration);
        if (hoursError) throw new Error('INVALID_AVAILABILITY');
      }
      await confirmImagePermits(transaction, db, owner, [validated.data!.photo], `canchas/${canchaRef.id}`);
      transaction.update(canchaRef, { ...timestamps(validated.data!), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    const message = cause instanceof Error ? cause.message : '';
    if (['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(message)) return writeFailure(cause, request.method);
    if (message === 'LEGACY_RESERVATIONS') return response('Cancha has legacy reservations', 409);
    if (message === 'INVALID_AVAILABILITY') return response('Configure availability before activating the cancha', 400);
    if (message === 'UNAVAILABLE') return response('Cancha unavailable', 404);
    return response('Cancha unavailable', 503);
  }
}

export async function DELETE(request: NextRequest) {
  const input = await inputBody(request);
  const canchaId = input?.canchaId;
  if (!input || !validId(canchaId) || Object.keys(input).length !== 1) return response('Invalid request', 400);
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;

  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const canchaRef = db.collection('canchas').doc(canchaId);
    await db.runTransaction(async transaction => {
      const [businessSnapshot, canchaSnapshot] = await Promise.all([transaction.get(businessRef), transaction.get(canchaRef)]);
      const business = businessSnapshot.data();
      const cancha = canchaSnapshot.data();
      if (!business) throw new Error('PROFILE');
      if (!cancha || cancha.businessId !== owner) throw new Error('UNAVAILABLE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (!['hybrid', 'sports_facility'].includes(business.businessType)) throw new Error('MODALITY');
      const zone = typeof business?.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (await hasCurrentOrLegacyReservations(transaction, owner, canchaId, cancha.name, zone)) {
        throw new Error('ACTIVE_RESERVATIONS');
      }
      transaction.delete(canchaRef); transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    const message = cause instanceof Error ? cause.message : '';
    if (['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(message)) return writeFailure(cause, request.method);
    if (message === 'ACTIVE_RESERVATIONS') return response('Cancha has active reservations', 409);
    if (message === 'UNAVAILABLE') return response('Cancha unavailable', 404);
    return response('Cancha unavailable', 503);
  }
}
