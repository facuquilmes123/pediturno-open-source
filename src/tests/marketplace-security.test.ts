import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { encryptOAuthSecret, decryptOAuthSecret, marketplaceDepositUrls } from '@/lib/payments/marketplace';
import { depositAmount, depositPaymentMatches, depositsAvailable, type DepositOrder } from '@/lib/payments/deposits';
import { verifyMercadoPagoWebhookSignature } from '@/lib/payments/security';

beforeEach(() => { vi.stubEnv('MP_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64')); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('seller deposits', () => {
  it.runIf(process.env.PEDITURNO_QA_MARKETPLACE_SIMULATOR === 'true')('verifies an official QA simulator signature without booking writes', async () => {
    const readKey = process.env.PEDITURNO_QA_BRIDGE_READ;
    const sellerKey = process.env.PEDITURNO_QA_SELLER_KEY;
    const resourceId = process.env.PEDITURNO_QA_SIMULATOR_RESOURCE_ID;
    if (!/^[A-Za-z0-9_-]{43}$/.test(readKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(sellerKey || '') || !/^\d{1,32}$/.test(resourceId || '')) {
      throw new Error('Simulador Marketplace QA sin configurar');
    }
    const response = await fetch('http://127.0.0.1:48173/qa/mercadopago/firma-simulador', {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${sellerKey}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Primero cargá la firma de Webhooks de la aplicación ficticia');
    const { signatureSecret } = await response.json();
    if (typeof signatureSecret !== 'string' || signatureSecret.length < 16) throw new Error('Firma de QA no disponible');
    const { verifyQaSimulatorNotice } = createRequire(import.meta.url)('../../output/mp-marketplace-ficticio-20261117/dispatch-qa-webhook.cjs');
    console.info('Escuchando al simulador oficial para el recurso QA seleccionado.');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const result = await verifyQaSimulatorNotice({ readKey, resourceId, verifySignature: (notice: Omit<Parameters<typeof verifyMercadoPagoWebhookSignature>[0], 'secret'>) =>
        verifyMercadoPagoWebhookSignature({ ...notice, secret: signatureSecret }) });
      if (result.confirmed > 0) return;
      await delay(850);
    }
    throw new Error('No se recibió una firma oficial válida para el recurso elegido');
  }, 140_000);

  it('keeps production destinations unchanged without the QA capability', () => {
    vi.stubEnv('PEDITURNO_QA_MARKETPLACE_WRITE', undefined);
    expect(marketplaceDepositUrls('qa-order')).toEqual({
      notification: 'https://pediturno.com/api/webhooks/mercadopago/marketplace?order=qa-order',
      returnTo: 'https://pediturno.com/pago/qa-order',
    });
  });
  it('allows the isolated QA destination only with the emulator and fictitious marketplace', () => {
    const key = 'q'.repeat(43);
    vi.stubEnv('PEDITURNO_QA_MARKETPLACE_WRITE', key);
    vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-pediturno-mp-qa');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
    vi.stubEnv('MP_MARKETPLACE_APP_ID', '387052224556910');
    const urls = marketplaceDepositUrls('qa-order');
    expect(urls.notification).toBe(`https://essential-mediumvioletred-lark-44.hostingersite.com/qa/${key}/api/webhooks/mercadopago/marketplace?order=qa-order`);
    expect(urls.returnTo).toBe('https://essential-mediumvioletred-lark-44.hostingersite.com/pago/qa-order');
    for (const [environment, incompatible] of [
      ['MP_MARKETPLACE_APP_ID', '1234567890123456'],
      ['FIREBASE_PROJECT_ID', 'pediturno-app'],
      ['FIRESTORE_EMULATOR_HOST', undefined],
      ['NODE_ENV', 'production'],
    ] as const) {
      const original = process.env[environment];
      vi.stubEnv(environment, incompatible);
      expect(() => marketplaceDepositUrls('qa-order')).toThrow('Marketplace QA destination unavailable');
      vi.stubEnv(environment, original);
    }
  });
  it('encrypts seller secrets and rejects modified ciphertext', () => {
    const value = encryptOAuthSecret('synthetic-seller-token');
    expect(value.ciphertext).not.toContain('synthetic-seller-token');
    expect(decryptOAuthSecret(value)).toBe('synthetic-seller-token');
    expect(() => decryptOAuthSecret({ ...value, tag: Buffer.alloc(16).toString('base64') })).toThrow();
  });
  it('requires server-side activation and configuration', () => {
    vi.stubEnv('MP_MARKETPLACE_ENABLED', 'false');
    expect(depositsAvailable()).toBe(false);
  });
  it('computes fixed and percentage deposits from persisted prices', () => {
    expect(depositAmount(1000, { depositType: 'percentage', depositValue: 30 })).toBe(300);
    expect(depositAmount(1000, { depositType: 'fixed', depositValue: 400 })).toBe(400);
    expect(() => depositAmount(1000, { depositType: 'fixed', depositValue: 1001 })).toThrow();
    expect(() => depositAmount(1000, { depositType: 'percentage', depositValue: 101 })).toThrow();
    expect(() => depositAmount(0, { depositType: 'percentage', depositValue: 30 })).toThrow();
  });
  it('rejects another seller, currency, mode or amount despite a matching reference', () => {
    const order = { collectorId: '123', amount: 300, currency: 'ARS', expectedLiveMode: false } as DepositOrder;
    const payment = { id: '10', status: 'approved', external_reference: 'opaque-order', collector_id: '123', currency_id: 'ARS', transaction_amount: 300, live_mode: false };
    expect(depositPaymentMatches(payment, 'opaque-order', order)).toBe(true);
    for (const spoof of [{ collector_id: '999' }, { currency_id: 'USD' }, { transaction_amount: 299 }, { live_mode: true }, { external_reference: 'other' }]) {
      expect(depositPaymentMatches({ ...payment, ...spoof }, 'opaque-order', order)).toBe(false);
    }
  });
});
