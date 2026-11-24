import { describe, expect, it } from 'vitest';
import { calculateMonthlyRevenue, parseStoredPrice } from '@/lib/dashboard-stats';
import type { Appointment, Cancha, Service } from '@/services/data';

const service: Service = {
  id: 'service-1',
  name: 'Consulta',
  duration: '60',
  price: '1500.50',
  status: 'Activo',
  businessId: 'owner-1',
};

const cancha: Cancha = {
  id: 'court-1',
  name: 'Cancha Central',
  duration: 90,
  price: '2750,25',
  status: 'Activo',
  businessId: 'owner-1',
};

function appointment(patch: Partial<Appointment>): Appointment {
  return {
    id: 'appointment-1',
    client: 'Cliente',
    clientPhone: '+5491112345678',
    avatar: '',
    date: new Date(2026, 9, 5),
    time: '10:00',
    status: 'Completado',
    businessId: 'owner-1',
    ...patch,
  };
}

describe('dashboard revenue', () => {
  it('parses decimal prices without multiplying cents', () => {
    expect(parseStoredPrice('1500.50')).toBe(1500.5);
    expect(parseStoredPrice('2750,25')).toBe(2750.25);
    expect(parseStoredPrice('precio inválido')).toBe(0);
  });

  it('sums completed services and courts for the selected month', () => {
    const total = calculateMonthlyRevenue(
      [
        appointment({ id: 'service-appt', serviceId: service.id, service: service.name }),
        appointment({ id: 'court-appt', canchaId: cancha.id, cancha: cancha.name }),
        appointment({ id: 'pending', serviceId: service.id, status: 'Pendiente' }),
        appointment({ id: 'other-month', canchaId: cancha.id, date: new Date(2026, 10, 5) }),
      ],
      [service],
      [cancha],
      new Date(2026, 9, 15),
    );

    expect(total).toBe(4250.75);
  });

  it('keeps completed revenue stable when the resource price changes or is deleted', () => {
    const month = new Date(2026, 9, 15);
    const bookedService = appointment({ serviceId: service.id, service: service.name, priceAtBooking: 1500.5 });
    const bookedCourt = appointment({ canchaId: cancha.id, cancha: cancha.name, priceAtBooking: 2750.25 });

    expect(calculateMonthlyRevenue([bookedService], [{ ...service, price: '9999' }], [], month)).toBe(1500.5);
    expect(calculateMonthlyRevenue([bookedCourt], [], [], month)).toBe(2750.25);
  });
});
