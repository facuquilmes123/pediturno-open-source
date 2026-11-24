import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { androidAppointmentDto, androidBusinessDto, androidClientDto, androidError, androidServiceDto, ownerTimeZone, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';
import { getMonthKey, countActiveAppointmentsInMonth } from '@/lib/appointment-quota';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function failure(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Bootstrap unavailable', 503, 'BOOTSTRAP_UNAVAILABLE');
}

export async function GET(request: NextRequest) {
  try {
    const { uid, db, business } = await requireAndroidOwner(request);
    const decision = await checkOwnerReadRateLimit(db, uid);
    if (!decision.allowed) return ownerReadRateLimitResponse(decision);
    const zone = ownerTimeZone(business);
    const today = Timestamp.fromDate(new Date());
    const currentMonthKey = getMonthKey(new Date(), zone);
    const [services, clients, upcoming] = await Promise.all([
      db.collection('services').where('businessId', '==', uid).limit(250).get(),
      db.collection('clients').where('businessId', '==', uid).limit(1000).get(),
      db.collection('appointments').where('businessId', '==', uid).where('date', '>=', today).limit(250).get(),
    ]);
    const currentMonthUsage = await countActiveAppointmentsInMonth(db, uid, currentMonthKey, zone);
    const enrichedBusiness = { ...business, currentMonthUsage, currentMonthKey };
    const businessDto = androidBusinessDto(uid, enrichedBusiness);
    const appointments = upcoming.docs
      .map(snapshot => androidAppointmentDto(snapshot.id, snapshot.data(), zone))
      .sort((a, b) => `${a.dateKey || ''} ${a.time}`.localeCompare(`${b.dateKey || ''} ${b.time}`));
    return NextResponse.json({
      apiVersion: 'v1',
      business: businessDto,
      membership: businessDto.membership,
      services: services.docs.map(snapshot => androidServiceDto(snapshot.id, snapshot.data())),
      clients: clients.docs.map(snapshot => androidClientDto(snapshot.id, snapshot.data())),
      upcomingAppointments: appointments,
      counts: {
        services: services.size,
        clients: clients.size,
        upcomingAppointments: appointments.length,
        truncated: services.size === 250 || clients.size === 1000 || upcoming.size === 250,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}
