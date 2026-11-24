/// <reference types="vitest/globals" />
/* eslint-disable @next/next/no-img-element */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CanchasPage from '@/app/dashboard/canchas/page';

const mocks = vi.hoisted(() => ({
  getCanchas: vi.fn(),
  createCancha: vi.fn(),
  updateCancha: vi.fn(),
  deleteCancha: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  toast: vi.fn(),
  refetch: vi.fn(),
  authUser: { uid: 'owner-1' },
}));

vi.mock('@/services/data', async () => {
  const { validateWorkingHours } = await import('@/lib/cancha-validation');
  return {
    getCanchas: mocks.getCanchas,
    createCancha: mocks.createCancha,
    updateCancha: mocks.updateCancha,
    deleteCancha: mocks.deleteCancha,
    uploadFile: mocks.uploadFile,
    deleteFile: mocks.deleteFile,
    validateWorkingHours,
    CANCHA_DURATIONS: [30, 60, 90, 120, 150, 180],
    CANCHA_SPORTS: ['futbol', 'padel', 'tenis', 'otro'],
    normalizeCanchaPrice: (value: string) => value.trim() || null,
  };
});

vi.mock('@/hooks/useAuthRedirect', () => ({
  useAuth: () => ({ user: mocks.authUser }),
}));

vi.mock('@/context/DashboardContext', () => ({ useDashboard: () => ({ refetchProfileAndServices: mocks.refetch }) }));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/AvailabilitySettingsModal', () => ({
  default: ({ isOpen, cancha }: { isOpen: boolean; cancha: { name: string } }) =>
    isOpen ? <div data-testid="availability-modal">Horarios de {cancha.name}</div> : null,
}));

const pausedCancha = {
  id: 'cancha-1',
  businessId: 'owner-1',
  name: 'Cancha Norte',
  duration: 60,
  price: '12000',
  sport: 'futbol' as const,
  status: 'Pausado' as const,
};

describe('CanchasPage: alta, horarios y activación', () => {
  beforeEach(() => {
    mocks.refetch.mockResolvedValue(undefined);
    mocks.getCanchas.mockResolvedValue([]);
    mocks.createCancha.mockResolvedValue('cancha-nueva');
    mocks.updateCancha.mockResolvedValue(undefined);
    mocks.deleteCancha.mockResolvedValue(undefined);
    mocks.uploadFile.mockResolvedValue('https://example.test/cancha.webp');
    mocks.deleteFile.mockResolvedValue(undefined);
  });

  it('crea una cancha pausada y abre horarios con el identificador creado', async () => {
    render(<CanchasPage />);

    fireEvent.click(await screen.findByRole('button', { name: /agregar cancha/i }));
    const dialog = screen.getByRole('dialog', { name: /agregar nueva cancha/i });

    expect(within(dialog).getByRole('status')).toHaveTextContent('Se crea sin publicar');
    expect(within(dialog).queryByRole('radio', { name: /activo/i })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/nombre de la cancha/i), { target: { value: 'Cancha Sur' } });
    fireEvent.change(within(dialog).getByLabelText(/precio por turno/i), { target: { value: '14000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /crear y configurar horarios/i }));

    await waitFor(() => {
      expect(mocks.createCancha).toHaveBeenCalledWith(expect.objectContaining({
        businessId: 'owner-1',
        name: 'Cancha Sur',
        price: '14000',
        status: 'Pausado',
      }));
    });
    expect(await screen.findByTestId('availability-modal')).toHaveTextContent('Horarios de Cancha Sur');
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancha creada en pausa' }));
  });

  it('conserva la imagen nueva y comunica el guardado si falla la recarga posterior', async () => {
    mocks.getCanchas.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh unavailable'));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cancha-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<CanchasPage />);

    fireEvent.click(await screen.findByRole('button', { name: /agregar cancha/i }));
    const dialog = screen.getByRole('dialog', { name: /agregar nueva cancha/i });
    fireEvent.change(within(dialog).getByLabelText(/nombre de la cancha/i), { target: { value: 'Cancha Sur' } });
    fireEvent.change(within(dialog).getByLabelText(/precio por turno/i), { target: { value: '14000' } });
    fireEvent.change(dialog.querySelector('#photo-upload')!, {
      target: { files: [new File(['image'], 'cancha.webp', { type: 'image/webp' })] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /crear y configurar horarios/i }));

    await waitFor(() => {
      expect(mocks.createCancha).toHaveBeenCalled();
      expect(mocks.deleteFile).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Cambios guardados',
        description: expect.stringMatching(/se guardó, pero no se pudo actualizar el listado/i),
      }));
    });
    consoleError.mockRestore();
  });

  it('lleva a horarios al intentar activar una cancha pausada sin disponibilidad válida', async () => {
    mocks.getCanchas.mockResolvedValue([pausedCancha]);
    render(<CanchasPage />);

    expect(await screen.findByText('Cancha Norte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /activar cancha/i }));

    expect(await screen.findByTestId('availability-modal')).toHaveTextContent('Horarios de Cancha Norte');
    expect(mocks.updateCancha).not.toHaveBeenCalled();
  });

  it('activa sólo cuando los horarios son válidos', async () => {
    mocks.getCanchas.mockResolvedValue([{
      ...pausedCancha,
      workingHours: { 1: { slots: [{ start: '09:00', end: '21:00' }] } },
    }]);
    render(<CanchasPage />);

    expect(await screen.findByText('Cancha Norte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /activar cancha/i }));

    await waitFor(() => {
      expect(mocks.updateCancha).toHaveBeenCalledWith('cancha-1', { status: 'Activo' });
    });
  });

  it('no permite elegir Activo al editar una cancha con horarios inválidos', async () => {
    mocks.getCanchas.mockResolvedValue([{ ...pausedCancha, workingHours: {} }]);
    render(<CanchasPage />);

    expect(await screen.findByText('Cancha Norte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /editar cancha/i }));

    expect(screen.getByRole('radio', { name: /activo/i })).toBeDisabled();
    expect(screen.getByText(/activación está bloqueada/i)).toBeInTheDocument();
  });
});
