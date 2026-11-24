import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppointmentForm from '@/components/AppointmentForm';

const bookingData = {
  service: { id: 'service-qa', name: 'Servicio QA', duration: '60' } as any,
  date: new Date('2026-09-25T12:00:00.000Z'),
  slot: '10:00',
};

beforeEach(() => localStorage.clear());

describe('public booking contact requirements', () => {
  it('shows a validation error instead of throwing when the contact phone is invalid', async () => {
    localStorage.setItem('pediturno-client-data', JSON.stringify({ name: 'Cliente QA', phone: '123', email: 'qa@example.invalid' }));
    const onConfirmBooking = vi.fn();
    render(<AppointmentForm context="clientBooking" isBooking={false} bookingData={bookingData} onConfirmBooking={onConfirmBooking} />);

    await screen.findByDisplayValue('123');
    const form = screen.getByRole('button', { name: 'Confirmar Reserva' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(await screen.findByText('Número de teléfono inválido.')).toBeInTheDocument();
    expect(onConfirmBooking).not.toHaveBeenCalled();
  });

  it('keeps the form open and explains why email is needed before submitting', async () => {
    localStorage.setItem('pediturno-client-data', JSON.stringify({ name: 'Cliente QA', phone: '+5411111111', email: '' }));
    const onConfirmBooking = vi.fn();
    render(<AppointmentForm context="clientBooking" isBooking={false} bookingData={bookingData} onConfirmBooking={onConfirmBooking} />);

    await screen.findByDisplayValue('Cliente QA');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Reserva' }));

    expect(await screen.findByText('El email es obligatorio para recibir y gestionar tu reserva.')).toBeInTheDocument();
    expect(onConfirmBooking).not.toHaveBeenCalled();
  });

  it('passes a valid email through to the booking callback', async () => {
    localStorage.setItem('pediturno-client-data', JSON.stringify({ name: 'Cliente QA', phone: '+5411111111', email: 'qa@example.invalid' }));
    const onConfirmBooking = vi.fn();
    render(<AppointmentForm context="clientBooking" isBooking={false} bookingData={bookingData} onConfirmBooking={onConfirmBooking} />);

    await screen.findByDisplayValue('qa@example.invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar Reserva' }));

    await waitFor(() => expect(onConfirmBooking).toHaveBeenCalledTimes(1));
    expect(onConfirmBooking.mock.calls[0][0].email).toBe('qa@example.invalid');
  });

  it('labels a cancha in the booking summary and keeps services labelled as services', () => {
    const onConfirmBooking = vi.fn();
    const { rerender } = render(
      <AppointmentForm
        context="clientBooking"
        isBooking={false}
        bookingData={{ ...bookingData, resourceType: 'cancha' }}
        onConfirmBooking={onConfirmBooking}
      />,
    );

    expect(screen.getByText('Cancha:', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Servicio QA')).toBeInTheDocument();

    rerender(
      <AppointmentForm
        context="clientBooking"
        isBooking={false}
        bookingData={{ ...bookingData, resourceType: 'service' }}
        onConfirmBooking={onConfirmBooking}
      />,
    );

    expect(screen.getByText('Servicio:', { exact: true })).toBeInTheDocument();
  });
});
