import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  createPkcePair,
  isOpaqueOrderId,
  paymentAmountMatches,
  verifyMercadoPagoWebhookSignature,
} from '@/lib/payments/security';

describe('payment security primitives', () => {
  it('generates a PKCE S256 challenge without exposing a predictable verifier', () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(crypto.createHash('sha256').update(first.verifier).digest('base64url'));
  });

  it('accepts only the exact Mercado Pago HMAC manifest', () => {
    const secret = 'synthetic-webhook-secret';
    const manifest = 'id:payment-123;request-id:req-456;ts:1720000000;';
    const signature = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    const valid = {
      secret,
      signatureHeader: `ts=1720000000,v1=${signature}`,
      requestId: 'req-456',
      dataId: 'payment-123',
    };

    expect(verifyMercadoPagoWebhookSignature(valid)).toBe(true);
    expect(verifyMercadoPagoWebhookSignature({ ...valid, dataId: 'payment-124' })).toBe(false);
    expect(verifyMercadoPagoWebhookSignature({ ...valid, secret: undefined })).toBe(false);
    expect(verifyMercadoPagoWebhookSignature({ ...valid, signatureHeader: null })).toBe(false);
  });

  it('requires opaque order references and an exact expected amount', () => {
    expect(isOpaqueOrderId('short')).toBe(false);
    expect(isOpaqueOrderId('../user-id')).toBe(false);
    expect(isOpaqueOrderId('6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ')).toBe(true);
    expect(paymentAmountMatches(4000, 4000)).toBe(true);
    expect(paymentAmountMatches(3999.99, 4000)).toBe(false);
  });
});
