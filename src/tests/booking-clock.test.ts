import { describe, expect, it } from 'vitest';
import { calendarDayInZone, clockTimeInZone } from '@/lib/booking-clock';
import { localTimeToUtc } from '@/lib/booking-constraints';

describe('booking clock in the business timezone', () => {
  it('keeps the Argentine day when UTC and Tokyo have already crossed midnight', () => {
    const instant = new Date('2026-10-11T01:30:00Z');
    const day = calendarDayInZone(instant);
    expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 10, 10]);
    expect(clockTimeInZone(instant)).toBe('22:30');
  });

  it('does not mistake a browser-local 08:30 slot for a future Argentine booking', () => {
    const now = new Date('2026-10-10T15:10:00Z');
    expect(localTimeToUtc('2026-10-10', '08:30').getTime()).toBeLessThan(now.getTime());
    expect(localTimeToUtc('2026-10-10', '12:30').getTime()).toBeGreaterThan(now.getTime());
  });

  it('maps occupied UTC intervals to the displayed local calendar without moving the day', () => {
    const occupiedEnd = new Date('2026-10-11T01:15:42.123Z');
    expect(calendarDayInZone(occupiedEnd).getDate()).toBe(10);
    expect(clockTimeInZone(occupiedEnd)).toBe('22:15');
  });

  it('respects an explicitly configured business timezone', () => {
    const instant = new Date('2026-10-10T23:30:00Z');
    expect(calendarDayInZone(instant, 'Asia/Tokyo').getDate()).toBe(11);
    expect(clockTimeInZone(instant, 'Asia/Tokyo')).toBe('08:30');
  });
});
