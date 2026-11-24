/// <reference types="vitest/globals" />
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LandingPortal from '@/components/landing/LandingPortal';

vi.mock('@/components/AuthModal', () => ({
  __esModule: true,
  default: ({ initialView, initialVertical }: { initialView: string; initialVertical: string }) => (
    <div data-testid="auth-modal-mock" data-view={initialView} data-vertical={initialVertical} />
  ),
}));

describe('portales de la landing', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['services', ['https://canchas.pediturno.com', 'https://espacios.pediturno.com']],
    ['sports_facility', ['https://pediturno.com', 'https://espacios.pediturno.com']],
    ['spaces', ['https://pediturno.com', 'https://canchas.pediturno.com']],
  ] as const)('recomienda los otros dos sistemas en el footer de %s', (vertical, destinations) => {
    render(<LandingPortal vertical={vertical} priceLabel="$5.000" />);
    const recommendations = within(screen.getByRole('contentinfo')).getByRole('navigation', { name: 'Otros sistemas de Pediturno' });
    expect(within(recommendations).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(destinations);
  });

  it('mantiene la propuesta de servicios enfocada y usa su precio', () => {
    render(<LandingPortal vertical="services" priceLabel="$5.000" />);

    expect(screen.getByRole('heading', { name: /tus turnos, claros para vos/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('$5.000')).toBeInTheDocument();
    expect(screen.queryByText(/sorteador deportivo/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /conocé pediturno canchas/i })).toHaveAttribute('href', 'https://canchas.pediturno.com');
  });

  it('mantiene el portal de canchas enfocado y registra la vertical correcta', async () => {
    render(<LandingPortal vertical="sports_facility" priceLabel="$10.000" />);

    expect(screen.getByRole('heading', { name: /cada cancha disponible/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText('$10.000')).toBeInTheDocument();
    expect(screen.queryByText('Estética y bienestar')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /crear mi complejo gratis/i })[0]);
    expect(await screen.findByTestId('auth-modal-mock')).toHaveAttribute('data-view', 'register');
    expect(screen.getByTestId('auth-modal-mock')).toHaveAttribute('data-vertical', 'sports_facility');
  });

  it('abre el acceso del portal actual sin ofrecer selector de modalidad', async () => {
    render(<LandingPortal vertical="services" priceLabel="$5.000" />);

    fireEvent.click(screen.getAllByRole('button', { name: /iniciar sesión/i })[0]);
    expect(await screen.findByTestId('auth-modal-mock')).toHaveAttribute('data-view', 'login');
    expect(screen.getByTestId('auth-modal-mock')).toHaveAttribute('data-vertical', 'services');
  });

  it('abre el login automáticamente sólo con ?login=1', async () => {
    window.history.replaceState({}, '', '/?login=1');
    render(<LandingPortal vertical="sports_facility" priceLabel="$10.000" />);

    expect(await screen.findByTestId('auth-modal-mock')).toHaveAttribute('data-view', 'login');
    expect(screen.getByTestId('auth-modal-mock')).toHaveAttribute('data-vertical', 'sports_facility');
  });
});
