import { describe, expect, it } from 'vitest';
import { normalizeSlug, publicProjection, safeProfileUpdate, validBookingSettingsInput } from '@/lib/business-profile';

describe('business profile server boundary', () => {
  it('rejects invalid booking settings rather than reporting an unsaved setting as successful', () => {
    expect(validBookingSettingsInput({ bookingHorizonDays: 0 })).toBe(false);
    expect(validBookingSettingsInput({ bookingHorizonDays: 366 })).toBe(false);
    expect(validBookingSettingsInput({ appointmentBufferMinutes: 241 })).toBe(false);
    expect(validBookingSettingsInput({ bookingLeadTimeHours: -1 })).toBe(false);
    expect(validBookingSettingsInput({ bookingHorizonDays: 365, appointmentBufferMinutes: 0 })).toBe(true);
  });
  it('rejects ambiguous slugs and normalizes only the public URL format', () => {
    expect(normalizeSlug('Cancha-Norte')).toBe('cancha-norte');
    expect(normalizeSlug('ab')).toBeNull();
    expect(normalizeSlug('cancha/norte')).toBeNull();
    expect(normalizeSlug('cancha--norte')).toBeNull();
  });

  it('drops client supplied ownership, status and lifetime membership fields', () => {
    const saved = safeProfileUpdate({
      name: 'Club Norte',
      email: 'attacker@example.com',
      id: 'another-tenant',
      status: 'active',
      membership: { type: 'lifetime' },
      mercadopago: { accessToken: 'forged' },
      createdAt: 'forged',
    });
    expect(saved).toEqual({ name: 'Club Norte' });
  });

  it('creates a public projection without private email, membership or payment data', () => {
    const view = publicProjection('owner-1', {
      slug: 'club-norte', name: 'Club Norte', email: 'private@example.com',
      membership: { type: 'lifetime' }, mercadopago: { accessToken: 'secret' },
    });
    expect(view).toMatchObject({ businessId: 'owner-1', slug: 'club-norte', name: 'Club Norte' });
    expect(view).not.toHaveProperty('email');
    expect(view).not.toHaveProperty('membership');
    expect(view).not.toHaveProperty('mercadopago');
  });

  it('projects only public booking rules and keeps the Spaces buffer default', () => {
    const view = publicProjection('owner-1', {
      businessType: 'spaces',
      bookingSettings: {
        autoConfirm: false,
        bookingHorizonDays: 90,
        bookingLeadTimeHours: 6,
        appointmentBufferMinutes: 40,
        notificationEmail: 'private@example.com',
        newAppointmentNotificationsEnabled: true,
        remindersEnabled: true,
        unexpectedPrivateFlag: 'do-not-publish',
      },
    });
    expect(view.bookingSettings).toEqual({ autoConfirm: false, bookingHorizonDays: 90, bookingLeadTimeHours: 6, appointmentBufferMinutes: 40 });
    expect(view.bookingSettings).not.toHaveProperty('notificationEmail');
    expect(view.bookingSettings).not.toHaveProperty('newAppointmentNotificationsEnabled');
    expect(view.bookingSettings).not.toHaveProperty('remindersEnabled');
    expect(view.bookingSettings).not.toHaveProperty('unexpectedPrivateFlag');
    expect(publicProjection('owner-2', { businessType: 'spaces' }).bookingSettings.appointmentBufferMinutes).toBe(20);
  });

  it('rejects embedded image payloads that cannot be saved safely', () => {
    expect(safeProfileUpdate({ logo: `data:image/webp;base64,${'A'.repeat(2048)}` })).not.toHaveProperty('logo');
    expect(safeProfileUpdate({ logo: 'javascript:alert(1)' })).not.toHaveProperty('logo');
    expect(safeProfileUpdate({ logo: 'https://example.test/logo.webp' })).toHaveProperty('logo');
  });
});
