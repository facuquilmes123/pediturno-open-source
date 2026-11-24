import { describe, it, expect } from 'vitest';
import { getMembershipStatus } from '@/lib/membership-utils';
import { getMembershipPriceArs, getMembershipPriceLabel } from '@/lib/config';
import { BusinessProfile } from '@/services/data';
import { addDays, subDays } from 'date-fns';

describe('Membership Utils - 15-day Trial System', () => {
  const mockBaseProfile: BusinessProfile = {
    id: 'test-biz-id',
    name: 'Pediturno Test Salon',
    email: 'negocio@test.com',
    slug: 'test-salon',
    businessType: 'service_provider',
    address: { street: 'Av Santa Fe', number: '1234', city: 'CABA', province: 'Buenos Aires', postalCode: '1425', country: 'Argentina' },
    status: 'active',
    theme: 'menta',
    customTheme: { primary: '#000', background: '#fff', accent: '#000' },
    bookingSettings: { autoConfirm: true, bookingHorizonDays: 30, bookingLeadTimeHours: 2, appointmentBufferMinutes: 15 },
    createdAt: new Date(),
  };

  it('does not grant a plan based on an administrator email', () => {
    const status = getMembershipStatus(mockBaseProfile, 'admin@example.com');
    expect(status.status).toBe('Vencida');
    expect(status.daysLeft).toBe(0);
  });

  it('should return "En Prueba" with correct days remaining for an active 15-day trial', () => {
    const now = new Date();
    const profile: BusinessProfile = {
      ...mockBaseProfile,
      membership: {
        type: 'trial',
        startsAt: now,
        expiresAt: addDays(now, 14),
      },
    };

    const status = getMembershipStatus(profile, 'user@example.com');
    expect(status.status).toBe('En Prueba');
    expect(status.daysLeft).toBeGreaterThanOrEqual(13);
    expect(status.progress).toBeLessThan(100);
  });

  it('should return "Vencida" for a trial that exceeded 15 days', () => {
    const pastDate = subDays(new Date(), 16);
    const profile: BusinessProfile = {
      ...mockBaseProfile,
      membership: {
        type: 'trial',
        startsAt: pastDate,
        expiresAt: subDays(new Date(), 1), // expired yesterday
      },
    };

    const status = getMembershipStatus(profile, 'user@example.com');
    expect(status.status).toBe('Vencida');
    expect(status.daysLeft).toBe(0);
    expect(status.progress).toBe(100);
  });

  it('uses persisted lifetime and still denies blocked businesses', () => {
    const profile: BusinessProfile = { ...mockBaseProfile, membership: { type: 'lifetime' } };
    expect(getMembershipStatus(profile).status).toBe('De por vida');
    expect(getMembershipStatus({ ...profile, status: 'blocked' }).status).toBe('Vencida');
  });

  it('requires an explicit server-issued membership even for recent profiles', () => {
    const profileRecent: BusinessProfile = {
      ...mockBaseProfile,
      membership: undefined,
      createdAt: new Date(),
    };

    const statusRecent = getMembershipStatus(profileRecent, 'user@example.com');
    expect(statusRecent.status).toBe('Vencida');
    expect(statusRecent.daysLeft).toBeLessThanOrEqual(15);

    const profileOld: BusinessProfile = {
      ...mockBaseProfile,
      membership: undefined,
      createdAt: subDays(new Date(), 20),
    };

    const statusOld = getMembershipStatus(profileOld, 'user@example.com');
    expect(statusOld.status).toBe('Vencida');
    expect(statusOld.daysLeft).toBe(0);
  });
});

describe('membership prices by business vertical', () => {
  it('uses the services price for explicit and legacy service businesses', () => {
    expect(getMembershipPriceArs('services')).toBe(5000);
    expect(getMembershipPriceArs(undefined)).toBe(5000);
    expect(getMembershipPriceLabel('services')).toBe('USD 7');
  });

  it('uses the sports price for sports and hybrid businesses', () => {
    expect(getMembershipPriceArs('sports_facility')).toBe(10000);
    expect(getMembershipPriceArs('hybrid')).toBe(10000);
    expect(getMembershipPriceLabel('sports_facility')).toBe('$10.000');
  });

  it('fails closed at the sports price for an invalid persisted vertical', () => {
    expect(getMembershipPriceArs('forged-cheap-plan')).toBe(10000);
  });
});


describe('Servicios Gratis after legacy expiry', () => {
  it('does not block the web dashboard after the old Pro expires', () => {
    expect(getMembershipStatus({ status: 'active', businessType: 'services', membership: { type: 'pro', expiresAt: new Date('2020-01-01') } } as any).status).toBe('Gratis');
  });
});
