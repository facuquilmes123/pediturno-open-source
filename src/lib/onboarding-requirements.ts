import { validateReservableWorkingHours } from '@/lib/cancha-validation';

type ProfileForOnboarding = {
  name?: unknown;
  slug?: unknown;
} | null | undefined;

type ResourceForOnboarding = {
  status?: unknown;
  workingHours?: unknown;
  duration?: unknown;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function hasOnboardingProfileName(profile: ProfileForOnboarding): boolean {
  return typeof profile?.name === 'string' && profile.name.trim().length > 0;
}

export function hasOnboardingProfileSlug(profile: ProfileForOnboarding): boolean {
  return typeof profile?.slug === 'string'
    && profile.slug.length >= 3
    && profile.slug.length <= 50
    && SLUG_PATTERN.test(profile.slug);
}

export function getProfileOnboardingMissingRequirements(profile: ProfileForOnboarding): string[] {
  const missing: string[] = [];
  if (!hasOnboardingProfileName(profile)) missing.push('Indicá el nombre de tu negocio.');
  if (!hasOnboardingProfileSlug(profile)) missing.push('Elegí una URL válida de al menos 3 caracteres para tu página.');
  return missing;
}

export function hasValidResourceAvailability(resource: ResourceForOnboarding): boolean {
  return validateReservableWorkingHours(resource.workingHours, resource.duration) === null;
}

export function isBookableOnboardingResource(resource: ResourceForOnboarding): boolean {
  return resource.status === 'Activo' && hasValidResourceAvailability(resource);
}

export function getResourceOnboardingMissingRequirements(
  resources: ResourceForOnboarding[],
  resourceLabel: string,
): string[] {
  const article = resourceLabel === 'cancha' ? 'una' : 'un';
  const one = resourceLabel === 'cancha' ? 'una' : 'uno';
  if (resources.length === 0) return [`Creá al menos ${article} ${resourceLabel}.`];
  if (!resources.some(hasValidResourceAvailability)) {
    return [`Configurá al menos un día y un horario válido para ${one} de tus ${resourceLabel}s.`];
  }
  if (!resources.some(isBookableOnboardingResource)) {
    return [`Activá ${one} de tus ${resourceLabel}s que ya tenga horarios válidos para que pueda recibir reservas.`];
  }
  return [];
}
