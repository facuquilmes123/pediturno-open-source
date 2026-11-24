import { getEffectiveMembership, isServicesBusiness } from '@/lib/membership-entitlement';

/** Server-side entitlement check for paid/Pro business rights. */
export function hasActiveBusinessMembership(business: unknown, nowMillis = Date.now()): boolean {
  if (!business || typeof business !== 'object') return false;
  const record = business as Record<string, unknown>;
  if (record.status !== 'active') return false;
  return getEffectiveMembership(record, nowMillis) !== null;
}

/**
 * Checks whether a business is operational for standard day-to-day management.
 * Servicios operates permanently under the Gratis plan (with a 40-appointment monthly quota).
 * Non-services verticals (sports/spaces) require an active paid or trial membership.
 */
export function isBusinessOperational(business: unknown, nowMillis = Date.now()): boolean {
  if (!business || typeof business !== 'object') return false;
  const record = business as Record<string, unknown>;
  if (record.status !== 'active') return false;
  if (isServicesBusiness(record)) return true;
  return hasActiveBusinessMembership(record, nowMillis);
}
