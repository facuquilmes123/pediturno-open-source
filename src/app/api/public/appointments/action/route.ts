import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createBookingCapability, hashBookingCapability, isBookingCapabilityUsable, isValidBookingCapabilityToken } from '@/lib/booking-capability';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { BUSINESS_TIME_ZONE, bookingWeek, dateKeyInZone, isDateKey, isTime, localTimeToUtc, minutes, overlaps, shiftDateKey } from '@/lib/booking-constraints';
import { bookingSlotIds } from '@/lib/booking-slots';
import { createBookingConfirmationOutbox } from '@/lib/booking-outbox';
import { scheduleBookingDelivery } from '@/lib/booking-delivery';
import { isBusinessOperational } from '@/lib/server-membership';
import { releaseAppointmentQuota, adjustAppointmentQuotaForReschedule, AppointmentQuotaExceededError } from '@/lib/appointment-quota';
import { sameAppointmentResource } from '@/lib/booking-resource';
import { findSpaceBookingWindow, occupiedInterval } from '@/lib/space-availability';

export const dynamic = 'force-dynamic';

type ActionInput = { token?: string; action?: 'cancel' | 'reschedule'; dateKey?: string; time?: string };

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function invalidLink() { return response('Invalid or expired link', 404); }

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 2048) return response('Invalid request', 400);
  let input: ActionInput;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 2048) return response('Invalid request', 400);
    input = JSON.parse(raw);
  } catch { return response('Invalid request', 400); }

  if (!isValidBookingCapabilityToken(input.token) || (input.action !== 'cancel' && input.action !== 'reschedule')) return invalidLink();
  if (input.action === 'reschedule' && (!isDateKey(input.dateKey) || !isTime(input.time))) return response('Invalid booking details', 400);

  try {
    const db = getAdminFirestore();
    const capabilityRef = db.collection('bookingCapabilities').doc(hashBookingCapability(input.token));
    const result = await db.runTransaction(async transaction => {
      const capabilitySnap = await transaction.get(capabilityRef);
      const capability = capabilitySnap.data();
      if (!capability || !isBookingCapabilityUsable(capability) || typeof capability.appointmentId !== 'string' || typeof capability.businessId !== 'string') throw new Error('INVALID_CAPABILITY');

      const appointmentRef = db.collection('appointments').doc(capability.appointmentId);
      const appointmentSnap = await transaction.get(appointmentRef);
      const appointment = appointmentSnap.data();
      if (!appointment || appointment.businessId !== capability.businessId ||
          (appointment.status !== 'Confirmado' && appointment.status !== 'Pendiente')) throw new Error('INVALID_CAPABILITY');
      if (appointment.paymentStatus === 'pending') throw new Error('INVALID_CAPABILITY');
      const businessRef = db.collection('businesses').doc(capability.businessId);
      const businessSnap = await transaction.get(businessRef);
      const business = businessSnap.data();
      if (!business || business.status !== 'active') throw new Error('INVALID_CAPABILITY');
      const originalDate = appointment.date instanceof Timestamp ? appointment.date.toDate() : null;
      const originalZone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      if (!originalDate || !isTime(appointment.time) ||
          localTimeToUtc(dateKeyInZone(originalDate, originalZone), appointment.time, originalZone).getTime() <= Date.now()) {
        throw new Error('INVALID_CAPABILITY');
      }
      const previousSlotIds: string[] = Array.isArray(appointment.bookingSlotIds)
        ? appointment.bookingSlotIds.filter((id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)).slice(0, 400)
        : [];

      if (input.action === 'cancel') {
        await releaseAppointmentQuota(transaction, db, capability.businessId, dateKeyInZone(originalDate, originalZone), originalZone);
        markOwnerAgendaChanged(transaction, db, capability.businessId); transaction.update(appointmentRef, { status: 'Cancelado', cancelledAt: FieldValue.serverTimestamp(), cancelledBy: 'customer' });
        transaction.update(capabilityRef, { usedAt: FieldValue.serverTimestamp(), usedAction: 'cancel' });
        for (const slotId of previousSlotIds) transaction.delete(db.collection('bookingSlots').doc(slotId));
        return { action: 'cancel' as const };
      }

      if (!isBusinessOperational(business)) throw new Error('RESOURCE_UNAVAILABLE');

      const resourceRef = typeof appointment.spaceId === 'string'
        ? db.collection('spaces').doc(appointment.spaceId)
        : appointment.canchaId
          ? db.collection('canchas').doc(appointment.canchaId)
          : (typeof appointment.serviceId === 'string' ? db.collection('services').doc(appointment.serviceId) : null);
      if (!resourceRef) throw new Error('RESOURCE_UNAVAILABLE');
      const resourceSnap = await transaction.get(resourceRef);
      const resource = resourceSnap.data();
      if (!resource || resource.businessId !== capability.businessId || resource.status !== 'Activo') throw new Error('RESOURCE_UNAVAILABLE');

      const zone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
      const start = localTimeToUtc(input.dateKey!, input.time!, zone);
      if (typeof appointment.spaceId === 'string' && minutes(input.time!) % 10 !== 0) throw new Error('DATE_UNAVAILABLE');
      const now = new Date();
      const leadHoursValue = Number(business.bookingSettings?.bookingLeadTimeHours ?? 0);
      const horizonDaysValue = Number(business.bookingSettings?.bookingHorizonDays ?? 30);
      if (!Number.isFinite(leadHoursValue) || !Number.isFinite(horizonDaysValue)) throw new Error('RESOURCE_UNAVAILABLE');
      const leadHours = Math.max(0, leadHoursValue);
      const horizonDays = Math.min(365, Math.max(1, horizonDaysValue));
      if (start.getTime() < now.getTime() + leadHours * 3600000 || start.getTime() > now.getTime() + horizonDays * 86400000) throw new Error('DATE_UNAVAILABLE');
      const duration = Number(appointment.durationMinutes) || (appointment.canchaId ? Number(resource.duration) : parseInt(String(resource.duration), 10));
      if (!Number.isInteger(duration) || duration < 10 || duration > 1440) throw new Error('RESOURCE_UNAVAILABLE');
      const weekday = new Date(`${input.dateKey}T12:00:00.000Z`).getUTCDay();
      const dayConfig = resource.workingHours?.[weekday];
      const startMinute = minutes(input.time!);
      const spaceWindow = typeof appointment.spaceId === 'string'
        ? findSpaceBookingWindow(resource.workingHours, weekday, input.time!, duration)
        : null;
      const fits = typeof appointment.spaceId === 'string'
        ? !!spaceWindow && (!spaceWindow.isAlternating || bookingWeek(shiftDateKey(input.dateKey!, spaceWindow.sourceDayOffset)) % 2 === 0)
        : dayConfig?.slots?.some((slot: { start: string; end: string }) => isTime(slot.start) && isTime(slot.end) && startMinute >= minutes(slot.start) && startMinute + duration <= minutes(slot.end));
      if (!fits) throw new Error('DATE_UNAVAILABLE');
      if (typeof appointment.spaceId !== 'string' && dayConfig.isAlternating) {
        const week = bookingWeek(input.dateKey!);
        if (week % 2 !== 0) throw new Error('DATE_UNAVAILABLE');
      }
      const scheduleDateKey = spaceWindow ? shiftDateKey(input.dateKey!, spaceWindow.sourceDayOffset) : input.dateKey!;
      if ((resource.unavailableDates || []).some((value: Timestamp | Date) => {
        const date = value instanceof Timestamp ? value.toDate() : new Date(value);
        const key = !Number.isNaN(date.getTime()) ? dateKeyInZone(date, zone) : '';
        return key === input.dateKey || key === scheduleDateKey;
      })) throw new Error('DATE_UNAVAILABLE');

      const midnight = localTimeToUtc(input.dateKey!, '00:00', zone);
      const lower = Timestamp.fromDate(new Date(midnight.getTime() - 48 * 3600000));
      const upper = Timestamp.fromDate(new Date(midnight.getTime() + 48 * 3600000));
      const sameDay = db.collection('appointments').where('businessId', '==', capability.businessId).where('date', '>=', lower).where('date', '<', upper).limit(1000);
      const resourceKey = typeof appointment.spaceId === 'string' ? `space_${appointment.spaceId}` : appointment.canchaId ? `cancha_${appointment.canchaId}` : 'services';
      const existingAppointments = await transaction.get(sameDay);
      if (existingAppointments.size === 1000) throw new Error('DATE_UNAVAILABLE');
      const bufferValue = Number(appointment.bookingBufferMinutesAtBooking ?? business.bookingSettings?.appointmentBufferMinutes ?? 0);
      if (!Number.isFinite(bufferValue) || typeof appointment.spaceId === 'string' && Math.trunc(bufferValue) % 10 !== 0) throw new Error('RESOURCE_UNAVAILABLE');
      const buffer = Math.max(0, Math.min(240, bufferValue));
      const preparation = typeof appointment.spaceId === 'string' ? Math.max(0, Math.min(240, Number(appointment.preparationMinutesAtBooking || 0) || 0)) : 0;
      const cleanup = typeof appointment.spaceId === 'string' ? Math.max(0, Math.min(240, Number(appointment.cleanupMinutesAtBooking || 0) || 0)) : 0;
      if (typeof appointment.spaceId === 'string' && (preparation % 10 !== 0 || cleanup % 10 !== 0)) throw new Error('RESOURCE_UNAVAILABLE');
      const nextSlotIds = bookingSlotIds(capability.businessId, resourceKey, start, duration, cleanup + buffer, preparation, typeof appointment.spaceId === 'string' ? 10 : 5);
      for (const existing of existingAppointments.docs) {
        if (existing.id === appointmentRef.id) continue;
        const current = existing.data();
        const currentDate = current.date?.toDate?.();
        if (!currentDate || current.status === 'Cancelado' || dateKeyInZone(currentDate, zone) !== input.dateKey || !isTime(current.time)) continue;
        const sameResource = typeof appointment.spaceId === 'string'
          ? current.spaceId === appointment.spaceId || (!current.spaceId && current.space === resource.name)
          : sameAppointmentResource(current, appointment.canchaId, resource.name);
        if (sameResource && overlaps(startMinute, duration, minutes(current.time), Number(current.durationMinutes) || duration, buffer)) throw new Error('SLOT_TAKEN');
      }

      await adjustAppointmentQuotaForReschedule(transaction, db, capability.businessId, business, dateKeyInZone(originalDate, originalZone), input.dateKey!, zone);
      const nextCapability = createBookingCapability({ appointmentId: appointmentRef.id, businessId: capability.businessId, now, ttlMs: start.getTime() - now.getTime() });
      const nextOutbox = createBookingConfirmationOutbox({ appointmentId: appointmentRef.id, businessId: capability.businessId, token: nextCapability.token, capabilityExpiresAt: nextCapability.capability.expiresAt, isReschedule: true });
      const previous = new Set(previousSlotIds);
      const next = new Set(nextSlotIds);
      for (const slotId of nextSlotIds) {
        if (!previous.has(slotId)) transaction.create(db.collection('bookingSlots').doc(slotId), { businessId: capability.businessId, appointmentId: appointmentRef.id });
      }
      for (const slotId of previousSlotIds) {
        if (!next.has(slotId)) transaction.delete(db.collection('bookingSlots').doc(slotId));
      }
      const occupied = occupiedInterval(start, duration, preparation, cleanup + buffer);
      markOwnerAgendaChanged(transaction, db, capability.businessId); transaction.update(appointmentRef, { date: Timestamp.fromDate(midnight), time: input.time, bookingSlotIds: nextSlotIds, occupiedStartAt: Timestamp.fromDate(occupied.start), occupiedEndAt: Timestamp.fromDate(occupied.end), updatedAt: FieldValue.serverTimestamp(), rescheduledBy: 'customer' });
      transaction.update(resourceRef, { bookingRevision: FieldValue.increment(1) });
      transaction.update(capabilityRef, { usedAt: FieldValue.serverTimestamp(), usedAction: 'reschedule', replacedBy: nextCapability.tokenHash });
      transaction.create(db.collection('bookingCapabilities').doc(nextCapability.tokenHash), nextCapability.capability);
      const outboxRef = db.collection('bookingEmailOutbox').doc();
      transaction.create(outboxRef, nextOutbox);
      return { action: 'reschedule' as const, nextToken: nextCapability.token, outboxId: outboxRef.id };
    });
    if (result.action === 'reschedule') scheduleBookingDelivery(result.outboxId);
    return NextResponse.json({ action: result.action, ...(result.action === 'reschedule' ? { nextToken: result.nextToken } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    if (cause instanceof AppointmentQuotaExceededError) return response(cause.message, 409);
    if (message === 'INVALID_CAPABILITY') return invalidLink();
    if (message === 'SLOT_TAKEN') return response('Slot already booked', 409);
    if ((cause as { code?: number | string })?.code === 6 || (cause as { code?: number | string })?.code === 'already-exists') return response('Slot already booked', 409);
    if (message === 'DATE_UNAVAILABLE' || message === 'RESOURCE_UNAVAILABLE') return response('Selected time is unavailable', 409);
    return response('Service unavailable', 503);
  }
}
