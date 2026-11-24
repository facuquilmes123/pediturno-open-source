import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { androidAppointmentDto, androidError, asRecord, isDocumentId, ownerDayBounds, ownerTimeZone, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';
import { bookingWeek, dateKeyInZone, isDateKey, isTime, localTimeToUtc, minutes } from '@/lib/booking-constraints';
import { intervalsOverlap, occupiedInterval } from '@/lib/space-availability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function durationFor(service: Record<string, unknown>) {
  const duration = Number(service.duration);
  return Number.isInteger(duration) && duration >= 10 && duration <= 1440 ? duration : null;
}

function appointmentInterval(appointment: Record<string, unknown>, zone: string) {
  const date = appointment.date instanceof Timestamp ? appointment.date.toDate()
    : appointment.date && typeof appointment.date === 'object' && typeof (appointment.date as { toDate?: unknown }).toDate === 'function'
      ? (appointment.date as { toDate: () => Date }).toDate() : null;
  const duration = Number(appointment.durationMinutes);
  if (!(date instanceof Date) || !isTime(appointment.time) || !Number.isInteger(duration)) return null;
  const buffer = Math.max(0, Math.min(240, Number(appointment.bookingBufferMinutesAtBooking || 0) || 0));
  return occupiedInterval(localTimeToUtc(dateKeyInZone(date, zone), appointment.time as string, zone), duration, 0, buffer);
}

function serviceSlotStarts(service: Record<string, unknown>, dateKey: string, duration: number) {
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const config = asRecord(asRecord(service.workingHours)?.[String(weekday)]);
  if (!config || config.isAlternating === true && bookingWeek(dateKey) % 2 !== 0 || !Array.isArray(config.slots)) return [];
  const starts = new Set<string>();
  for (const slot of config.slots) {
    const item = asRecord(slot);
    if (!item || !isTime(item.start) || !isTime(item.end)) continue;
    for (let value = minutes(item.start); value + duration <= minutes(item.end); value += 5) {
      starts.add(`${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`);
    }
  }
  return [...starts].sort();
}

function unavailable(service: Record<string, unknown>, dateKey: string, zone: string) {
  return Array.isArray(service.unavailableDates) && service.unavailableDates.some(value => {
    const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
    return date instanceof Date && dateKeyInZone(date, zone) === dateKey;
  });
}

export async function GET(request: NextRequest) {
  try {
    const serviceId = request.nextUrl.searchParams.get('serviceId');
    const dateKey = request.nextUrl.searchParams.get('date') || request.nextUrl.searchParams.get('dateKey');
    const excludeAppointmentId = request.nextUrl.searchParams.get('excludeAppointmentId');
    if (!isDocumentId(serviceId) || !isDateKey(dateKey) || excludeAppointmentId !== null && !isDocumentId(excludeAppointmentId)) return androidError('Invalid request', 400, 'INVALID_REQUEST');
    const owner = await requireAndroidOwner(request);
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const zone = ownerTimeZone(owner.business);
    const serviceSnapshot = await owner.db.collection('services').doc(serviceId).get();
    const service = serviceSnapshot.data() as Record<string, unknown> | undefined;
    const duration = service && durationFor(service);
    if (!service || service.businessId !== owner.uid || service.status !== 'Activo' || !duration) return androidError('Service unavailable', 404, 'SERVICE_NOT_FOUND');
    const { start, end } = ownerDayBounds(dateKey, zone);
    const nearbyStart = Timestamp.fromDate(new Date(start.toDate().getTime() - 24 * 60 * 60 * 1000));
    const nearbyEnd = Timestamp.fromDate(new Date(end.toDate().getTime() + 24 * 60 * 60 * 1000));
    const snapshot = await owner.db.collection('appointments').where('businessId', '==', owner.uid)
      .where('date', '>=', nearbyStart).where('date', '<', nearbyEnd).limit(1000).get();
    if (snapshot.size === 1000) return androidError('Availability unavailable', 503, 'AVAILABILITY_LIMIT');
    const appointments = snapshot.docs.filter(item => {
      const value = item.data();
      return item.id !== excludeAppointmentId && value.status !== 'Cancelado' && !value.canchaId && !value.spaceId && !value.cancha && !value.space;
    });
    const businessSettings = asRecord(owner.business.bookingSettings);
    const configuredBuffer = service.bookingBufferMinutes ?? businessSettings?.appointmentBufferMinutes ?? 0;
    const buffer = Math.max(0, Math.min(240, Number(configuredBuffer) || 0));
    const slots = unavailable(service, dateKey, zone) ? [] : serviceSlotStarts(service, dateKey, duration).map(time => {
      const candidate = occupiedInterval(localTimeToUtc(dateKey, time, zone), duration, 0, buffer);
      return { time, available: !appointments.some(item => {
        const interval = appointmentInterval(item.data(), zone);
        return interval && intervalsOverlap(candidate, interval);
      }) };
    });
    return NextResponse.json({ serviceId, date: dateKey, timeZone: zone, durationMinutes: duration, slots, appointments: appointments.map(item => androidAppointmentDto(item.id, item.data(), zone)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Availability unavailable', 503, 'AVAILABILITY_UNAVAILABLE');
  }
}
