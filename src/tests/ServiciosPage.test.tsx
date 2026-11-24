/// <reference types="vitest/globals" />

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServiciosPage from '@/app/dashboard/servicios/page';

const mocks = vi.hoisted(() => ({
  user: { uid: 'owner-1' },
  getServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  refetchProfileAndServices: vi.fn(),
  toast: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock('@/services/data', () => ({
    getServices: mocks.getServices,
    createService: mocks.createService,
    updateService: mocks.updateService,
    deleteService: mocks.deleteService,
    uploadFile: mocks.uploadFile,
    deleteFile: mocks.deleteFile,
}));

vi.mock('@/hooks/useAuthRedirect', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/context/DashboardContext', () => ({
  useDashboard: () => ({ refetchProfileAndServices: mocks.refetchProfileAndServices }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}));

vi.mock('@/components/AvailabilitySettingsModal', () => ({
  default: ({ isOpen, service }: { isOpen: boolean; service: { id: string; name: string } }) =>
    isOpen ? <div data-testid="availability-modal" data-service-id={service.id}>Horarios de {service.name}</div> : null,
}));

const pausedService = {
  id: 'service-1',
  businessId: 'owner-1',
  name: 'Consulta inicial',
  duration: '45',
  price: '12500',
  status: 'Pausado' as const,
};

describe('ServiciosPage: alta, horarios y activación', () => {
  it('marca los datos faltantes al intentar guardar sin completar el paso', async () => {
    render(<ServiciosPage />);
    fireEvent.click(await screen.findByRole('button', { name: /agregar servicio/i }));
    const dialog = screen.getByRole('dialog', { name: /agregar nuevo servicio/i });
    const save = within(dialog).getByRole('button', { name: /crear y configurar horarios/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(within(dialog).getByText(/nombre debe tener entre 2 y 80/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/nombre del servicio/i)).toHaveAttribute('aria-invalid', 'true');
    expect(mocks.createService).not.toHaveBeenCalled();
  });
  it('refresca la guia al eliminar el ultimo servicio', async () => {
    mocks.getServices.mockResolvedValue([pausedService]);
    render(<ServiciosPage />);
    fireEvent.keyDown(await screen.findByRole('button', { name: /acciones/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /eliminar/i }));
    fireEvent.click(screen.getByRole('button', { name: /sí, eliminar/i }));
    await waitFor(() => {
      expect(mocks.deleteService).toHaveBeenCalledWith('service-1');
      expect(mocks.refetchProfileAndServices).toHaveBeenCalled();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.getServices.mockResolvedValue([]);
    mocks.createService.mockResolvedValue('created-service-1');
    mocks.updateService.mockResolvedValue(undefined);
    mocks.deleteService.mockResolvedValue(undefined);
    mocks.uploadFile.mockResolvedValue('https://example.test/service.webp');
    mocks.deleteFile.mockResolvedValue(undefined);
    mocks.refetchProfileAndServices.mockResolvedValue(undefined);
    mocks.createObjectURL.mockReturnValue('blob:service-preview');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL });
  });

  it('crea un servicio pausado sin ofrecer un estado imposible', async () => {
    render(<ServiciosPage />);

    const addButton = await screen.findByRole('button', { name: /agregar servicio/i });
    fireEvent.click(addButton);

    const dialog = screen.getByRole('dialog', { name: /agregar nuevo servicio/i });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Se crea sin publicar');
    expect(within(dialog).queryByRole('radio', { name: /activo/i })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/nombre del servicio/i), {
      target: { value: 'Consulta inicial' },
    });
    fireEvent.change(within(dialog).getByLabelText(/duración/i), { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText(/precio/i), { target: { value: '12500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /crear y configurar horarios/i }));

    await waitFor(() => {
      expect(mocks.createService).toHaveBeenCalledWith(expect.objectContaining({
        businessId: 'owner-1',
        name: 'Consulta inicial',
        duration: '45',
        price: '12500',
        status: 'Pausado',
      }));
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Servicio creado en pausa',
    }));
    const availabilityModal = await screen.findByTestId('availability-modal');
    expect(availabilityModal).toHaveAttribute('data-service-id', 'created-service-1');
    expect(availabilityModal).toHaveTextContent('Horarios de Consulta inicial');
  });

  it('no transfiere a disponibilidad al cancelar un alta normal', async () => {
    render(<ServiciosPage />);

    const addButton = await screen.findByRole('button', { name: /agregar servicio/i });
    fireEvent.click(addButton);
    const dialog = screen.getByRole('dialog', { name: /agregar nuevo servicio/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /cancelar/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /agregar nuevo servicio/i })).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('availability-modal')).not.toBeInTheDocument();
  });

  it.each([
    ['sin horarios', undefined],
    ['con rangos superpuestos', {
      1: { slots: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] },
    }],
  ])('guía a configurar horarios cuando la disponibilidad está inválida: %s', async (_case, workingHours) => {
    mocks.getServices.mockResolvedValue([{ ...pausedService, workingHours }]);

    render(<ServiciosPage />);

    expect(await screen.findByText('Consulta inicial')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activar servicio/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /configurar horarios/i }));

    expect(screen.getByTestId('availability-modal')).toHaveTextContent('Horarios de Consulta inicial');
  });

  it('activa desde la tarjeta sólo cuando ya existe disponibilidad válida', async () => {
    const readyService = {
      ...pausedService,
      workingHours: { 1: { slots: [{ start: '09:00', end: '13:00' }] } },
    };
    mocks.getServices.mockResolvedValue([readyService]);

    render(<ServiciosPage />);

    const activateButton = await screen.findByRole('button', { name: /activar servicio/i });
    expect(screen.queryByRole('button', { name: /configurar horarios/i })).not.toBeInTheDocument();
    fireEvent.click(activateButton);

    await waitFor(() => {
      expect(mocks.updateService).toHaveBeenCalledWith('service-1', { status: 'Activo' });
      expect(mocks.refetchProfileAndServices).toHaveBeenCalled();
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Servicio activo',
      description: 'Ya puede mostrarse para nuevas reservas.',
    });
  });

  it('conserva la imagen y confirma el guardado si falla sólo el refresco posterior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.refetchProfileAndServices.mockRejectedValue(new Error('refresh failed'));

    render(<ServiciosPage />);

    fireEvent.click(await screen.findByRole('button', { name: /agregar servicio/i }));
    const dialog = screen.getByRole('dialog', { name: /agregar nuevo servicio/i });
    fireEvent.change(within(dialog).getByLabelText(/nombre del servicio/i), {
      target: { value: 'Consulta con foto' },
    });
    fireEvent.change(within(dialog).getByLabelText(/duración/i), { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText(/precio/i), { target: { value: '12500' } });

    const photoInput = dialog.querySelector<HTMLInputElement>('#photo-upload');
    expect(photoInput).not.toBeNull();
    const photo = new File(['image'], 'consulta.jpg', { type: 'image/jpeg' });
    fireEvent.change(photoInput!, { target: { files: [photo] } });
    fireEvent.click(within(dialog).getByRole('button', { name: /crear y configurar horarios/i }));

    await waitFor(() => {
      expect(mocks.createService).toHaveBeenCalledWith(expect.objectContaining({
        photo: 'https://example.test/service.webp',
      }));
      expect(mocks.toast).toHaveBeenCalledWith({
        title: 'Servicio guardado',
        description: 'El guardado se completó, pero la pantalla no pudo actualizarse. Recargá la página para ver el estado actual.',
      });
    });
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

});
