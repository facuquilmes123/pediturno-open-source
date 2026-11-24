import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ after: vi.fn(), deliver: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/booking-outbox', () => ({ deliverBookingOutbox: mocks.deliver }));
import { scheduleBookingDelivery } from '@/lib/booking-delivery';
describe('immediate durable delivery', () => {
  it('delivers after responding, preserving the cron retry if SMTP fails', async () => {
    scheduleBookingDelivery('mail');
    expect(mocks.deliver).not.toHaveBeenCalled();
    mocks.deliver.mockResolvedValue('retry');
    await mocks.after.mock.calls[0][0]();
    expect(mocks.deliver).toHaveBeenCalledWith('mail');
  });
});
