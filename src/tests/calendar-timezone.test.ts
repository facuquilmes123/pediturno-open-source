import { describe, expect, it } from 'vitest';
import { generateGoogleCalendarUrl, generateIcsCalendar } from '@/lib/calendar-utils';
import { GET } from '@/app/api/calendar/ics/route';
import { NextRequest } from 'next/server';
describe('calendar exports in business time zone', () => {
  const options = { title: 'Cancha 1', description: '', startDate: new Date('2026-10-09T03:00:00Z'), startTime: '20:00', durationMinutes: 90 };
  it('exports the same instant on a UTC server and an Argentina device', () => {
    const url = new URL(generateGoogleCalendarUrl(options));
    expect(url.searchParams.get('dates')).toBe('20261009T230000Z/20261010T003000Z');
    expect(generateIcsCalendar(options)).toContain('DTSTART:20261009T230000Z');
  });
  it('escapes CR and LF instead of allowing injected ICS fields', () => {
    expect(generateIcsCalendar({ ...options, title: 'Title\rATTENDEE:evil' })).not.toContain('\rATTENDEE');
  });
  it('keeps a date-only export on the requested business day', async () => {
    const response = await GET(new NextRequest('https://pediturno.test/api/calendar/ics?date=2026-10-09&time=20:00'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('DTSTART:20261009T230000Z');
  });
});
