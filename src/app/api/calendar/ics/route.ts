import { NextRequest, NextResponse } from 'next/server';
import { generateIcsCalendar } from '@/lib/calendar-utils';
import { isDateKey, isTime, localTimeToUtc } from '@/lib/booking-constraints';

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    if (url.searchParams.has('id')) {
        return NextResponse.json({ error: 'Appointment links require a secure capability' }, { status: 403 });
    }
    const titleParam = url.searchParams.get('title');
    const dateParam = url.searchParams.get('date');
    const timeParam = url.searchParams.get('time');
    const durationParam = url.searchParams.get('duration');
    const locationParam = url.searchParams.get('location');
    const descParam = url.searchParams.get('desc');

    const title = titleParam || 'Turno Pediturno';
    const description = descParam || 'Tu cita agendada en Pediturno.';
    const location = locationParam || '';
    const startDate = dateParam && isDateKey(dateParam) ? localTimeToUtc(dateParam, '00:00') : dateParam ? new Date(dateParam) : new Date();
    const startTime = timeParam || '10:00';
    const durationMinutes = durationParam ? Number(durationParam) : 60;
    if (title.length > 200 || description.length > 1000 || location.length > 300 ||
        !Number.isFinite(startDate.getTime()) || !isTime(startTime) ||
        !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
        return NextResponse.json({ error: 'Invalid calendar details' }, { status: 400 });
    }

    const icsContent = generateIcsCalendar({
        title,
        description,
        location,
        startDate,
        startTime,
        durationMinutes,
    });

    return new NextResponse(icsContent, {
        status: 200,
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': 'attachment; filename="turno.ics"',
            'Cache-Control': 'no-cache',
        },
    });
}
