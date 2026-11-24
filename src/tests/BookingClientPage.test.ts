import { describe, expect, it, vi } from 'vitest';
import { appointmentsForSelectedResource, bookingSelectionFromSlot, nextCandidateAfterConflict, finishPublicBooking } from '@/app/[slug]/BookingClientPage';

const canchaA = { id: 'cancha-a', name: 'Cancha 1', duration: 60 } as any;
const canchaB = { id: 'cancha-b', name: 'Cancha 1', duration: 60 } as any;

describe('public booking payment result', () => {
  it('keeps a deposit pending and navigates to server payment state without showing confirmation', () => {
    const navigate = vi.fn(), confirm = vi.fn(), orderId = 'qa-pending-order-123456789';
    finishPublicBooking({ id: 'booking', depositOrderId: orderId, checkoutUrl: 'https://untrusted.invalid/', paymentUrl: 'https://untrusted.invalid/' }, navigate, confirm);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`https://pediturno.com/pago/${orderId}`);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('preserves the existing confirmation flow for a booking without a deposit', () => {
    const navigate = vi.fn(), confirm = vi.fn();
    finishPublicBooking({ id: 'booking', repeated: true }, navigate, confirm);
    expect(confirm).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
  });
  it.each([null, { id: 'booking', depositOrderId: '../other' }, { id: 'booking', depositOrderId: '' }])('does not confirm or redirect a malformed response', payload => {
    const navigate = vi.fn(), confirm = vi.fn();
    expect(() => finishPublicBooking(payload, navigate, confirm)).toThrow();
    expect(confirm).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
});

describe('public cancha availability', () => {
  it('uses the cancha id so resources with the same display name remain independent', () => {
    const appointments = [
      { id: 'a', cancha: 'Cancha 1', canchaId: 'cancha-a' },
      { id: 'b', cancha: 'Cancha 1', canchaId: 'cancha-b' },
    ] as any[];

    expect(appointmentsForSelectedResource(appointments, canchaA).map(({ id }) => id)).toEqual(['a']);
    expect(appointmentsForSelectedResource(appointments, canchaB).map(({ id }) => id)).toEqual(['b']);
  });

  it('keeps legacy cancha appointments scoped by their stored name until migrated', () => {
    const appointments = [
      { id: 'legacy', cancha: 'Cancha 1' },
      { id: 'other', cancha: 'Cancha 2' },
    ] as any[];

    expect(appointmentsForSelectedResource(appointments, canchaA).map(({ id }) => id)).toEqual(['legacy']);
  });
});

describe('public spaces overnight availability', () => {
  it('submits the real next-day date for a slot produced after midnight', () => {
    expect(bookingSelectionFromSlot({ key: '2026-10-06T02:00', time: '02:00', date: new Date(2026, 9, 6, 2, 0) })).toEqual({ dateKey: '2026-10-06', time: '02:00' });
  });

  it('advances past the occupied interval plus preparation to avoid retrying the same overlap', () => {
    const next = nextCandidateAfterConflict(new Date(2026, 9, 6, 10, 0), 60);
    expect(next).toEqual(new Date(2026, 9, 6, 11, 0));
  });

  it('scopes occupied intervals from the previous day to the selected space', () => {
    const space = { id: 'space-a', name: 'Salón A' } as any;
    const appointments = [
      { id: 'overnight', spaceId: 'space-a', occupiedStartAt: '2026-10-05T23:00:00.000Z', occupiedEndAt: '2026-10-06T06:00:00.000Z' },
      { id: 'other', spaceId: 'space-b', occupiedStartAt: '2026-10-05T23:00:00.000Z', occupiedEndAt: '2026-10-06T06:00:00.000Z' },
    ] as any[];
    expect(appointmentsForSelectedResource(appointments, null, space).map(({ id }) => id)).toEqual(['overnight']);
  });
});
