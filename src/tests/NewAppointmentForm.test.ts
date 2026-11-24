import { describe, expect, it } from 'vitest';
import { isCanchaSlotAvailable, isSpaceSlotAvailable } from '@/components/NewAppointmentForm';
import type { Appointment, Cancha, Space } from '@/services/data';

const canchas: Cancha[] = [
  { id: 'court-a', name: 'Cancha A', duration: 90, price: '12000', status: 'Activo', businessId: 'owner-1' },
  { id: 'court-b', name: 'Cancha B', duration: 60, price: '9000', status: 'Activo', businessId: 'owner-1' },
];

function appointment(patch: Partial<Appointment>): Appointment {
  return {
    id: 'appointment-1',
    client: 'Cliente',
    clientPhone: '+5491112345678',
    avatar: '',
    date: new Date(2026, 9, 5),
    time: '10:00',
    status: 'Confirmado',
    businessId: 'owner-1',
    ...patch,
  };
}

describe('isCanchaSlotAvailable', () => {
  it('uses the real court duration and blocks overlap on the same court', () => {
    const result = isCanchaSlotAvailable({
      canchaId: 'court-a',
      date: new Date(2026, 9, 5),
      time: '11:00',
      canchas,
      appointments: [appointment({ canchaId: 'court-a', durationMinutes: 90 })],
    });

    expect(result).toBe(false);
  });

  it('allows the same time on a different court', () => {
    const result = isCanchaSlotAvailable({
      canchaId: 'court-b',
      date: new Date(2026, 9, 5),
      time: '10:00',
      canchas,
      appointments: [appointment({ canchaId: 'court-a', durationMinutes: 90 })],
    });

    expect(result).toBe(true);
  });

  it('supports legacy court appointments by court name', () => {
    const result = isCanchaSlotAvailable({
      canchaId: 'court-a',
      date: new Date(2026, 9, 5),
      time: '10:30',
      canchas,
      appointments: [appointment({ cancha: 'Cancha A', canchaId: undefined, durationMinutes: 60 })],
    });

    expect(result).toBe(false);
  });
});

describe('isSpaceSlotAvailable', () => {
  const spaces: Space[] = [{ id: 'space-a', businessId: 'owner-1', name: 'Salón A', category: 'salon', packages: [{ durationMinutes: 240, price: '80000' }], preparationMinutes: 60, cleanupMinutes: 60, bookingBufferMinutes: 30, status: 'Activo' }];

  it('blocks a new event when preparation overlaps an existing protected interval', () => {
    expect(isSpaceSlotAvailable({
      spaceId: 'space-a', durationMinutes: 240, date: new Date(2026, 9, 5), time: '14:00', spaces,
      appointments: [appointment({ spaceId: 'space-a', space: 'Salón A', time: '10:00', durationMinutes: 240, preparationMinutes: 60, cleanupMinutes: 60, bookingBufferMinutes: 30 })],
    })).toBe(false);
  });

  it('allows the same time in another space', () => {
    expect(isSpaceSlotAvailable({
      spaceId: 'space-a', durationMinutes: 240, date: new Date(2026, 9, 5), time: '10:00', spaces,
      appointments: [appointment({ spaceId: 'space-b', space: 'Salón B', time: '10:00', durationMinutes: 240 })],
    })).toBe(true);
  });
});
