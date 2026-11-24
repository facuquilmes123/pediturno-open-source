import { isSameMonth } from 'date-fns';
import type { Appointment, Cancha, Service } from '@/services/data';

export function parseStoredPrice(value: unknown): number {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^\$/, '')
    .replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

export function calculateMonthlyRevenue(
  appointments: Appointment[],
  services: Service[],
  canchas: Cancha[],
  month: Date = new Date(),
): number {
  return appointments
    .filter(appointment => appointment.status === 'Completado' && isSameMonth(new Date(appointment.date), month))
    .reduce((total, appointment) => {
      if (typeof appointment.priceAtBooking === 'number' && Number.isFinite(appointment.priceAtBooking) && appointment.priceAtBooking >= 0) {
        return total + appointment.priceAtBooking;
      }
      const resource = appointment.canchaId
        ? canchas.find(cancha => cancha.id === appointment.canchaId)
        : appointment.cancha
          ? canchas.find(cancha => cancha.name === appointment.cancha)
          : services.find(service => service.id === appointment.serviceId || service.name === appointment.service);
      return total + parseStoredPrice(resource?.price);
    }, 0);
}
