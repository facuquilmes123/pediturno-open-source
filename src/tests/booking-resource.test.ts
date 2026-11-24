import { describe, expect, it } from 'vitest';
import { sameAppointmentResource } from '@/lib/booking-resource';

describe('booking resource compatibility', () => {
  it('treats a legacy cancha-name appointment as the same cancha', () => {
    expect(sameAppointmentResource({ cancha: 'Cancha Central' }, 'cancha_1', 'Cancha Central')).toBe(true);
    expect(sameAppointmentResource({ cancha: 'Cancha Norte' }, 'cancha_1', 'Cancha Central')).toBe(false);
  });

  it('does not classify a legacy cancha as a service appointment', () => {
    expect(sameAppointmentResource({ cancha: 'Cancha Central' })).toBe(false);
    expect(sameAppointmentResource({ service: 'Corte' } as never)).toBe(true);
  });
});
