import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboarding } from '@/hooks/useOnboarding';
import OnboardingWizard from '@/components/OnboardingWizard';

const mocks = vi.hoisted(() => ({
  getCanchas: vi.fn(),
  dashboard: {
    businessProfile: null as any,
    services: [] as any[],
    canchas: [] as any[],
    spaces: [] as any[],
  },
  user: { uid: 'owner-1' } as any,
}));

vi.mock('@/context/DashboardContext', () => ({
  useDashboard: () => mocks.dashboard,
}));

vi.mock('@/hooks/useAuthRedirect', () => ({
  useAuth: () => ({ user: mocks.user, loading: false }),
}));

vi.mock('@/services/data', () => ({
  getCanchas: mocks.getCanchas,
}));

describe('useOnboarding by business modality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.dashboard.businessProfile = null;
    mocks.dashboard.services = [];
    mocks.dashboard.canchas = [];
    mocks.dashboard.spaces = [];
  });

  it.each([
    ['services', 'https://pediturno.com/club'],
    ['sports_facility', 'https://canchas.pediturno.com/club'],
  ])('copies the correct public link for %s', async (businessType, url) => {
    mocks.dashboard.businessProfile = { slug: 'club', businessType };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<OnboardingWizard steps={[{ id: 'share', title: 'Compartir', description: 'Listo', cta: 'Copiar Enlace', isComplete: true, href: '#' }]} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copiar enlace/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  });

  it('guides a sports facility through canchas and their availability', async () => {
    mocks.dashboard.businessProfile = {
      id: 'owner-1',
      name: 'Club Norte',
      slug: 'club-norte',
      businessType: 'sports_facility',
    };
    mocks.dashboard.canchas = [
      { id: 'court-1', duration: 30, status: 'Activo', workingHours: { 1: { slots: [{ start: '09:00', end: '10:00' }] } } },
    ];

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.current.onboardingSteps.find(step => step.id === 'services')?.isComplete).toBe(true);
    });

    const courtsStep = result.current.onboardingSteps.find(step => step.id === 'services');
    const availabilityStep = result.current.onboardingSteps.find(step => step.id === 'availability');
    expect(courtsStep).toMatchObject({
      title: 'Agrega tus Canchas',
      href: '/dashboard/canchas',
      cta: 'Añadir Canchas',
    });
    expect(availabilityStep).toMatchObject({
      href: '/dashboard/canchas',
      isComplete: true,
    });
  });

  it('keeps the services onboarding for a conventional account', () => {
    mocks.dashboard.businessProfile = {
      id: 'owner-1',
      name: 'Estudio Centro',
      slug: 'estudio-centro',
      businessType: 'services',
    };
    mocks.dashboard.services = [
      { id: 'service-1', duration: 30, status: 'Activo', workingHours: { 1: { slots: [{ start: '09:00', end: '10:00' }] } } },
    ];

    const { result } = renderHook(() => useOnboarding());

    expect(result.current.onboardingSteps.find(step => step.id === 'services')).toMatchObject({
      title: 'Agrega tus Servicios',
      href: '/dashboard/servicios',
      isComplete: true,
    });
    expect(mocks.getCanchas).not.toHaveBeenCalled();
  });

  it('guides an spaces account through numbered space setup steps', () => {
    mocks.dashboard.businessProfile = { id: 'owner-1', name: 'Eventos Norte', slug: 'eventos-norte', businessType: 'spaces' };
    mocks.dashboard.spaces = [{ id: 'space-1', status: 'Activo', packages: [{ durationMinutes: 240, price: '50000' }], workingHours: { 6: { slots: [{ start: '10:00', end: '22:00' }] } } }];
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.onboardingSteps.find(step => step.id === 'spaces')).toMatchObject({ title: 'Agregá tus Espacios', href: '/dashboard/espacios', isComplete: true });
    expect(result.current.onboardingSteps.find(step => step.id === 'space-availability')).toMatchObject({ isComplete: true });
    expect(result.current.onboardingSteps).toHaveLength(4);
  });

  it('keeps the availability step incomplete until a valid service is active', () => {
    mocks.dashboard.businessProfile = {
      id: 'owner-1',
      name: 'Estudio Centro',
      slug: 'estudio-centro',
      businessType: 'services',
    };
    mocks.dashboard.services = [{
      id: 'service-1',
      duration: 30, status: 'Pausado',
      workingHours: { 1: { slots: [{ start: '09:00', end: '10:00' }] } },
    }];

    const { result } = renderHook(() => useOnboarding());

    expect(result.current.onboardingSteps.find(step => step.id === 'services')?.isComplete).toBe(true);
    expect(result.current.onboardingSteps.find(step => step.id === 'availability')).toMatchObject({
      isComplete: false,
      missingRequirements: [expect.stringMatching(/Activá/)],
    });
    expect(result.current.onboardingSteps.find(step => step.id === 'share')?.isComplete).toBe(false);
  });

  it('requires both services and canchas for a hybrid business', async () => {
    mocks.dashboard.businessProfile = {
      id: 'owner-1',
      name: 'Centro Mixto',
      slug: 'centro-mixto',
      businessType: 'hybrid',
    };
    mocks.dashboard.services = [{ id: 'service-1', duration: 30, status: 'Activo', workingHours: { 1: { slots: [{ start: '09:00', end: '10:00' }] } } }];
    mocks.dashboard.canchas = [{ id: 'court-1', duration: 30, status: 'Activo', workingHours: { 1: { slots: [{ start: '18:00', end: '19:00' }] } } }];

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.current.onboardingSteps.find(step => step.id === 'canchas')?.isComplete).toBe(true);
    });
    expect(result.current.onboardingSteps.find(step => step.id === 'services')?.isComplete).toBe(true);
    expect(result.current.onboardingSteps.find(step => step.id === 'service-availability')?.isComplete).toBe(true);
    expect(result.current.onboardingSteps.find(step => step.id === 'cancha-availability')?.isComplete).toBe(true);
    expect(result.current.showWizard).toBe(true);
  });

  it('stores dismissal for the authenticated owner only', () => {
    mocks.dashboard.businessProfile = { id: 'owner-1', name: '', slug: '', businessType: 'services' };
    const { result } = renderHook(() => useOnboarding());

    act(() => result.current.setOnboardingComplete());

    expect(localStorage.getItem('pediturno_onboarding_dismissed:owner-1')).toBe('true');
    expect(localStorage.getItem('pediturno_onboarding_dismissed')).toBeNull();
  });

  it('shows the missing requirements before linking to an incomplete step', () => {
    render(<OnboardingWizard steps={[{
      id: 'profile', title: 'Completa tu Perfil', description: 'Datos públicos', cta: 'Ir a Mi Negocio',
      isComplete: false, href: '/dashboard/mi-negocio', Icon: () => null, missingRequirements: ['Indicá el nombre de tu negocio.'],
    }]} onComplete={() => {}} />);

    expect(screen.getByText('Para completar este paso:')).toBeInTheDocument();
    expect(screen.getByText('Indicá el nombre de tu negocio.')).toBeInTheDocument();
    expect(screen.getByText('Paso 1 de 1:', { selector: '.sr-only' })).toBeInTheDocument();
  });
});

