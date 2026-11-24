import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { processWebhookNotificationAdmin, verifyMercadoPagoWebhookSignature } = vi.hoisted(() => ({
  processWebhookNotificationAdmin: vi.fn(),
  verifyMercadoPagoWebhookSignature: vi.fn(),
}));

vi.mock('@/services/mercadopago', () => ({ processWebhookNotificationAdmin }));
vi.mock('@/lib/payments/security', () => ({ verifyMercadoPagoWebhookSignature }));

import { POST } from '@/app/api/webhooks/mercadopago/route';

describe('Mercado Pago webhook failure path', () => {
  it('returns a retryable error if fulfillment fails after provider confirmation', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    verifyMercadoPagoWebhookSignature.mockReturnValue(true);
    processWebhookNotificationAdmin.mockRejectedValueOnce(new Error('Synthetic Firestore failure'));
    const request = new NextRequest('https://pediturno.test/api/webhooks/mercadopago', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': 'synthetic', 'x-request-id': 'request-synthetic' },
      body: JSON.stringify({ type: 'payment', data: { id: 'payment-synthetic' } }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Processing failed' });
    expect(processWebhookNotificationAdmin).toHaveBeenCalledOnce();
    expect(processWebhookNotificationAdmin).toHaveBeenCalledWith('payment-synthetic');
    errorLog.mockRestore();
  });

  it('reconciles a signed Checkout Pro chargeback using its payment ID, not its case ID', async () => {
    verifyMercadoPagoWebhookSignature.mockReturnValue(true);
    processWebhookNotificationAdmin.mockResolvedValueOnce({ processed: true });
    const request = new NextRequest('https://pediturno.test/api/webhooks/mercadopago?data.id=CASE123&type=topic_chargebacks_wh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': 'synthetic', 'x-request-id': 'request-synthetic' },
      body: JSON.stringify({ type: 'topic_chargebacks_wh', data: { id: 'CASE123', payment_id: 987654 } }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(verifyMercadoPagoWebhookSignature).toHaveBeenCalledWith(expect.objectContaining({ dataId: 'case123' }));
    expect(processWebhookNotificationAdmin).toHaveBeenCalledWith('987654');
  });

  it('rejects an unsigned chargeback without fetching a payment', async () => {
    processWebhookNotificationAdmin.mockClear();
    verifyMercadoPagoWebhookSignature.mockReturnValue(false);
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = new NextRequest('https://pediturno.test/api/webhooks/mercadopago', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'topic_chargebacks_wh', data: { id: 'case-123', payment_id: 987654 } }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(processWebhookNotificationAdmin).not.toHaveBeenCalled();
    warningLog.mockRestore();
  });
});
