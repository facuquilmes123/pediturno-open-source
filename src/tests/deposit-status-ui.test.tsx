import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PaymentStatus from '@/app/pago/[orderId]/PaymentStatus';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('explains a cancelled reservation without offering another deposit payment', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'cancelled', amount: 900, expiresAt: new Date(Date.now() + 600000).toISOString() }) }));
  render(<PaymentStatus orderId="synthetic-order" />);
  expect(await screen.findByRole('heading', { name: 'La reserva fue cancelada' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Pagar seña/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Actualizar estado' })).not.toBeInTheDocument();
});
