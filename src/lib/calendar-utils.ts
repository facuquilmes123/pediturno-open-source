import { addMinutes } from 'date-fns';
import { BUSINESS_TIME_ZONE, dateKeyInZone, localTimeToUtc } from '@/lib/booking-constraints';

export interface CalendarEventOptions {
    title: string;
    description: string;
    location?: string;
    startDate: Date;
    startTime: string; // "HH:mm" e.g. "14:30"
    durationMinutes?: number; // default 60
    timeZone?: string;
}

/**
 * Format a Date object into Google Calendar ISO format: YYYYMMDDTHHmmssZ
 */
function formatGoogleCalendarDate(date: Date): string {
    return date.toISOString().replace(/-|:|\.\d+/g, '');
}

/**
 * Combines a Date with an "HH:mm" time string into a single Date instance.
 */
export function getEventDates(startDate: Date, startTime: string, durationMinutes: number = 60, timeZone = BUSINESS_TIME_ZONE) {
    const start = localTimeToUtc(dateKeyInZone(startDate, timeZone), startTime, timeZone);
    const end = addMinutes(start, durationMinutes || 60);
    return { start, end };
}

/**
 * Generates a direct Google Calendar Web Link that pre-fills event details.
 */
export function generateGoogleCalendarUrl(options: CalendarEventOptions): string {
    const { start, end } = getEventDates(options.startDate, options.startTime, options.durationMinutes, options.timeZone);
    const startIso = formatGoogleCalendarDate(start);
    const endIso = formatGoogleCalendarDate(end);

    const baseUrl = 'https://calendar.google.com/calendar/render';
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: options.title,
        dates: `${startIso}/${endIso}`,
        details: options.description || '',
        location: options.location || '',
    });

    return `${baseUrl}?${params.toString()}`;
}

/**
 * Formats a Date into standard iCalendar DTSTART/DTEND (UTC): YYYYMMDDTHHMMSSZ
 */
function formatIcsDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generates an .ics file string for universal calendar import (Apple, Outlook, Android, Desktop).
 */
export function generateIcsCalendar(options: CalendarEventOptions): string {
    const { start, end } = getEventDates(options.startDate, options.startTime, options.durationMinutes, options.timeZone);
    const nowStr = formatIcsDate(new Date());
    const startStr = formatIcsDate(start);
    const endStr = formatIcsDate(end);

    const uid = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}@pediturno.com`;

    // Clean description and location to escape commas and semicolons according to RFC 5545
    const clean = (str: string) => (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Pediturno//Turnos Online//ES',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${nowStr}`,
        `DTSTART:${startStr}`,
        `DTEND:${endStr}`,
        `SUMMARY:${clean(options.title)}`,
        `DESCRIPTION:${clean(options.description)}`,
        `LOCATION:${clean(options.location || '')}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}
