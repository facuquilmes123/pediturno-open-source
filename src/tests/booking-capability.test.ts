import { describe, expect, it } from 'vitest';
import { createBookingCapability, decryptCapabilityToken, encryptCapabilityToken, hashBookingCapability, isBookingCapabilityUsable, isValidBookingCapabilityToken } from '@/lib/booking-capability';

describe('booking capabilities', () => {
  it('stores only a deterministic hash and creates a valid opaque token', () => {
    const created = createBookingCapability({ appointmentId: 'appointment_1', businessId: 'business_1', now: new Date('2026-09-24T12:00:00Z') });
    expect(isValidBookingCapabilityToken(created.token)).toBe(true);
    expect(created.tokenHash).toBe(hashBookingCapability(created.token));
    expect(created.tokenHash).not.toContain(created.token);
    expect(created.capability).not.toHaveProperty('token');
  });

  it('accepts only an unused, unexpired appointment-change capability', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const created = createBookingCapability({ appointmentId: 'appointment_1', businessId: 'business_1', now, ttlMs: 1000 });
    expect(isBookingCapabilityUsable(created.capability, now)).toBe(true);
    expect(isBookingCapabilityUsable({ ...created.capability, usedAt: new Date() }, now)).toBe(false);
    expect(isBookingCapabilityUsable(created.capability, new Date(now.getTime() + 1000))).toBe(false);
  });

  it('rejects identifiers and tokens outside the strict format', () => {
    expect(isValidBookingCapabilityToken('appointment-id')).toBe(false);
    expect(() => hashBookingCapability('bad')).toThrow('Invalid capability token');
    expect(() => createBookingCapability({ appointmentId: 'bad id', businessId: 'business_1' })).toThrow('Invalid capability subject');
  });

  it('encrypts a delivery-outbox token and rejects a changed ciphertext', () => {
    const created = createBookingCapability({ appointmentId: 'appointment_1', businessId: 'business_1' });
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptCapabilityToken(created.token, key);
    expect(encrypted.ciphertext).not.toContain(created.token);
    expect(decryptCapabilityToken(encrypted, key)).toBe(created.token);
    expect(() => decryptCapabilityToken({ ...encrypted, tag: Buffer.alloc(16, 8).toString('base64url') }, key)).toThrow('Invalid encrypted capability token');
    expect(() => encryptCapabilityToken(created.token, undefined)).toThrow('Booking capability outbox key is not configured');
  });
});
