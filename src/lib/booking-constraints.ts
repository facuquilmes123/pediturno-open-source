import { getWeek } from 'date-fns';
export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export function bookingWeek(dateKey: string): number {
  return getWeek(new Date(`${dateKey}T12:00:00Z`), { weekStartsOn: 1 });
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Calendar arithmetic for date-only values, independent of host timezone. */
export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function minutes(value: string): number {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

export function overlaps(start: number, duration: number, otherStart: number, otherDuration: number, buffer = 0): boolean {
  return start < otherStart + otherDuration + buffer && otherStart < start + duration + buffer;
}

export function dateKeyInZone(value: Date, zone = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

export function localTimeToUtc(dateKey: string, time: string, zone = BUSINESS_TIME_ZONE): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const delta = desired - observed;
    candidate += delta;
    if (delta === 0) break;
  }
  const date = new Date(candidate);
  if (dateKeyInZone(date, zone) !== dateKey) throw new Error('Invalid local booking date');
  const finalParts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  if (Number(finalParts.hour) !== hour || Number(finalParts.minute) !== minute) {
    throw new Error('Invalid local booking time');
  }
  return date;
}
