import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const navigation = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.path }));
vi.mock('next/script', () => ({ default: ({ src }: { src: string }) => <span data-testid="analytics-script">{src}</span> }));
import AnalyticsConsent, { analyticsAllowedPath } from '@/components/AnalyticsConsent';
describe('optional analytics boundary', () => {
  beforeEach(() => { localStorage.clear(); navigation.path = '/'; });
  it('loads no analytics until accepted and allows revocation', () => {
    render(<AnalyticsConsent />);
    expect(screen.queryByTestId('analytics-script')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar analítica' }));
    expect(screen.getByTestId('analytics-script')).toBeInTheDocument();
    fireEvent(window, new Event('pediturno:analytics-preferences'));
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar analítica' }));
    expect(screen.queryByTestId('analytics-script')).not.toBeInTheDocument();
    expect(localStorage.getItem('pediturno_analytics_consent_v1')).toBe('rejected');
  });
  it.each(['/cancel/private-token', '/pago/private-order', '/dashboard', '/dashboard/admin', '/api/public/bookings', '/__/auth/handler', '/auth/action', '/business-public-booking', '/demo-servicios', '/demo-canchas', '/demo-espacios'])('excludes sensitive and booking path %s', path => expect(analyticsAllowedPath(path)).toBe(false));
  it.each(['/auth/action', '/business-public-booking', '/demo-servicios', '/demo-canchas', '/demo-espacios'])('keeps %s free of consent banners and analytics even with previous consent', path => {
    navigation.path = path;
    const { rerender } = render(<AnalyticsConsent />);
    expect(screen.queryByRole('region', { name: 'Preferencias de privacidad' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-script')).not.toBeInTheDocument();
    localStorage.setItem('pediturno_analytics_consent_v1', 'accepted');
    rerender(<AnalyticsConsent key="returning-visitor" />);
    fireEvent(window, new Event('pediturno:analytics-preferences'));
    expect(screen.queryByRole('region', { name: 'Preferencias de privacidad' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-script')).not.toBeInTheDocument();
    expect((window as unknown as Record<string, unknown>)['ga-disable-G-XXXXXXXXXX']).toBe(true);
  });
});
