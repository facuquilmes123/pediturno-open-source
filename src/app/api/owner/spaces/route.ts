import { confirmImagePermits, ImagePermitError } from '@/lib/image-upload-permits';
import { readLimitedJson } from '@/lib/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { BUSINESS_TIME_ZONE, dateKeyInZone, localTimeToUtc } from '@/lib/booking-constraints';
import { hasActiveBusinessMembership } from '@/lib/server-membership';
import { validateReservableSpaceWorkingHours, validateSpaceWrite, type SpaceWriteInput } from '@/lib/space-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 24 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function ownerImageUrl(url: string | undefined, owner: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com' &&
      decodeURIComponent(parsed.pathname).includes(`/o/businesses/${owner}/spaces/`);
  } catch { return false; }
}

function imagesOwnedBy(input: SpaceWriteInput, owner: string): boolean {
  return ownerImageUrl(input.photo, owner) && (!input.photos || input.photos.every(url => ownerImageUrl(url, owner)));
}

function timestamps(input: SpaceWriteInput): Record<string, unknown> {
  if (!input.unavailableDates) return input;
  return {
    ...input,
    unavailableDates: input.unavailableDates.map(value => Timestamp.fromDate(value instanceof Date ? value : new Date(value as string))),
  };
}

async function inputBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  try {
    const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

async function requireOwner(request: NextRequest): Promise<string | NextResponse> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return response('Authentication required', 401);
  try {
    initializeAdminApp();
    return (await getAuth().verifyIdToken(token, true)).uid;
  } catch { return response('Authentication required', 401); }
}

function writeFailure(cause: unknown, operation: string) {
  if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
  const message = cause instanceof Error ? cause.message : '';
  if (message === 'PROFILE') return response('Business profile required', 409);
  if (message === 'MEMBERSHIP') return response('Active membership required', 403);
  if (message === 'MODALITY') return response('Wrong business modality', 403);
  const code = (cause as { code?: unknown } | null)?.code;
  console.error('[owner/spaces write]', { operation, code: typeof code === 'number' ? code : 'internal' });
  return response('Save temporarily unavailable', 503);
}

async function hasCurrentOrLegacyReservations(
  transaction: FirebaseFirestore.Transaction,
  owner: string,
  spaceId: string,
  spaceName: string,
  zone: string,
): Promise<boolean> {
  const today = dateKeyInZone(new Date(), zone);
  const start = Timestamp.fromDate(localTimeToUtc(today, '00:00', zone));
  const reservations = await transaction.get(getAdminFirestore().collection('appointments')
    .where('businessId', '==', owner).where('date', '>=', start).limit(1000));
  if (reservations.size === 1000) return true;
  return reservations.docs.some(doc => {
    const appointment = doc.data();
    return appointment.status !== 'Cancelado' && (appointment.spaceId === spaceId || (!appointment.spaceId && appointment.space === spaceName));
  });
}

function canActivate(space: Record<string, unknown>, patch: SpaceWriteInput): boolean {
  const status = patch.status ?? space.status;
  if (status !== 'Activo') return true;
  return validateReservableSpaceWorkingHours(patch.workingHours ?? space.workingHours, patch.packages ?? space.packages) === null;
}

