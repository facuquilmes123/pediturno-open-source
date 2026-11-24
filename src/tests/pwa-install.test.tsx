import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getInstallPrompt, isIosDevice, listenForInstallPrompt } from '@/lib/pwa-install';
import PwaInstallBanner from '@/components/PwaInstallBanner';
const mocks = vi.hoisted(() => ({ user: { uid: 'owner' } as { uid: string } | null }));
vi.mock('@/hooks/useAuthRedirect', () => ({ useAuth: () => ({ user: mocks.user }) }));

let stop: () => void;
beforeEach(() => {
  mocks.user = { uid: 'owner' };
  localStorage.clear();
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  stop = listenForInstallPrompt();
  window.dispatchEvent(new Event('appinstalled'));
});
afterEach(() => { stop(); });
function offer() {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, { prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) });
  window.dispatchEvent(event);
  return event as Event & { prompt: ReturnType<typeof vi.fn> };
}
describe('PWA installation', () => {
  it('captures the Android offer before the dashboard component is mounted', async () => {
    const event = offer();
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPrompt()).toBe(event);
    render(<PwaInstallBanner />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Instalar Pediturno' })); });
    expect(event.prompt).toHaveBeenCalledOnce();
  });
  it('never suggests installation to a signed-out visitor', () => {
    offer(); mocks.user = null;
    render(<PwaInstallBanner />);
    expect(screen.queryByText('Llevá tu agenda en el celular')).not.toBeInTheDocument();
  });
  it('shows a graphical iPhone guide without waiting for an Android event', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone Safari' });
    expect(isIosDevice()).toBe(true);
    render(<PwaInstallBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Cómo instalar en iPhone' }));
    expect(screen.getByText('2. Agregar a pantalla de inicio')).toBeInTheDocument();
  });
});
