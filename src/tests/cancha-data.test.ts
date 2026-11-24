import { describe, expect, it } from 'vitest';
import { normalizeCanchaPrice, validateCanchaWrite, validateWorkingHours } from '@/lib/cancha-validation';

describe('cancha data validation', () => {
  it('normalizes valid ARS prices and rejects ambiguous or unsafe values', () => {
    expect(normalizeCanchaPrice(' 3500 ')).toBe('3500');
    expect(normalizeCanchaPrice('3500,50')).toBe('3500.5');
    expect(normalizeCanchaPrice('0')).toBeNull();
    expect(normalizeCanchaPrice('1e6')).toBeNull();
    expect(normalizeCanchaPrice('3500.999')).toBeNull();
  });

  it('accepts adjacent same-day availability ranges', () => {
    expect(validateWorkingHours({
      1: { slots: [{ start: '09:00', end: '13:00' }, { start: '13:00', end: '22:00' }] },
    }, true)).toBeNull();
  });

  it('rejects empty, overlapping, and midnight-crossing schedules before publication', () => {
    expect(validateWorkingHours({}, true)).toMatch(/al menos un día/i);
    expect(validateWorkingHours({
      2: { slots: [{ start: '09:00', end: '14:00' }, { start: '13:30', end: '20:00' }] },
    }, true)).toMatch(/superponerse/i);
    expect(validateWorkingHours({
      3: { slots: [{ start: '20:00', end: '02:00' }] },
    }, true)).toMatch(/medianoche/i);
  });

  it('accepts only the reviewed cancha write schema', () => {
    expect(validateCanchaWrite({
      name: 'Cancha Norte', price: '4200', duration: 60, status: 'Pausado', sport: 'padel',
    }, true).data).toMatchObject({ name: 'Cancha Norte', price: '4200', duration: 60, status: 'Pausado' });
    expect(validateCanchaWrite({ name: 'Cancha Norte', price: '4200', duration: 45, status: 'Pausado' }, true).error).toMatch(/duration/i);
    expect(validateCanchaWrite({ name: 'Cancha Norte', price: '4200', duration: 60, status: 'Pausado', businessId: 'forged' }, true).error).toMatch(/details/i);
  });
});