export async function POST(request: NextRequest) {
  const input = await inputBody(request);
  if (!input) return response('Invalid request', 400);
  const validated = validateSpaceWrite(input, true);
  if (!validated.data) return response(validated.error || 'Invalid space details', 400);
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;
  if (!imagesOwnedBy(validated.data, owner)) return response('Invalid space image', 400);
  if (validated.data.status === 'Activo' && validateReservableSpaceWorkingHours(validated.data.workingHours, validated.data.packages)) {
    return response('Configure availability before activating the space', 400);
  }
  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const spaceRef = db.collection('spaces').doc();
    await db.runTransaction(async transaction => {
      const business = (await transaction.get(businessRef)).data();
      if (!business) throw new Error('PROFILE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (business.businessType !== 'spaces') throw new Error('MODALITY');
      await confirmImagePermits(transaction, db, owner, [validated.data!.photo, ...(validated.data!.photos ?? [])], `spaces/${spaceRef.id}`);
      transaction.create(spaceRef, { ...timestamps(validated.data!), businessId: owner, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ id: spaceRef.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status); return writeFailure(cause, 'POST'); }
}

export async function PATCH(request: NextRequest) {
  const input = await inputBody(request);
  const spaceId = input?.spaceId;
  if (!input || !validId(spaceId)) return response('Invalid request', 400);
  const { spaceId: _spaceId, ...patch } = input;
  const validated = validateSpaceWrite(patch, false);
  if (!validated.data) return response(validated.error || 'Invalid space details', 400);
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;
  if (!imagesOwnedBy(validated.data, owner)) return response('Invalid space image', 400);
  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const spaceRef = db.collection('spaces').doc(spaceId);
    await db.runTransaction(async transaction => {
      const [businessSnap, spaceSnap] = await Promise.all([transaction.get(businessRef), transaction.get(spaceRef)]);
      const business = businessSnap.data();
      const space = spaceSnap.data();
      if (!business) throw new Error('PROFILE');
      if (!space || space.businessId !== owner) throw new Error('UNAVAILABLE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (business.businessType !== 'spaces') throw new Error('MODALITY');
      const zone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (validated.data!.name && validated.data!.name !== space.name && await hasCurrentOrLegacyReservations(transaction, owner, spaceId, space.name, zone)) throw new Error('LEGACY_RESERVATIONS');
      if (!canActivate(space, validated.data!)) throw new Error('INVALID_AVAILABILITY');
      await confirmImagePermits(transaction, db, owner, [validated.data!.photo, ...(validated.data!.photos ?? [])], `spaces/${spaceRef.id}`);
      transaction.update(spaceRef, { ...timestamps(validated.data!), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    const message = cause instanceof Error ? cause.message : '';
    if (['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(message)) return writeFailure(cause, 'PATCH');
    if (message === 'LEGACY_RESERVATIONS') return response('Space has legacy reservations', 409);
    if (message === 'INVALID_AVAILABILITY') return response('Configure availability before activating the space', 400);
    if (message === 'UNAVAILABLE') return response('Space unavailable', 404);
    return response('Space unavailable', 503);
  }
}

export async function DELETE(request: NextRequest) {
  const input = await inputBody(request);
  const spaceId = input?.spaceId;
  if (!input || !validId(spaceId) || Object.keys(input).length !== 1) return response('Invalid request', 400);
  const owner = await requireOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(owner);
    const spaceRef = db.collection('spaces').doc(spaceId);
    await db.runTransaction(async transaction => {
      const [businessSnap, spaceSnap] = await Promise.all([transaction.get(businessRef), transaction.get(spaceRef)]);
      const business = businessSnap.data();
      const space = spaceSnap.data();
      if (!business) throw new Error('PROFILE');
      if (!space || space.businessId !== owner) throw new Error('UNAVAILABLE');
      if (!hasActiveBusinessMembership(business)) throw new Error('MEMBERSHIP');
      if (business.businessType !== 'spaces') throw new Error('MODALITY');
      const zone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (await hasCurrentOrLegacyReservations(transaction, owner, spaceId, space.name, zone)) throw new Error('ACTIVE_RESERVATIONS');
      transaction.delete(spaceRef); transaction.update(businessRef, { lastModified: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    const message = cause instanceof Error ? cause.message : '';
    if (['PROFILE', 'MEMBERSHIP', 'MODALITY'].includes(message)) return writeFailure(cause, 'DELETE');
    if (message === 'ACTIVE_RESERVATIONS') return response('Space has active reservations', 409);
    if (message === 'UNAVAILABLE') return response('Space unavailable', 404);
    return response('Space unavailable', 503);
  }
}
