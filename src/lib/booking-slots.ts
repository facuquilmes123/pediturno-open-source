import { createHash } from 'node:crypto';

// A create-only document for every occupied five-minute interval gives the
// database an atomic uniqueness constraint, including across calendar days.
export function bookingSlotIds(
  businessId: string,
  resourceKey: string,
  start: Date,
  durationMinutes: number,
  bufferMinutes: number,
  preparationMinutes = 0,
  slotMinutes = 5,
): string[] {
  if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || 60 % slotMinutes !== 0) throw new Error('INVALID_BOOKING_INTERVAL');
  const slotMillis = slotMinutes * 60_000;
  const first = Math.floor((start.getTime() - preparationMinutes * 60_000) / slotMillis);
  const last = Math.ceil((start.getTime() + (durationMinutes + bufferMinutes) * 60_000) / slotMillis);
  // Space bookings use a ten-minute namespace: a full 24-hour package plus
  // maximum setup, cleanup and buffer needs 216 locks, so rebooking stays
  // under Firestore's 500-write transaction limit too.
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last <= first || last - first > 450) {
    throw new Error('INVALID_BOOKING_INTERVAL');
  }
  const ids: string[] = [];
  for (let slot = first; slot < last; slot++) {
    // Preserve the production key-space for the existing five-minute
    // Services/Canchas bookings. Spaces use their own ten-minute namespace.
    const identity = slotMinutes === 5
      ? `${businessId}\0${resourceKey}\0${slot}`
      : `${businessId}\0${resourceKey}\0${slotMinutes}\0${slot}`;
    ids.push(createHash('sha256').update(identity).digest('hex'));
  }
  return ids;
}
