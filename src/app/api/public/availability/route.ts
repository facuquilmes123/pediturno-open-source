import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { BUSINESS_TIME_ZONE, dateKeyInZone, isDateKey, localTimeToUtc } from '@/lib/booking-constraints';
import { verifyPublicAppCheck } from '@/lib/app-check-server';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';

type AvailabilityResult = { status: number; body: Record<string, unknown> };
const cache = new Map<string, { expiresAt: number; pending: Promise<AvailabilityResult> }>();
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_KEYS = 256;

async function readAvailability(businessId: string, dateKey: string): Promise<AvailabilityResult> {
  const db = getAdminFirestore();
  const business = await db.collection('businesses').doc(businessId).get();
  if (!business.exists || !isBusinessOperational(business.data())) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const zone = business.get('timeZone') || BUSINESS_TIME_ZONE;
  const rateRef = db.collection('availabilityRateLimits').doc(businessId);
  const minute = Math.floor(Date.now() / 60000);
  const admitted = await db.runTransaction(async tx => {
    const prior = (await tx.get(rateRef)).data();
    const count = prior?.minute === minute ? Number(prior.count || 0) : 0;
    if (count >= 120) return false;
    tx.set(rateRef, { businessId, minute, count: count + 1 });
    return true;
  });
  if (!admitted) return { status: 429, body: { error: 'Demasiadas consultas. Volvé a intentar en un minuto.' } };
  const nextDay = new Date(`${dateKey}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dayAfterNext = new Date(nextDay); dayAfterNext.setUTCDate(dayAfterNext.getUTCDate() + 1);
  // A space may start the previous evening and remain occupied after midnight.
  // Keep regular resources compatible while including those cross-day records.
  const previousDay = new Date(`${dateKey}T12:00:00Z`); previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const lower = Timestamp.fromDate(localTimeToUtc(previousDay.toISOString().slice(0, 10), '00:00', zone));
  // Include a next-day booking whose setup buffer already occupies the date
  // being requested. Space setup may start up to four hours before midnight.
  const upper = Timestamp.fromDate(localTimeToUtc(dayAfterNext.toISOString().slice(0, 10), '00:00', zone));
  const appointments = await db.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '>=', lower)
    .where('date', '<', upper)
    .limit(1000).get();
  if (appointments.size === 1000) {
    return { status: 503, body: { error: 'Availability unavailable' } };
  }
  const result = appointments.docs.flatMap(snapshot => {
    const data = snapshot.data();
    const date = data.date?.toDate?.();
    if (!date || data.status === 'Cancelado') return [];
    const occupiedStart = data.occupiedStartAt?.toDate?.() || date;
    const occupiedEnd = data.occupiedEndAt?.toDate?.() || date;
    const requestedStart = localTimeToUtc(dateKey, '00:00', zone);
    const requestedEnd = localTimeToUtc(nextDay.toISOString().slice(0, 10), '00:00', zone);
    const beginsToday = dateKeyInZone(date, zone) === dateKey;
    const occupiesToday = occupiedStart < requestedEnd && occupiedEnd > requestedStart;
    if (!beginsToday && !occupiesToday) return [];
    return [{
      date: `${dateKeyInZone(date, zone)}T12:00:00`,
      time: data.time,
      service: data.service || null,
      cancha: data.cancha || null,
      canchaId: data.canchaId || null,
      space: data.space || null,
      spaceId: data.spaceId || null,
      durationMinutes: data.durationMinutes || null,
      preparationMinutes: data.preparationMinutesAtBooking || 0,
      cleanupMinutes: data.cleanupMinutesAtBooking || 0,
      bookingBufferMinutes: data.bookingBufferMinutesAtBooking || 0,
      occupiedStartAt: occupiedStart.toISOString(),
      occupiedEndAt: occupiedEnd.toISOString(),
      status: data.status,
    }];
  });
  return { status: 200, body: { appointments: result } };
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId');
  const dateKey = request.nextUrl.searchParams.get('date');
  if (!businessId || !/^[\w-]{1,128}$/.test(businessId) || !isDateKey(dateKey)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const today = dateKeyInZone(new Date(), BUSINESS_TIME_ZONE);
  const latest = dateKeyInZone(new Date(Date.now() + 366 * 86400000), BUSINESS_TIME_ZONE);
  if (dateKey < today || dateKey > latest) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }
  if (!await verifyPublicAppCheck(request)) {
    return NextResponse.json({ error: 'Request verification failed' }, { status: 401 });
  }
  try {
    const key = `${businessId}:${dateKey}`;
    const prior = cache.get(key);
    let entry = prior && prior.expiresAt > Date.now() ? prior : undefined;
    if (!entry) {
      entry = { expiresAt: Date.now() + CACHE_TTL_MS, pending: readAvailability(businessId, dateKey) };
      cache.set(key, entry);
      if (cache.size > CACHE_MAX_KEYS) cache.delete(cache.keys().next().value!);
    }
    const result = await entry.pending;
    if (result.status === 503) cache.delete(key);
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store', ...(result.status === 429 ? { 'Retry-After': '60' } : {}) } });
  } catch {
    cache.delete(`${businessId}:${dateKey}`);
    return NextResponse.json({ error: 'Availability unavailable' }, { status: 503 });
  }
}
