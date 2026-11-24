import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClientEditModal from '@/components/ClientEditModal';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  updateClient: vi.fn(),
  deleteFile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/services/data', () => ({
  uploadFile: mocks.uploadFile,
  updateClient: mocks.updateClient,
  deleteFile: mocks.deleteFile,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function MockInput(props, ref) { return <input ref={ref} {...props} />; }),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: ({ alt }: React.ImgHTMLAttributes<HTMLImageElement>) => <span role="img" aria-label={alt} />,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const client = {
  id: 'client-1',
  businessId: 'business-1',
  name: 'Ada Lovelace',
  phone: '+541100000000',
  email: 'ada@example.com',
  avatar: 'https://firebasestorage.googleapis.com/v0/b/project/o/old-avatar.webp',
  lastAppointment: null,
};

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function selectAvatar() {
  fireEvent.change(screen.getByLabelText('Foto de Perfil'), {
    target: { files: [new File(['image'], 'avatar.webp', { type: 'image/webp' })] },
  });
}

function renderModal(onClientUpdate = vi.fn()) {
  const onOpenChange = vi.fn();
  render(
    <ClientEditModal
      isOpen
      onOpenChange={onOpenChange}
      client={client}
      onClientUpdate={onClientUpdate}
    />
  );
  return { onClientUpdate, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:avatar-preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
  else delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
  else delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
});

describe('ClientEditModal avatar replacement', () => {
  it('keeps the existing avatar untouched when the new upload fails and exposes the safe upload message', async () => {
    mocks.uploadFile.mockRejectedValue(new Error('Tu membresía no está activa. Revisá la sección Membresía antes de subir imágenes.'));
    renderModal();
    selectAvatar();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error al subir',
      description: 'Tu membresía no está activa. Revisá la sección Membresía antes de subir imágenes.',
    })));
    expect(mocks.updateClient).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it('preserves both images if the save acknowledgement fails after a possible commit', async () => {
    const order: string[] = [];
    mocks.uploadFile.mockImplementation(async () => {
      order.push('upload');
      return 'https://firebasestorage.googleapis.com/v0/b/project/o/new-avatar.webp';
    });
    mocks.updateClient.mockImplementation(async () => {
      order.push('save');
      throw new Error('Firestore unavailable');
    });
    mocks.deleteFile.mockImplementation(async (url: string) => {
      order.push(url.includes('new-avatar') ? 'delete-new' : 'delete-old');
    });
    const { onClientUpdate } = renderModal();
    selectAvatar();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' })));
    expect(order).toEqual(['upload', 'save']);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalledWith(client.avatar);
    expect(onClientUpdate).not.toHaveBeenCalled();
  });

  it('uploads and persists before refreshing while server owns reference-aware cleanup', async () => {
    const order: string[] = [];
    mocks.uploadFile.mockImplementation(async () => {
      order.push('upload');
      return 'https://firebasestorage.googleapis.com/v0/b/project/o/new-avatar.webp';
    });
    mocks.updateClient.mockImplementation(async () => {
      order.push('save');
    });
    mocks.deleteFile.mockImplementation(async (url: string) => {
      order.push(url.includes('old-avatar') ? 'delete-old' : 'delete-new');
    });
    const onClientUpdate = vi.fn(() => order.push('callback'));
    const { onOpenChange } = renderModal(onClientUpdate);
    selectAvatar();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(onClientUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.updateClient).toHaveBeenCalledWith(client.id, expect.objectContaining({ avatar: expect.stringContaining('new-avatar') }));
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(order).toEqual(['upload', 'save', 'callback']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-preview');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not delete the persisted avatar when the post-commit callback throws', async () => {
    mocks.uploadFile.mockResolvedValue('https://firebasestorage.googleapis.com/v0/b/project/o/new-avatar.webp');
    mocks.updateClient.mockResolvedValue(undefined);
    mocks.deleteFile.mockResolvedValue(undefined);
    const callbackError = new Error('refresh failed');
    const onClientUpdate = vi.fn(() => { throw callbackError; });
    renderModal(onClientUpdate);
    selectAvatar();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(onClientUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalledWith(expect.stringContaining('new-avatar'));
  });

  it('persists an empty avatar string when a legacy client has no avatar', async () => {
    mocks.updateClient.mockResolvedValue(undefined);
    const onClientUpdate = vi.fn();
    render(
      <ClientEditModal
        isOpen
        onOpenChange={vi.fn()}
        client={{ ...client, avatar: undefined }}
        onClientUpdate={onClientUpdate}
      />
    );

    fireEvent.change(screen.getByLabelText('Nombre del Cliente'), { target: { value: 'Ada Byron' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

    await waitFor(() => expect(onClientUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.updateClient).toHaveBeenCalledWith(client.id, expect.objectContaining({ avatar: '' }));
  });
});
