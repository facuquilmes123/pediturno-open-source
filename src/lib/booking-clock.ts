import { BUSINESS_TIME_ZONE, dateKeyInZone } from './booking-constraints';

/** Date-only value for the browser calendar; never use it as a booking instant. */
export function calendarDayInZone(instant = new Date(), zone = BUSINESS_TIME_ZONE): Date {
  const [year, month, day] = dateKeyInZone(instant, zone).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function clockTimeInZone(instant = new Date(), zone = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);
}
