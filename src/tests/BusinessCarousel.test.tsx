import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BusinessCarousel from '@/components/landing/BusinessCarousel';

function mockMotionPreference(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: reduced,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('BusinessCarousel', () => {
  beforeEach(() => {
    mockMotionPreference(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders one stable carousel with honest illustrative copy and accessible controls', () => {
    render(<BusinessCarousel />);

    expect(screen.getByRole('region', { name: /ejemplos de negocios/i })).toBeInTheDocument();
    const currentSlide = screen.getByRole('group', { name: /1 de 4: tu jornada organizada/i });
    expect(currentSlide).toBeInTheDocument();
    expect(screen.getByText(/escenas ilustrativas/i)).toBeInTheDocument();
    expect(within(currentSlide).getByText(/ilustración.*pediturno\.com/i)).toBeInTheDocument();
    expect(screen.getByAltText(/clienta eligiendo un turno/i)).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('button', { name: /pausar recorrido automático/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver ejemplo anterior/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver ejemplo siguiente/i })).toBeInTheDocument();
  });

  it('supports previous, next, dots and an explicit pause control', () => {
    render(<BusinessCarousel />);

    fireEvent.click(screen.getByRole('button', { name: /ver ejemplo siguiente/i }));
    expect(screen.getByRole('group', { name: /2 de 4: un enlace, menos mensajes/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ver ejemplo 4: talleres/i }));
    expect(screen.getByRole('group', { name: /4 de 4: talleres/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pausar recorrido automático/i }));
    expect(screen.getByRole('button', { name: /reanudar recorrido automático/i })).toBeInTheDocument();
  });

  it('keeps focus and hover pauses independent while the carousel is being explored', () => {
    vi.useFakeTimers();
    render(<BusinessCarousel />);
    const carousel = screen.getByRole('region', { name: /ejemplos de negocios/i });
    const nextButton = screen.getByRole('button', { name: /ver ejemplo siguiente/i });

    fireEvent.mouseEnter(carousel);
    fireEvent.focus(nextButton);
    fireEvent.mouseLeave(carousel);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByRole('group', { name: /1 de 4/i })).toBeInTheDocument();

    fireEvent.blur(nextButton, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole('group', { name: /2 de 4/i })).toBeInTheDocument();
  });

  it('pauses autoplay while the page is hidden and resumes when visible', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<BusinessCarousel />);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByRole('group', { name: /1 de 4/i })).toBeInTheDocument();

    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole('group', { name: /2 de 4/i })).toBeInTheDocument();
  });

  it('keeps autoplay disabled when reduced motion is requested', () => {
    vi.useFakeTimers();
    mockMotionPreference(true);
    render(<BusinessCarousel />);

    const motionControl = screen.getByRole('button', { name: /movimiento automático desactivado/i });
    expect(motionControl).toBeDisabled();
    act(() => vi.advanceTimersByTime(18_000));
    expect(screen.getByRole('group', { name: /1 de 4/i })).toBeInTheDocument();
  });

  it('uses only sports imagery and the courts domain in the sports portal', () => {
    render(<BusinessCarousel vertical="sports_facility" />);

    expect(screen.getByRole('region', { name: /ejemplos de complejos/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /1 de 2: complejos deportivos/i })).toBeInTheDocument();
    expect(screen.getAllByText(/canchas\.pediturno\.com/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/estética y bienestar/i)).not.toBeInTheDocument();
  });
});
