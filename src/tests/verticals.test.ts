import { describe, expect, it } from 'vitest';
import { getVerticalFromHost, getBusinessBookingUrl } from '@/lib/verticals';

describe('product origins', () => {
  it('only recognizes the exact sports host', () => {
    expect(getVerticalFromHost('CANCHAS.PEDITURNO.COM:443')).toBe('sports_facility');
    expect(getVerticalFromHost('canchas.pediturno.com.attacker.test')).toBe('services');
  });
  it('recognizes only the exact spaces host', () => {
    expect(getVerticalFromHost('ESPACIOS.PEDITURNO.COM:443')).toBe('spaces');
    expect(getVerticalFromHost('espacios.pediturno.com.attacker.test')).toBe('services');
  });
  it('builds links from fixed origins rather than arbitrary input', () => {
    expect(getBusinessBookingUrl('sports_facility', 'club')).toBe('https://canchas.pediturno.com/club');
    expect(getBusinessBookingUrl('spaces', 'salon')).toBe('https://espacios.pediturno.com/salon');
    expect(getBusinessBookingUrl(undefined, 'local')).toBe('https://pediturno.com/local');
  });
});
