import { describe, expect, it } from 'vitest';
import { hasActiveBusinessMembership } from '@/lib/server-membership';

describe('server membership entitlement', () => {
  const now = Date.UTC(2026, 9, 4);
  const playFields = { type: 'pro', source: 'GOOGLE_PLAY', productId: 'pediturno_servicios_pro_monthly', purchaseHash: 'a'.repeat(64) };

  it('allows lifetime and unexpired paid or trial memberships', () => {
    expect(hasActiveBusinessMembership({ status: 'active', membership: { type: 'lifetime' } }, now)).toBe(true);
    expect(hasActiveBusinessMembership({ status: 'active', membership: { type: 'pro', expiresAt: { toMillis: () => now + 1 } } }, now)).toBe(true);
    expect(hasActiveBusinessMembership({ status: 'active', membership: { type: 'trial', expiresAt: new Date(now + 1) } }, now)).toBe(true);
  });

  it('fails closed for expired, blocked, missing, or unknown memberships', () => {
    expect(hasActiveBusinessMembership({ status: 'active', membership: { type: 'pro', expiresAt: { toMillis: () => now } } }, now)).toBe(false);
    expect(hasActiveBusinessMembership({ status: 'blocked', membership: { type: 'lifetime' } }, now)).toBe(false);
    expect(hasActiveBusinessMembership({ status: 'active' }, now)).toBe(false);
    expect(hasActiveBusinessMembership({ status: 'active', membership: { type: 'free' } }, now)).toBe(false);
  });

  it('shares verified Play rights with web and preserves independent prepaid legacy rights', () => {
    const business = { status: 'active', membership: { type: 'pro', expiresAt: new Date(now + 100) },
      googlePlayMembership: { ...playFields, status: 'active', expiresAt: new Date(now + 200) } };
    expect(hasActiveBusinessMembership(business, now + 150)).toBe(true);
    expect(hasActiveBusinessMembership({ ...business, googlePlayMembership: { ...business.googlePlayMembership, status: 'revoked' } }, now + 50)).toBe(true);
    expect(hasActiveBusinessMembership({ ...business, googlePlayMembership: { ...business.googlePlayMembership, status: 'revoked' } }, now + 150)).toBe(false);
  });

  it.each(['active', 'grace_period'])('honors %s only until verified expiry', status => {
    const business = { status: 'active', googlePlayMembership: { ...playFields, status, expiresAt: new Date(now + 1) } };
    expect(hasActiveBusinessMembership(business, now)).toBe(true);
    expect(hasActiveBusinessMembership(business, now + 1)).toBe(false);
  });

  it.each(['pending', 'on_hold', 'paused', 'expired', 'revoked', 'forged'])('does not grant %s Play rights', status => {
    expect(hasActiveBusinessMembership({ status: 'active', googlePlayMembership: { ...playFields, status, expiresAt: new Date(now + 100) } }, now)).toBe(false);
  });
  it.each(['spaces', 'sports_facility', 'hybrid'])('does not grant Services Play rights to %s', businessType => {
    expect(hasActiveBusinessMembership({ status: 'active', businessType, googlePlayMembership: { ...playFields, status: 'active', expiresAt: new Date(now + 100) } }, now)).toBe(false);
  });
  it('requires a verified product, source and purchase binding', () => {
    for (const patch of [{ source: 'client' }, { productId: 'other_product' }, { purchaseHash: '' }]) {
      expect(hasActiveBusinessMembership({ status: 'active', googlePlayMembership: { ...playFields, ...patch, status: 'active', expiresAt: new Date(now + 100) } }, now)).toBe(false);
    }
  });
});
