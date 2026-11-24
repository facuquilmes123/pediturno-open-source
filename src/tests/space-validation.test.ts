import { describe, expect, it } from 'vitest';
import { bookingSlotIds } from '@/lib/booking-slots';
import { findSpaceBookingWindow, spaceTimeFitsWorkingHours } from '@/lib/space-availability';
import { validateReservableSpaceWorkingHours, validateSpaceWrite } from '@/lib/space-validation';
import { validateCanchaWrite } from '@/lib/cancha-validation';
import { validateServiceWrite } from '@/lib/service-validation';

const packages = [
  { durationMinutes: 240, price: '50000' },
  { durationMinutes: 480, price: '85000' },
  { durationMinutes: 720, price: '120000' },
  { durationMinutes: 1440, price: '200000' },
];

describe('Espacios validation and occupancy', () => {
  it('accepts only unique 4/8/12/24-hour packages with normalized Argentine prices', () => {
    const valid = validateSpaceWrite({ name: 'Salón Norte', category: 'salon', packages: [{ durationMinutes: 240, price: '$ 50.000' }], preparationMinutes: 60, cleanupMinutes: 90, status: 'Pausado' }, true);
    expect(valid.data).toMatchObject({ packages: [{ durationMinutes: 240, price: '50000' }], preparationMinutes: 60, cleanupMinutes: 90 });
    expect(validateSpaceWrite({ name: 'Salón Norte', category: 'salon', packages: [{ durationMinutes: 240, price: '50000' }, { durationMinutes: 240, price: '60000' }], preparationMinutes: 0, cleanupMinutes: 0, status: 'Pausado' }, true).error).toBe('Invalid space packages');
  });

  it('supports overnight and full-day schedules while rejecting ambiguous multi-range schedules', () => {
    const overnight = { 5: { slots: [{ start: '18:00', end: '02:00' }] } };
    expect(spaceTimeFitsWorkingHours(overnight, 5, '18:00', 480)).toBe(true);
    expect(spaceTimeFitsWorkingHours(overnight, 5, '22:00', 480)).toBe(false);
    expect(spaceTimeFitsWorkingHours({ 1: { slots: [{ start: '00:00', end: '00:00' }] } }, 1, '00:00', 1440)).toBe(true);
    expect(validateSpaceWrite({ workingHours: { 1: { slots: [{ start: '18:00', end: '18:00' }] } } }, false).error).toContain('00:00');
    expect(validateReservableSpaceWorkingHours({ 1: { slots: [{ start: '00:00', end: '00:00' }] } }, packages)).toBeNull();
    expect(validateSpaceWrite({ workingHours: { 1: { slots: [{ start: '00:00', end: '00:00' }, { start: '12:00', end: '13:00' }] } } }, false).error).toContain('único rango');
  });

  it('uses the real next-day date for an overnight continuation', () => {
    const weekly = { 1: { slots: [{ start: '18:00', end: '06:00' }] } }; // Monday evening to Tuesday morning
    const tuesdayWindow = findSpaceBookingWindow(weekly, 2, '02:00', 240);
    expect(tuesdayWindow).toMatchObject({ sourceWeekday: 1, sourceDayOffset: -1 });
    expect(spaceTimeFitsWorkingHours(weekly, 2, '02:00', 240)).toBe(true);
    // Tuesday's own evening window must not accidentally authorize Tuesday 02:00.
    expect(spaceTimeFitsWorkingHours({ 2: { slots: [{ start: '18:00', end: '06:00' }] } }, 2, '02:00', 240)).toBe(false);
  });

  it('locks a full-day booking with setup and cleanup across calendar days within a safe transaction size', () => {
    const slots = bookingSlotIds('business', 'space_salon', new Date('2026-10-10T03:00:00.000Z'), 1440, 480, 240, 10);
    expect(slots.length).toBe(216);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.length * 2 + 8).toBeLessThan(500); // disjoint reschedule + metadata
  });

  it('keeps valid buffered reservations adjacent at ten-minute precision', () => {
    const first = new Set(bookingSlotIds('business', 'space_salon', new Date('2026-10-10T13:00:00.000Z'), 240, 10, 0, 10));
    const second = bookingSlotIds('business', 'space_salon', new Date('2026-10-10T17:10:00.000Z'), 240, 0, 0, 10);
    expect(second.some(slot => first.has(slot))).toBe(false);
  });

  it('validates resource-specific booking buffer overrides for every vertical', () => {
    expect(validateCanchaWrite({ bookingBufferMinutes: 30 }, false).data?.bookingBufferMinutes).toBe(30);
    expect(validateServiceWrite({ bookingBufferMinutes: null }, false).data?.bookingBufferMinutes).toBeNull();
    expect(validateSpaceWrite({ bookingBufferMinutes: 241 }, false).error).toBe('Invalid booking buffer');
    expect(validateSpaceWrite({ bookingBufferMinutes: 15 }, false).error).toBe('Invalid booking buffer');
    expect(validateSpaceWrite({ preparationMinutes: 15 }, false).error).toBe('Invalid space preparationMinutes');
  });
});
