import { describe, expect, it } from 'vitest';
import {
  getProfileOnboardingMissingRequirements,
  getResourceOnboardingMissingRequirements,
  isBookableOnboardingResource,
} from '@/lib/onboarding-requirements';

describe('onboarding requirements', () => {
  it('does not complete a step when no full appointment fits in the hours', () => {
    expect(isBookableOnboardingResource({
      status: 'Activo', duration: 60,
      workingHours: { 1: { slots: [{ start: '09:00', end: '09:30' }] } },
    })).toBe(false);
    expect(isBookableOnboardingResource({
      status: 'Activo', duration: 30,
      workingHours: { 1: { slots: [{ start: '09:00', end: '09:30' }] } },
    })).toBe(true);
  });
  it('requires a non-empty name and a valid public URL', () => {
    expect(getProfileOnboardingMissingRequirements({ name: ' ', slug: 'x' })).toEqual([
      'Indicá el nombre de tu negocio.',
      'Elegí una URL válida de al menos 3 caracteres para tu página.',
    ]);
    expect(getProfileOnboardingMissingRequirements({ name: 'Club Norte', slug: 'club-norte' })).toEqual([]);
  });

  it('does not mark an inactive or malformed resource as ready for reservations', () => {
    const validHours = { 1: { slots: [{ start: '09:00', end: '18:00' }] } };
    expect(isBookableOnboardingResource({ duration: 30, status: 'Pausado', workingHours: validHours })).toBe(false);
    expect(isBookableOnboardingResource({ duration: 30, status: 'Activo', workingHours: { 1: { slots: [] } } })).toBe(false);
    expect(isBookableOnboardingResource({ duration: 30, status: 'Activo', workingHours: validHours })).toBe(true);
  });

  it('explains whether a resource, hours, or activation is still missing', () => {
    expect(getResourceOnboardingMissingRequirements([], 'servicio')).toEqual(['Creá al menos un servicio.']);
    expect(getResourceOnboardingMissingRequirements([{ duration: 30, status: 'Pausado', workingHours: {} }], 'servicio')[0]).toMatch(/horario válido/i);
    expect(getResourceOnboardingMissingRequirements([{ duration: 30, status: 'Pausado', workingHours: { 1: { slots: [{ start: '09:00', end: '18:00' }] } } }], 'servicio')[0]).toMatch(/Activá/i);
  });
});
