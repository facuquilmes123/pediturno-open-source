import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { createBookingCapability } from '@/lib/booking-capability';
import { dateKeyInZone, localTimeToUtc, BUSINESS_TIME_ZONE, isTime } from '@/lib/booking-constraints';
import { createBookingConfirmationOutbox } from '@/lib/booking-outbox';
import { scheduleBookingDelivery } from '@/lib/booking-delivery';
import { sendCancellationEmail, sendReminderEmail } from '@/services/email';
import { isBusinessOperational } from '@/lib/server-membership';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NotificationKind = 'confirmation' | 'cancellation' | 'reminder';

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validAppointmentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validKind(value: unknown): value is NotificationKind {
  return value === 'confirmation' || value === 'cancellation' || value === 'reminder';
}

function occurrence(data: Record<string, any>): string {
  return `${data.date?.toMillis?.()}:${data.time}:${data.status}`;
}

async function authenticatedOwner(request: NextRequest): Promise<string | null> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  initializeAdminApp();
  const decoded = await getAuth().verifyIdToken(token, true);
  return decoded.uid;
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 1024) return response('Payload too large', 413);
  let input: { appointmentId?: unknown; kind?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 1024) return response('Payload too large', 413);
    input = JSON.parse(raw);
  } catch {
    return response('Invalid request', 400);
  }
  if (!validAppointmentId(input.appointmentId) || !validKind(input.kind)) return response('Invalid request', 400);

  let ownerId: string | null;
  try {
    ownerId = await authenticatedOwner(request);
  } catch {
    return response('Authentication required', 401);
  }
  if (!ownerId) return response('Authentication required', 401);

  try {
    const db = getAdminFirestore();
    const appointmentRef = db.collection('appointments').doc(input.appointmentId);
    const businessRef = db.collection('businesses').doc(ownerId);
    const [appointmentSnap, businessSnap] = await Promise.all([appointmentRef.get(), businessRef.get()]);
    const appointment = appointmentSnap.data();
    const business = businessSnap.data();
    if (!appointment || !business || appointment.businessId !== ownerId) return response('Appointment not found', 404);
    if (!isBusinessOperational(business)) return response('Active membership required', 403);
    if (appointment.paymentStatus === 'pending' && input.kind !== 'cancellation') return response('La seña todavía no está acreditada.', 409);
    if (typeof appointment.clientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appointment.clientEmail)) {
      return response('Appointment has no deliverable email', 409);
    }

    const occurrenceKey = occurrence(appointment);
    const markerRef = db.collection('ownerEmailNotifications').doc(createHash('sha256').update(`${input.appointmentId}:${input.kind}:${occurrenceKey}`).digest('hex'));
    if (input.kind === 'confirmation') {
      if (appointment.status !== 'Confirmado' && appointment.status !== 'Pendiente') return response('Appointment cannot be confirmed', 409);
      const appointmentDate = appointment.date instanceof Timestamp ? appointment.date.toDate() : null;
      if (!appointmentDate || !isTime(appointment.time)) return response('Appointment date unavailable', 409);
      const now = new Date();
      const startsAt = localTimeToUtc(dateKeyInZone(appointmentDate, business.timeZone || BUSINESS_TIME_ZONE), appointment.time, business.timeZone || BUSINESS_TIME_ZONE);
      if (startsAt <= now || startsAt.getTime() - now.getTime() > 366 * 86400000) return response('Appointment date unavailable', 409);
      const capability = createBookingCapability({ appointmentId: input.appointmentId, businessId: ownerId, now, ttlMs: startsAt.getTime() - now.getTime() });
      const outbox = createBookingConfirmationOutbox({
        appointmentId: input.appointmentId,
        businessId: ownerId,
        token: capability.token,
        capabilityExpiresAt: capability.capability.expiresAt,
      });
      const capabilityRef = db.collection('bookingCapabilities').doc(capability.tokenHash);
      const outboxRef = db.collection('bookingEmailOutbox').doc();
      const result = await db.runTransaction(async transaction => {
        const [currentAppointment, currentBusiness, priorMarker] = await Promise.all([
          transaction.get(appointmentRef), transaction.get(businessRef), transaction.get(markerRef),
        ]);
        if (!currentAppointment.exists || !currentBusiness.exists || currentAppointment.get('businessId') !== ownerId) throw new Error('NOT_FOUND');
        if (occurrence(currentAppointment.data()!) !== occurrenceKey) throw new Error('INVALID_STATUS');
        if (!isBusinessOperational(currentBusiness.data())) throw new Error('MEMBERSHIP_REQUIRED');
        if (currentAppointment.get('status') !== 'Confirmado' && currentAppointment.get('status') !== 'Pendiente') throw new Error('INVALID_STATUS');
        if (priorMarker.exists) return { repeated: true, outboxId: priorMarker.get('outboxId') as string | undefined };
        transaction.create(capabilityRef, capability.capability);
        transaction.create(outboxRef, outbox);
        transaction.create(markerRef, {
          appointmentId: input.appointmentId,
          businessId: ownerId,
          kind: input.kind,
          status: 'queued',
          outboxId: outboxRef.id,
          createdAt: Timestamp.now(),
        });
        return { repeated: false, outboxId: outboxRef.id };
      });
      scheduleBookingDelivery(result.outboxId);
      return NextResponse.json({ status: 'queued', repeated: result.repeated }, { status: result.repeated ? 200 : 202, headers: { 'Cache-Control': 'no-store' } });
    }

    if (input.kind === 'cancellation' && appointment.status !== 'Cancelado') return response('Appointment is not cancelled', 409);
    if (input.kind === 'reminder' && appointment.status !== 'Confirmado') return response('Appointment is not confirmed', 409);

    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000);
    const claim = await db.runTransaction(async transaction => {
      const [prior, currentBusiness, currentAppointment] = await Promise.all([
        transaction.get(markerRef),
        transaction.get(businessRef),
        transaction.get(appointmentRef),
      ]);
      if (!isBusinessOperational(currentBusiness.data())) throw new Error('MEMBERSHIP_REQUIRED');
      if (!currentAppointment.exists || occurrence(currentAppointment.data()!) !== occurrenceKey) throw new Error('INVALID_STATUS');
      const state = prior.data();
      if (state?.status === 'sent') return 'sent' as const;
      if (state?.status === 'sending' && state.leaseUntil instanceof Timestamp && state.leaseUntil.toDate() > new Date()) return 'sending' as const;
      if (Number(state?.attempts || 0) >= 5) throw new Error('RETRY_LIMIT');
      transaction.set(markerRef, {
        appointmentId: input.appointmentId,
        businessId: ownerId,
        kind: input.kind,
        status: 'sending',
        attempts: Number(state?.attempts || 0) + 1,
        leaseUntil: Timestamp.fromDate(leaseUntil),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return 'claimed' as const;
    });
    if (claim === 'sent') return NextResponse.json({ status: 'sent', repeated: true }, { headers: { 'Cache-Control': 'no-store' } });
    if (claim === 'sending') return NextResponse.json({ status: 'in-progress' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });

    try {
      const emailAppointment = { ...appointment, id: appointmentSnap.id, date: appointment.date?.toDate?.() || appointment.date };
      const emailBusiness = { ...business, id: ownerId };
      const emailResult = input.kind === 'cancellation'
        ? await sendCancellationEmail({ appointment: emailAppointment, business: emailBusiness, recipient: 'client' } as unknown as Parameters<typeof sendCancellationEmail>[0])
        : await sendReminderEmail({ appointment: emailAppointment, business: emailBusiness } as unknown as Parameters<typeof sendReminderEmail>[0]);
      if (emailResult.success !== true) throw new Error('EMAIL_NOT_ACCEPTED');
      await markerRef.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ status: 'sent', repeated: false }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      await markerRef.update({ status: 'failed', leaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      return response('Notification unavailable', 503);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return response('Appointment not found', 404);
    if (error instanceof Error && error.message === 'INVALID_STATUS') return response('Appointment cannot be confirmed', 409);
    if (error instanceof Error && error.message === 'MEMBERSHIP_REQUIRED') return response('Active membership required', 403);
    return response('Notification unavailable', 503);
  }
}
