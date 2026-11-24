import { createHmac } from 'node:crypto';

// Fixed per-business counters: no IP trust and no plaintext customer data.
// A successful retry with the same idempotency key does not consume quota.
export function bookingRateLimits(businessId: string, email: string, phone: string, now: Date) {
  const key = process.env.BOOKING_CAPABILITY_OUTBOX_KEY;
  if (!key) throw new Error('Booking protection unavailable');
  const hour = Math.floor(now.getTime() / 3600000);
  const day = Math.floor(now.getTime() / 86400000);
  return [
    { subject: `email:${email.trim().toLowerCase()}`, window: day, limit: 10 },
    { subject: `phone:${phone.replace(/\D/g, '')}`, window: day, limit: 10 },
    { subject: 'business', window: hour, limit: 120 },
  ].map(({ subject, window, limit }) => ({
    id: createHmac('sha256', key).update(`${businessId}:${subject}`).digest('hex'),
    window, limit,
  }));
}

export function sameBookingConfiguration(before: Record<string, any>, after: Record<string, any>): boolean {
  // Resources have different booking models. Keep every field that changes
  // occupancy or the price snapshot stable across the preflight and commit.
  const fields = ['businessType', 'bookingSettings', 'timeZone', 'mercadopago', 'name', 'duration', 'price', 'workingHours', 'unavailableDates', 'bookingBufferMinutes', 'packages', 'preparationMinutes', 'cleanupMinutes'];
  return fields.every(field => JSON.stringify(before[field]) === JSON.stringify(after[field]));
}
