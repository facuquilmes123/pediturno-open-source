import { describe, expect, it } from 'vitest';
import { createBookingCapability } from '@/lib/booking-capability';
import { createBookingConfirmationOutbox, isDeliverableOutbox } from '@/lib/booking-outbox';

describe('booking confirmation outbox', () => {
  it('encrypts the bearer token and does not persist it in the delivery record', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    const capability = createBookingCapability({ appointmentId: 'appointment_1', businessId: 'business_1', now });
    const key = Buffer.alloc(32, 9).toString('base64');
    const old = process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
    process.env.BOOKING_CAPABILITY_OUTBOX_KEY = key;
    try {
      const outbox = createBookingConfirmationOutbox({ appointmentId: 'appointment_1', businessId: 'business_1', token: capability.token, capabilityExpiresAt: capability.capability.expiresAt, now });
      expect(JSON.stringify(outbox)).not.toContain(capability.token);
      expect(isDeliverableOutbox(outbox, now)).toBe(true);
      expect(isDeliverableOutbox({ ...outbox, status: 'sent' }, now)).toBe(false);
      expect(isDeliverableOutbox({ ...outbox, attempts: 5 }, now)).toBe(false);
      expect(isDeliverableOutbox({ ...outbox, attempts: 4 }, now)).toBe(true);
      expect(isDeliverableOutbox({ ...outbox, status: 'processing', leaseUntil: new Date(now.getTime() - 1) }, now)).toBe(true);
      expect(isDeliverableOutbox({ ...outbox, status: 'processing', leaseUntil: new Date(now.getTime() + 1) }, now)).toBe(false);
      expect(isDeliverableOutbox({ ...outbox, capabilityExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    } finally {
      if (old === undefined) delete process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
      else process.env.BOOKING_CAPABILITY_OUTBOX_KEY = old;
    }
  });
});
