import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { hashBookingCapability, isBookingCapabilityUsable, isValidBookingCapabilityToken } from '@/lib/booking-capability';
import { getBusinessBookingUrl } from '@/lib/verticals';

export const dynamic = 'force-dynamic';

function invalidLink() {
  return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!isValidBookingCapabilityToken(token)) return invalidLink();

  try {
    const db = getAdminFirestore();
    const capability = await db.collection('bookingCapabilities').doc(hashBookingCapability(token)).get();
    const data = capability.data();
    if (!data || !isBookingCapabilityUsable(data) || typeof data.appointmentId !== 'string' || typeof data.businessId !== 'string') return invalidLink();

    const [appointment, business] = await Promise.all([
      db.collection('appointments').doc(data.appointmentId).get(),
      db.collection('businesses').doc(data.businessId).get(),
    ]);
    const appointmentData = appointment.data();
    const businessData = business.data();
    if (!appointmentData || !businessData || appointmentData.businessId !== data.businessId || appointmentData.status === 'Cancelado') return invalidLink();

    const date = appointmentData.date?.toDate?.();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || typeof appointmentData.time !== 'string') return invalidLink();
    return NextResponse.json({
      appointment: {
        businessName: typeof businessData.name === 'string' ? businessData.name : 'el negocio',
        businessSlug: typeof businessData.slug === 'string' ? businessData.slug : null,
        businessUrl: typeof businessData.slug === 'string' ? getBusinessBookingUrl(businessData.businessType, businessData.slug) : null,
        service: typeof appointmentData.space === 'string' ? appointmentData.space : typeof appointmentData.service === 'string' ? appointmentData.service : (typeof appointmentData.cancha === 'string' ? appointmentData.cancha : 'Turno'),
        kind: typeof appointmentData.space === 'string' ? 'space' : typeof appointmentData.cancha === 'string' ? 'cancha' : 'service',
        date: date.toISOString(),
        time: appointmentData.time,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
