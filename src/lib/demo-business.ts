import type { BusinessProfile, Service, Cancha, Space, WorkingHours } from '@/services/data';
import type { ProductVertical } from '@/lib/verticals';
import { BUSINESS_TIME_ZONE } from '@/lib/booking-constraints';

export function demoBusiness(vertical: ProductVertical) {
  const hours = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { slots: [{ start: '08:00', end: '22:00' }], isAlternating: false }])) as WorkingHours;
  const id = `demonstration-${vertical}`;
  const business: BusinessProfile = {
    id, email: '', name: vertical === 'sports_facility' ? 'Complejo Pádel Demo' : vertical === 'spaces' ? 'Espacio Demostración' : 'Barbería Demostración',
    slug: vertical === 'sports_facility' ? 'demo-canchas' : vertical === 'spaces' ? 'demo-espacios' : 'demo-servicios', businessType: vertical,
    timeZone: BUSINESS_TIME_ZONE,
    description: vertical === 'sports_facility'
      ? 'Tu próximo partido empieza acá. Pádel y fútbol 5, iluminación nocturna, vestuarios y un lugar para compartir el tercer tiempo.'
      : vertical === 'spaces'
        ? 'Un lugar para celebrar y crear recuerdos. Quincho con jardín y salón para eventos, encuentros y jornadas especiales.'
        : 'Tu estilo, nuestro oficio. Cortes, barba y asesoramiento personalizado en un espacio cálido. Elegí tu servicio y reservá tu momento.',
    logo: vertical === 'sports_facility' ? '/images/landing/canchas-disponibilidad-20261010.webp' : vertical === 'spaces' ? '/images/landing/espacios-fechas-20261010.webp' : '/images/landing/perfil-servicios-20261010.webp',
    address: { street: 'Avenida de Ejemplo', number: '123', city: 'General Belgrano', province: 'Buenos Aires', country: 'Argentina', postalCode: '7223' },
    theme: vertical === 'sports_facility' ? 'bosque' : vertical === 'spaces' ? 'lavanda' : 'noche',
    whatsappButtonEnabled: true, whatsappNumber: '0000000000',
    socialLinks: [
      { id: 'demo-instagram', type: 'instagram', url: 'https://example.invalid/instagram' },
      { id: 'demo-website', type: 'website', url: 'https://example.invalid' },
    ],
    bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 0, bookingHorizonDays: 30, appointmentBufferMinutes: 0 },
  };
  const common = { businessId: id, status: 'Activo' as const, workingHours: hours, unavailableDates: [] };
  const services: Service[] = vertical === 'services' ? [
    { ...common, id: 'demo-corte', name: 'Corte de cabello', duration: '30', price: '10000', photo: '/images/landing/servicios-agenda-20261010.webp' },
    { ...common, id: 'demo-barba', name: 'Corte y barba', duration: '60', price: '15000', photo: '/images/landing/perfil-servicios-20261010.webp' },
    { ...common, id: 'demo-estilo', name: 'Asesoramiento de estilo', duration: '45', price: '12000', photo: '/images/landing/servicios-enlace-20261010.webp' },
  ] : [];
  const canchas: Cancha[] = vertical === 'sports_facility' ? [
    { ...common, id: 'demo-padel', name: 'Cancha de pádel 1', sport: 'padel', duration: 60, price: '20000', photo: '/images/landing/canchas-disponibilidad-20261010.webp' },
    { ...common, id: 'demo-futbol', name: 'Cancha de fútbol 5', sport: 'futbol', duration: 60, price: '30000', photo: '/images/landing/canchas-reserva-20261010.webp' },
  ] : [];
  const spaces: Space[] = vertical === 'spaces' ? [
    { ...common, id: 'demo-quincho', name: 'Quincho de ejemplo', category: 'quincho', description: 'Jardín, parrilla, mesas y cocina equipada para disfrutar con tus invitados.', capacity: 30, photo: '/images/landing/espacios-reserva-20261010.webp', packages: [{ durationMinutes: 240, price: '80000' }, { durationMinutes: 480, price: '140000' }], preparationMinutes: 0, cleanupMinutes: 0 },
    { ...common, id: 'demo-salon', name: 'Salón de celebraciones', category: 'salon', description: 'Salón climatizado, iluminación cálida y mesas para cumpleaños, reuniones y eventos.', capacity: 80, photo: '/images/landing/espacios-fechas-20261010.webp', packages: [{ durationMinutes: 240, price: '120000' }, { durationMinutes: 480, price: '200000' }], preparationMinutes: 0, cleanupMinutes: 0 },
  ] : [];
  return { business, services, canchas, spaces };
}
