import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { BUSINESS_TIME_ZONE, bookingWeek, dateKeyInZone, isDateKey, isTime, localTimeToUtc, minutes, overlaps, shiftDateKey } from '@/lib/booking-constraints';
import { bookingSlotIds } from '@/lib/booking-slots';
import { isBusinessOperational } from '@/lib/server-membership';
import { adjustAppointmentQuotaForReschedule, AppointmentQuotaExceededError } from '@/lib/appointment-quota';
import { sameAppointmentResource } from '@/lib/booking-resource';
import { canRescheduleAppointmentStatus } from '@/lib/appointment-state';
import { findSpaceBookingWindow, occupiedInterval } from '@/lib/space-availability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function response(error: string, status: number) { return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }); }

async function authenticatedUid(request: NextRequest): Promise<string | null> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  initializeAdminApp();
  return (await getAuth().verifyIdToken(token, true)).uid;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  if (!idPattern.test(appointmentId)) return response('Invalid request', 400);
  let input: { dateKey?: unknown; time?: unknown };
  try { input = await request.json(); } catch { return response('Invalid request', 400); }
  if (!isDateKey(input.dateKey) || !isTime(input.time)) return response('Invalid appointment details', 400);
  let uid: string | null;
  try { uid = await authenticatedUid(request); } catch { return response('Authentication required', 401); }
  if (!uid) return response('Authentication required', 401);

  try {
    const dateKey = input.dateKey as string;
    const time = input.time as string;
    const db = getAdminFirestore();
    const appointmentRef = db.collection('appointments').doc(appointmentId);
    const result = await db.runTransaction(async transaction => {
      const appointmentSnap = await transaction.get(appointmentRef);
      const appointment = appointmentSnap.data();
       if (!appointment || appointment.businessId !== uid) throw new Error('NOT_FOUND');
       if (!canRescheduleAppointmentStatus(appointment.status)) throw new Error('TERMINAL');
      if (appointment.paymentStatus === 'pending') throw new Error('TERMINAL');
      const businessRef = db.collection('businesses').doc(uid);
      const resourceRef = typeof appointment.spaceId === 'string'
        ? db.collection('spaces').doc(appointment.spaceId)
        : typeof appointment.canchaId === 'string'
          ? db.collection('canchas').doc(appointment.canchaId)
          : typeof appointment.serviceId === 'string' ? db.collection('services').doc(appointment.serviceId) : null;
      if (!resourceRef) throw new Error('RESOURCE');
      const [businessSnap, resourceSnap] = await Promise.all([transaction.get(businessRef), transaction.get(resourceRef)]);
      const business = businessSnap.data();
      const resource = resourceSnap.data();
      if (!business || !isBusinessOperational(business)) throw new Error('MEMBERSHIP_REQUIRED');
      if (!resource || resource.businessId !== uid || resource.status !== 'Activo') throw new Error('RESOURCE');
       const zone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      const start = localTimeToUtc(dateKey, time, zone);
      if (typeof appointment.spaceId === 'string' && minutes(time) % 10 !== 0) throw new Error('UNAVAILABLE');
       if (start <= new Date()) throw new Error('PAST_DATE');
      const duration = Number(appointment.durationMinutes) || (appointment.canchaId ? Number(resource.duration) : parseInt(String(resource.duration), 10));
      if (!Number.isInteger(duration) || duration < 10 || duration > 1440) throw new Error('RESOURCE');
      const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
      const config = resource.workingHours?.[weekday];
      const startMinute = minutes(time);
      const spaceWindow = typeof appointment.spaceId === 'string'
        ? findSpaceBookingWindow(resource.workingHours, weekday, time, duration)
        : null;
      const fits = typeof appointment.spaceId === 'string'
        ? !!spaceWindow && (!spaceWindow.isAlternating || bookingWeek(shiftDateKey(dateKey, spaceWindow.sourceDayOffset)) % 2 === 0)
        : config?.slots?.some((slot: { start: string; end: string }) => isTime(slot.start) && isTime(slot.end) && startMinute >= minutes(slot.start) && startMinute + duration <= minutes(slot.end));
      if (!fits) throw new Error('UNAVAILABLE');
      if (typeof appointment.spaceId !== 'string' && config.isAlternating) {
        const week = bookingWeek(dateKey);
        if (week % 2 !== 0) throw new Error('UNAVAILABLE');
      }
      const scheduleDateKey = spaceWindow ? shiftDateKey(dateKey, spaceWindow.sourceDayOffset) : dateKey;
      if ((resource.unavailableDates || []).some((value: Timestamp | Date) => { const key = dateKeyInZone(value instanceof Timestamp ? value.toDate() : new Date(value), zone); return key === dateKey || key === scheduleDateKey; })) throw new Error('UNAVAILABLE');
      const buffer = Math.max(0, Math.min(240, Number(appointment.bookingBufferMinutesAtBooking ?? business.bookingSettings?.appointmentBufferMinutes ?? 0)));
      if (!Number.isFinite(buffer) || typeof appointment.spaceId === 'string' && Math.trunc(buffer) % 10 !== 0) throw new Error('RESOURCE');
      const preparation = typeof appointment.spaceId === 'string' ? Math.max(0, Math.min(240, Number(appointment.preparationMinutesAtBooking || 0) || 0)) : 0;
      const cleanup = typeof appointment.spaceId === 'string' ? Math.max(0, Math.min(240, Number(appointment.cleanupMinutesAtBooking || 0) || 0)) : 0;
      if (typeof appointment.spaceId === 'string' && (preparation % 10 !== 0 || cleanup % 10 !== 0)) throw new Error('RESOURCE');
      const resourceKey = typeof appointment.spaceId === 'string' ? `space_${appointment.spaceId}` : appointment.canchaId ? `cancha_${appointment.canchaId}` : 'services';
      const nextSlots = bookingSlotIds(uid, resourceKey, start, duration, cleanup + buffer, preparation, typeof appointment.spaceId === 'string' ? 10 : 5);
      const oldSlots = Array.isArray(appointment.bookingSlotIds) ? appointment.bookingSlotIds.filter((slot: unknown): slot is string => typeof slot === 'string' && /^[a-f0-9]{64}$/.test(slot)) : [];
      const midnight = localTimeToUtc(dateKey, '00:00', zone);
      const lower = Timestamp.fromDate(new Date(midnight.getTime() - 48 * 3600000));
      const upper = Timestamp.fromDate(new Date(midnight.getTime() + 48 * 3600000));
      const sameDay = db.collection('appointments').where('businessId', '==', uid).where('date', '>=', lower).where('date', '<', upper).limit(1000);
      const existing = await transaction.get(sameDay);
      if (existing.size === 1000) throw new Error('UNAVAILABLE');
      for (const document of existing.docs) {
        if (document.id === appointmentRef.id) continue;
        const current = document.data();
        const currentDate = current.date?.toDate?.();
        if (!currentDate || current.status === 'Cancelado' || dateKeyInZone(currentDate, zone) !== dateKey || !isTime(current.time)) continue;
        const sameResource = typeof appointment.spaceId === 'string'
          ? current.spaceId === appointment.spaceId || (!current.spaceId && current.space === resource.name)
          : sameAppointmentResource(current, appointment.canchaId, resource.name);
        if (sameResource && overlaps(startMinute, duration, minutes(current.time), Number(current.durationMinutes) || duration, buffer)) throw new Error('SLOT_TAKEN');
      }
      const oldDate = appointment.date instanceof Timestamp ? appointment.date.toDate() : (appointment.date?.toDate?.() || new Date(appointment.date));
      const oldDateKey = dateKeyInZone(oldDate, zone);
      await adjustAppointmentQuotaForReschedule(transaction, db, uid, business, oldDateKey, dateKey, zone);
      const oldSet = new Set(oldSlots);
      const newSet = new Set(nextSlots);
      for (const slotId of nextSlots) if (!oldSet.has(slotId)) transaction.create(db.collection('bookingSlots').doc(slotId), { businessId: uid, appointmentId: appointmentRef.id });
      for (const slotId of oldSlots) if (!newSet.has(slotId)) transaction.delete(db.collection('bookingSlots').doc(slotId));
       const occupied = occupiedInterval(start, duration, preparation, cleanup + buffer);
       markOwnerAgendaChanged(transaction, db, appointment.businessId); transaction.update(appointmentRef, { date: Timestamp.fromDate(midnight), time, durationMinutes: duration, bookingSlotIds: nextSlots, occupiedStartAt: Timestamp.fromDate(occupied.start), occupiedEndAt: Timestamp.fromDate(occupied.end), status: appointment.status, lastModified: FieldValue.serverTimestamp() });
      transaction.update(resourceRef, { bookingRevision: FieldValue.increment(1) });
      return { id: appointmentRef.id, date: midnight.toISOString(), time };
    });
    return NextResponse.json({ appointment: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof AppointmentQuotaExceededError) return response(cause.message, 409);
    const message = cause instanceof Error ? cause.message : '';
    if (message === 'NOT_FOUND') return response('Appointment not found', 404);
    if (message === 'TERMINAL') return response('Completed or cancelled appointments cannot be rescheduled', 409);
    if (message === 'PAST_DATE') return response('Appointments cannot be rescheduled to the past', 400);
    if (message === 'MEMBERSHIP_REQUIRED') return response('Active membership required', 403);
    if (message === 'SLOT_TAKEN' || (cause as { code?: number | string })?.code === 6) return response('Slot already booked', 409);
    if (message === 'RESOURCE' || message === 'UNAVAILABLE') return response('Selected time is unavailable', 409);
    return response('Reschedule unavailable', 503);
  }
}
