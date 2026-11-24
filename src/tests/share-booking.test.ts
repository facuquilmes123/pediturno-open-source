import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareBookingLink } from '@/lib/share-booking';

describe('native sharing', () => {
  const copy = vi.fn();
  beforeEach(() => {
    copy.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  it('shares through the device when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    expect(await shareBookingLink('https://espacios.pediturno.com/salon', 'Salón')).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://espacios.pediturno.com/salon' }));
    expect(copy).not.toHaveBeenCalled();
  });
  it('does not copy or report an error when the user cancels sharing', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')) });
    expect(await shareBookingLink('https://pediturno.com/club')).toBe('cancelled');
    expect(copy).not.toHaveBeenCalled();
  });
  it('copies the link on browsers without native sharing', async () => {
    expect(await shareBookingLink('https://canchas.pediturno.com/club')).toBe('copied');
    expect(copy).toHaveBeenCalledWith('https://canchas.pediturno.com/club');
  });
});
