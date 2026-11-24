import { isTime, minutes } from '@/lib/booking-constraints';
import type { WorkingHoursInput } from '@/lib/cancha-validation';

/** Returns the length of a daily range. An end earlier than its start crosses midnight. */
export function spaceSlotLength(slot: { start: string; end: string }): number | null {
  if (!isTime(slot.start) || !isTime(slot.end)) return null;
  const start = minutes(slot.start);
  const end = minutes(slot.end);
  // Only midnight-to-midnight has an unambiguous full-day meaning. A range
  // such as 18:00→18:00 would otherwise disagree with the next-day parser.
  if (start === end) return start === 0 ? 1440 : null;
  return end > start ? end - start : 1440 - start + end;
}

export type SpaceBookingWindow = {
  sourceWeekday: number;
  sourceDayOffset: 0 | -1;
  isAlternating: boolean;
};

/**
 * Finds the schedule window that owns a real calendar date/time. A Tuesday
 * 02:00 booking in a Monday 18:00→06:00 window is therefore owned by Monday,
 * never interpreted as a Tuesday booking that ends on Wednesday.
 */
export function findSpaceBookingWindow(
  workingHours: unknown,
  weekday: number,
  time: string,
  durationMinutes: number,
): SpaceBookingWindow | null {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || !isTime(time)) return null;
  const hours = workingHours as WorkingHoursInput | undefined;
  const currentMinute = minutes(time);
  const current = hours?.[weekday];
  for (const slot of current?.slots || []) {
    const length = spaceSlotLength(slot);
    if (length === null) continue;
    const opening = minutes(slot.start);
    // A window configured today starts today. Do not reinterpret an early
    // morning value as the following morning of today's evening window.
    if (currentMinute >= opening && currentMinute - opening + durationMinutes <= length) {
      return { sourceWeekday: weekday, sourceDayOffset: 0, isAlternating: current?.isAlternating === true };
    }
  }
  const previousWeekday = (weekday + 6) % 7;
  const previous = hours?.[previousWeekday];
  for (const slot of previous?.slots || []) {
    const opening = minutes(slot.start);
    const closing = minutes(slot.end);
    const length = spaceSlotLength(slot);
    // Only a genuinely overnight range continues into today. Equal endpoints
    // mean one full day and end exactly at today's midnight.
    if (length === null || closing >= opening || currentMinute >= closing) continue;
    const relative = 1440 - opening + currentMinute;
    if (relative + durationMinutes <= length) {
      return { sourceWeekday: previousWeekday, sourceDayOffset: -1, isAlternating: previous?.isAlternating === true };
    }
  }
  return null;
}

/**
 * A space can be open across midnight. `18:00` to `02:00` is one continuous
 * eight-hour interval which starts on the configured weekday.
 */
export function spaceTimeFitsWorkingHours(
  workingHours: unknown,
  weekday: number,
  time: string,
  durationMinutes: number,
): boolean {
  return findSpaceBookingWindow(workingHours, weekday, time, durationMinutes) !== null;
}

export function hasReservableSpaceWorkingHours(workingHours: unknown, durations: readonly number[]): boolean {
  if (!workingHours || typeof workingHours !== 'object' || Array.isArray(workingHours)) return false;
  const required = Math.max(...durations);
  if (!Number.isInteger(required) || required <= 0) return false;
  return Object.values(workingHours as WorkingHoursInput).some(day =>
    Array.isArray(day?.slots) && day.slots.some(slot => (spaceSlotLength(slot) ?? 0) >= required),
  );
}

export function occupiedInterval(start: Date, durationMinutes: number, preparationMinutes = 0, postMinutes = 0) {
  return {
    start: new Date(start.getTime() - preparationMinutes * 60_000),
    end: new Date(start.getTime() + (durationMinutes + postMinutes) * 60_000),
  };
}

export function intervalsOverlap(
  first: { start: Date; end: Date },
  second: { start: Date; end: Date },
): boolean {
  return first.start.getTime() < second.end.getTime() && second.start.getTime() < first.end.getTime();
}
