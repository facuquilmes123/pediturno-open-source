/* eslint-disable @next/next/no-img-element -- Minimal next/image test double. */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'qa-capability-token' }) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));

import CancelClientPage from '@/app/cancel/[id]/CancelClientPage';

const appointment = {
  businessName: 'Negocio QA',
  businessSlug: 'negocio-qa',
  businessUrl: '/negocio-qa',
  service: 'Servicio QA',
  kind: 'service' as const,
  date: '2026-10-29T00:00:00.000Z',
  time: '18:15',
};

describe('public appointment actions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the requested reschedule and explains an occupied slot in Spanish', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appointment }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Slot already booked' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<CancelClientPage />);
    await screen.findByText('¿Cancelar esta reserva?');
    fireEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    fireEvent.change(screen.getByLabelText('Nueva fecha'), { target: { value: '2026-10-30' } });
    fireEvent.change(screen.getByLabelText('Nueva hora'), { target: { value: '18:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cambio' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese horario ya fue reservado. Elegí otra fecha u horario.');
    expect(screen.getByLabelText('Nueva fecha')).toHaveValue('2026-10-30');
    expect(screen.getByLabelText('Nueva hora')).toHaveValue('18:15');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
