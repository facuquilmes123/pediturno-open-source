import { describe, expect, it } from 'vitest';
import { bookingWeek, dateKeyInZone, isDateKey, isTime, localTimeToUtc, overlaps } from '@/lib/booking-constraints';

describe('restricciones de reserva', () => {
  it('uses the same Monday-based alternating weeks as the booking calendar', () => {
    expect(bookingWeek('2026-01-01')).toBe(1);
    expect(bookingWeek('2026-01-05')).toBe(2);
    expect(bookingWeek('2026-01-11')).toBe(2);
    expect(bookingWeek('2026-01-12')).toBe(3);
  });
  it('rechaza fechas y horarios inexistentes', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-12-31')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('23:59')).toBe(true);
  });

  it('convierte la fecha del negocio sin depender de la zona horaria del navegador', () => {
    const instant = localTimeToUtc('2026-12-31', '23:30');
    expect(instant.toISOString()).toBe('2027-01-01T02:30:00.000Z');
    expect(dateKeyInZone(instant)).toBe('2026-12-31');
  });

  it('bloquea solapamientos y permite slots adyacentes y recursos separados', () => {
    expect(overlaps(10 * 60, 60, 10 * 60 + 30, 60)).toBe(true);
    expect(overlaps(10 * 60, 60, 11 * 60, 60)).toBe(false);
    expect(overlaps(10 * 60, 60, 11 * 60, 60, 15)).toBe(true);
  });
});
