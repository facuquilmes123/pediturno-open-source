import { describe, expect, it } from 'vitest';
import { bookingRateLimits, sameBookingConfiguration } from '@/lib/booking-rate-limit';

describe('booking protection', () => {
  it('normalizes identities without retaining contact details and isolates businesses', () => {
    const old = process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
    process.env.BOOKING_CAPABILITY_OUTBOX_KEY = 'test-only';
    try {
      const now = new Date('2026-10-04T12:00:00Z');
      const first = bookingRateLimits('a', ' CLIENT@example.test ', '+54 (11) 1234', now);
      expect(first).toEqual(bookingRateLimits('a', 'client@example.test', '54111234', now));
      expect(first[0].id).not.toBe(bookingRateLimits('b', 'client@example.test', '54111234', now)[0].id);
      expect(JSON.stringify(first)).not.toContain('client');
      expect(first[0].window).not.toBe(bookingRateLimits('a', 'client@example.test', '54111234', new Date('2026-10-05T12:00:00Z'))[0].window);
    } finally {
      if (old === undefined) delete process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
      else process.env.BOOKING_CAPABILITY_OUTBOX_KEY = old;
    }
  });
  it('rejects booking settings changed between validation and commit', () => {
    expect(sameBookingConfiguration({ duration: 60 }, { duration: 90 })).toBe(false);
    expect(sameBookingConfiguration({ bookingSettings: { autoConfirm: true } }, { bookingSettings: { autoConfirm: false } })).toBe(false);
    expect(sameBookingConfiguration({ name: 'Court', photo: 'a' }, { name: 'Court', photo: 'b' })).toBe(true);
  });
});
