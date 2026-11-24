import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ db: vi.fn(), request: vi.fn(), seller: vi.fn(), delivery: vi.fn(), uid: 'owner' }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db, initializeAdminApp: vi.fn() }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: mocks.delivery }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: vi.fn(async () => ({ uid: mocks.uid })) }) }));
vi.mock('@/lib/payments/marketplace', async () => ({ ...await vi.importActual<typeof import('@/lib/payments/marketplace')>('@/lib/payments/marketplace'), getSellerConnection: mocks.seller, mercadoPagoRequest: mocks.request }));
import { POST as book } from '@/app/api/public/bookings/route';
import { POST as updateStatus } from '@/app/api/owner/appointments/[appointmentId]/status/route';
import { processDepositPayment, expireDepositHolds, ensureDepositCheckout } from '@/lib/payments/deposits';
import { GET as depositState, POST as openDeposit } from '@/app/api/public/deposits/[orderId]/route';
import { POST as receiveMarketplaceWebhook } from '@/app/api/webhooks/mercadopago/marketplace/route';

let app: App; let db: Firestore;
let providerBody: Record<string, any>;
let payment: Record<string, any>;
let merchant: Record<string, any>;
let preferenceApplicationId: string;
const environment: Record<string, string> = {
  MP_MARKETPLACE_APP_ID: '123', MP_MARKETPLACE_CLIENT_SECRET: 'synthetic-secret', MP_MARKETPLACE_REDIRECT_URI: 'https://pediturno.com/api/auth/mercadopago/callback',
  MP_MARKETPLACE_ENABLED: 'true', MP_MARKETPLACE_WEBHOOK_SECRET: 'synthetic-signature', MP_MARKETPLACE_EXPECT_LIVE_MODE: 'false',
  BOOKING_CAPABILITY_OUTBOX_KEY: Buffer.alloc(32, 9).toString('base64'), ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS: 'true',
};
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required');
  const providerQa = process.env.PEDITURNO_QA_MARKETPLACE_PROVIDER === 'true';
  if (providerQa && process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('El ensayo con proveedor exige el emulador local');
  const refundQa = process.env.PEDITURNO_QA_MARKETPLACE_REFUND_READ === 'true';
  if (refundQa && !/^127\.0\.0\.1:\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('El ensayo de reembolso exige Firestore en loopback');
  app = initializeApp({ projectId: providerQa || refundQa ? 'demo-pediturno-mp-qa' : 'pediturno-deposits-it' }, 'deposits-it'); db = getFirestore(app);
});
beforeEach(async () => {
  for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
  Object.entries(environment).forEach(([key, value]) => vi.stubEnv(key, value));
  mocks.db.mockReturnValue(db);
  mocks.seller.mockResolvedValue({ merchantUserId: '555', accessToken: 'synthetic', liveMode: false });
  providerBody = {}; payment = {}; merchant = {}; preferenceApplicationId = '123';
  mocks.request.mockImplementation(async (path: string, _token: string, init?: RequestInit) => {
    if (path === '/checkout/preferences') { providerBody = JSON.parse(init!.body as string); return { id: 'preference' }; }
    if (path.startsWith('/checkout/preferences/')) return { ...providerBody, id: 'preference', collector_id: 555, client_id: preferenceApplicationId, sandbox_init_point: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=preference' };
    if (path.startsWith('/v1/payments/search')) return { results: payment.id ? [{ id: payment.id, status: payment.status }] : [] };
    if (path.startsWith('/v1/payments/')) return payment;
    if (path.startsWith('/merchant_orders/')) return merchant;
    throw new Error('Unexpected provider request');
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); });

async function reserve(kind: 'service' | 'cancha' | 'space' = 'cancha', serviceBusinessType: 'services' | 'hybrid' = 'services', providerQa = false) {
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + 3 * 86400000));
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  await db.doc('businesses/owner').set({ name: 'Negocio', slug: 'negocio', status: 'active', businessType: kind === 'space' ? 'spaces' : kind === 'cancha' ? 'sports_facility' : serviceBusinessType, membership: { type: 'lifetime' }, bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 0, bookingHorizonDays: 30 }, mercadopago: { isConnected: true, requireDeposit: true, depositType: 'percentage', depositValue: 30 } });
  await db.doc(`${kind === 'space' ? 'spaces' : kind === 'cancha' ? 'canchas' : 'services'}/resource`).set({ name: 'Recurso', category: 'salon', businessId: 'owner', status: 'Activo', duration: kind === 'service' ? '60' : 60, price: providerQa ? '3000' : '1000', packages: [{ durationMinutes: 240, price: '1000' }], workingHours: { [day]: { slots: [{ start: kind === 'space' ? '00:00' : '09:00', end: kind === 'space' ? '00:00' : '18:00' }] } } });
  const response = await book(new Request('https://pediturno.test/api/public/bookings', { method: 'POST', body: JSON.stringify({ businessId: 'owner', [`${kind}Id`]: 'resource', ...(kind === 'space' ? { durationMinutes: 240 } : {}), dateKey, time: '10:00', client: 'Prueba Cliente', clientPhone: '11111111', clientEmail: providerQa ? 'test_user_1334667666@testuser.com' : 'test@example.invalid', idempotencyKey: 'synthetic-booking-idempotency-key' }) }) as never);
  expect(response.status, providerQa ? 'Reserva QA sin detalles privados' : await response.clone().text()).toBe(201);
  const data = await response.json();
  const order = (await db.doc(`depositOrders/${data.depositOrderId}`).get()).data()!;
  payment = { id: '42', status: 'approved', transaction_amount: 300, currency_id: 'ARS', collector_id: 555, live_mode: false, external_reference: data.depositOrderId, order: { id: '20' }, date_approved: new Date().toISOString() };
  merchant = { preference_id: 'preference', external_reference: data.depositOrderId, application_id: 123, collector: { id: 555 }, payments: [{ id: 42 }] };
  return { ...data, order };
}

async function historicalServiceDeposit() {
  // Create the real hold graph through an enabled vertical, then represent a
  // pre-V1 Services order. No feature gate is mocked or enabled for Services.
  const result = await reserve('service', 'hybrid');
  await db.doc('businesses/owner').update({ businessType: 'services', membership: { type: 'free' } });
  mocks.request.mockClear(); mocks.seller.mockClear();
  return result;
}

describe('deposit booking transactions', () => {
  it.runIf(process.env.PEDITURNO_QA_MARKETPLACE_REFUND_READ === 'true')('reconciles the existing fictitious refund from provider reads only', async () => {
    const sellerKey = process.env.PEDITURNO_QA_SELLER_KEY;
    if (!/^[A-Za-z0-9_-]{43}$/.test(sellerKey || '')) throw new Error('Falta la capacidad del receptor local');
    console.info('Esperando sesión local del vendedor ficticio para una consulta de sólo lectura.');
    let session: Response | undefined;
    for (let attempt = 0; attempt < 75; attempt++) {
      session = await fetch('http://127.0.0.1:48173/qa/mercadopago/sesion-vendedor', { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${sellerKey}` }, signal: AbortSignal.timeout(5000) });
      if (session.ok || session.status !== 404) break;
      await delay(1600);
    }
    if (!session?.ok) throw new Error('Sesión ficticia no disponible');
    const seller = await session.json();
    const sellerId = '3657382624', appId = '387052224556910', paymentId = '189172277511';
    const preferenceId = '3657382624-c1a39a21-2e85-4252-a3fb-caa88e3b9ea6';
    if (seller.merchantUserId !== sellerId || seller.liveMode !== true || typeof seller.accessToken !== 'string') throw new Error('Sesión de vendedor incompatible');
    const actual = await vi.importActual<typeof import('@/lib/payments/marketplace')>('@/lib/payments/marketplace');
    const profile = await actual.mercadoPagoRequest<{ id: number; site_id: string; tags: string[] }>('/users/me', seller.accessToken);
    if (String(profile.id) !== sellerId || profile.site_id !== 'MLA' || !profile.tags?.includes('test_user')) throw new Error('El proveedor no confirmó un usuario ficticio');
    const preferencePath = `/checkout/preferences/${preferenceId}`;
    const paymentPath = `/v1/payments/${paymentId}`;
    const preference = await actual.mercadoPagoRequest<{ id: string; client_id: string | number; collector_id: number; external_reference: string }>(preferencePath, seller.accessToken);
    const payment = await actual.mercadoPagoRequest<{ id: number; external_reference: string; collector_id: number; currency_id: string; live_mode: boolean; transaction_amount: number; transaction_amount_refunded: number; status: string; order?: { id: string | number } }>(paymentPath, seller.accessToken);
    const orderId = preference.external_reference;
    const merchantId = String(payment.order?.id || '');
    if (preference.id !== preferenceId || String(preference.client_id) !== appId || String(preference.collector_id) !== sellerId ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(orderId) || payment.external_reference !== orderId || String(payment.id) !== paymentId ||
        String(payment.collector_id) !== sellerId || payment.currency_id !== 'ARS' || payment.live_mode !== true ||
        payment.transaction_amount !== 900 || payment.transaction_amount_refunded !== 900 || payment.status !== 'refunded' ||
        !/^\d{1,32}$/.test(merchantId)) throw new Error('El pago histórico no coincide con la prueba autorizada');

    const allowedReads = new Set([paymentPath, preferencePath, `/merchant_orders/${merchantId}`]);
    mocks.seller.mockResolvedValue({ accessToken: seller.accessToken, merchantUserId: sellerId, liveMode: true });
    mocks.request.mockImplementation((path: string, token: string, init?: RequestInit) => {
      if (token !== seller.accessToken || init !== undefined || !allowedReads.has(path)) throw new Error('Consulta ajena al reembolso ficticio');
      return actual.mercadoPagoRequest(path, token);
    });
    const appointment = db.doc('appointments/qa-existing-refund');
    await db.doc(`depositOrders/${orderId}`).set({ kind: 'deposit', businessId: 'qa-refund-owner', appointmentId: appointment.id,
      preferenceId, collectorId: sellerId, applicationId: appId, amount: 900, currency: 'ARS', expectedLiveMode: true, status: 'approved', paymentId });
    await appointment.set({ businessId: 'qa-refund-owner', paymentStatus: 'paid', status: 'Confirmado', depositPaid: 900 });
    expect(await processDepositPayment(paymentId, orderId)).toMatchObject({ processed: true });
    expect((await appointment.get()).data()).toMatchObject({ status: 'Confirmado', paymentStatus: 'reversal_review', paymentReviewRequired: true });
    expect((await db.doc(`depositPayments/${paymentId}`).get()).data()).toMatchObject({ status: 'reversed', providerStatus: 'refunded', amountRefunded: 900 });
    expect(await processDepositPayment(paymentId, orderId)).toMatchObject({ duplicate: true });
    expect(mocks.delivery).not.toHaveBeenCalled();
  }, 175_000);

  it.runIf(process.env.PEDITURNO_QA_MARKETPLACE_PROVIDER === 'true')('reconciles an official Marketplace QA payment and refund', async () => {
    const readKey = process.env.PEDITURNO_QA_BRIDGE_READ;
    const writeKey = process.env.PEDITURNO_QA_BRIDGE_WRITE;
    const sellerKey = process.env.PEDITURNO_QA_SELLER_KEY;
    if (!/^[A-Za-z0-9_-]{43}$/.test(readKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(writeKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(sellerKey || '') ||
        process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Entorno Marketplace QA incompleto');
    const { dispatchQaWebhooks } = createRequire(import.meta.url)('../../output/mp-marketplace-ficticio-20261117/dispatch-qa-webhook.cjs');
    const session = await fetch('http://127.0.0.1:48173/qa/mercadopago/sesion-vendedor', { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${sellerKey}` }, signal: AbortSignal.timeout(5000) });
    if (!session.ok) throw new Error('Primero completá el OAuth y la firma de Webhooks de prueba');
    const seller = await session.json();
    if (seller.merchantUserId !== '3657382624' || typeof seller.liveMode !== 'boolean' || typeof seller.accessToken !== 'string' ||
        typeof seller.webhookSecret !== 'string' || seller.webhookSecret.length < 16) {
      throw new Error('Vendedor QA incompatible');
    }
    const actual = await vi.importActual<typeof import('@/lib/payments/marketplace')>('@/lib/payments/marketplace');
    const profile = await actual.mercadoPagoRequest<{ id: number; site_id: string; tags: string[] }>('/users/me', seller.accessToken);
    if (String(profile.id) !== seller.merchantUserId || profile.site_id !== 'MLA' || !profile.tags?.includes('test_user')) {
      throw new Error('Mercado Pago no confirmó que el vendedor sea ficticio');
    }
    vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-pediturno-mp-qa');
    vi.stubEnv('PEDITURNO_QA_MARKETPLACE_WRITE', writeKey);
    vi.stubEnv('MP_MARKETPLACE_APP_ID', '387052224556910');
    vi.stubEnv('MP_MARKETPLACE_EXPECT_LIVE_MODE', String(seller.liveMode));
    vi.stubEnv('MP_MARKETPLACE_WEBHOOK_SECRET', seller.webhookSecret);
    mocks.seller.mockResolvedValue({ accessToken: seller.accessToken, merchantUserId: seller.merchantUserId, liveMode: seller.liveMode });
    mocks.request.mockImplementation((path: string, accessToken: string, init?: RequestInit) => {
      const preferenceWrite = path === '/checkout/preferences' && init?.method === 'POST';
      if (accessToken !== seller.accessToken || !preferenceWrite && !(init?.method === undefined && /^\/(?:checkout\/preferences|v1\/payments|merchant_orders)\/[\w-]+$/.test(path))) {
        throw new Error('Operación fuera del ensayo de Mercado Pago');
      }
      return actual.mercadoPagoRequest(path, accessToken, init);
    });
    const result = await reserve('service', 'hybrid', true);
    if (!result.checkoutUrl || result.order.applicationId !== '387052224556910' || result.order.collectorId !== seller.merchantUserId ||
        result.order.amount !== 900 || result.order.currency !== 'ARS') throw new Error('Mercado Pago no confirmó la preferencia de QA');
    console.info(`Checkout para Buyer Test User exclusivamente: ${result.checkoutUrl}`);
    const appointment = db.doc(`appointments/${result.id}`);
    const advance = async (expected: string) => {
      const deadline = Date.now() + 180_000;
      let acknowledgements = 0;
      while (Date.now() < deadline) {
        const settled = await dispatchQaWebhooks({ readKey, orderId: result.depositOrderId,
          processNotice: (notice: Request) => receiveMarketplaceWebhook(new NextRequest(notice)) });
        acknowledgements += settled.confirmed;
        if (acknowledgements && (await appointment.get()).get('paymentStatus') === expected) return;
        await delay(1800);
      }
      throw new Error(`No se observó una notificación oficial conciliada para ${expected}`);
    };
    await advance('paid');
    expect((await appointment.get()).get('depositPaid')).toBe(900);
    console.info('Seña QA acreditada por aviso oficial. Lista para devolución desde el vendedor ficticio.');
    await advance('reversal_review');
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  }, 400_000);

  it.runIf(process.env.PEDITURNO_QA_BRIDGE_SMOKE === 'true')('settles an isolated booking through the deployed QA bridge', async () => {
    const site = 'https://essential-mediumvioletred-lark-44.hostingersite.com';
    const writeKey = process.env.PEDITURNO_QA_BRIDGE_WRITE;
    const readKey = process.env.PEDITURNO_QA_BRIDGE_READ;
    if (!/^[A-Za-z0-9_-]{43}$/.test(writeKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(readKey || '') ||
        process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Puente QA y emulador local requeridos');
    const { dispatchQaWebhooks } = createRequire(import.meta.url)('../../output/mp-marketplace-ficticio-20261117/dispatch-qa-webhook.cjs');
    const result = await reserve('service', 'hybrid');
    const publish = async (label: string) => {
      const requestId = `synthetic-${label}-${result.depositOrderId}`;
      const ts = String(Date.now());
      const signature = createHmac('sha256', environment.MP_MARKETPLACE_WEBHOOK_SECRET)
        .update(`id:42;request-id:${requestId};ts:${ts};`).digest('hex');
      const url = new URL(`/qa/${writeKey}/api/webhooks/mercadopago/marketplace`, site);
      url.searchParams.set('order', result.depositOrderId);
      url.searchParams.set('data.id', '42');
      const send = () => fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(18_000),
        headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` },
        body: JSON.stringify({ type: 'payment', data: { id: '42' }, user_id: 3657382624 }) });
      const providerResponse = send().catch(() => null);
      let resultFromBridge = { confirmed: 0, pending: 0 };
      for (let attempt = 0; attempt < 12; attempt++) {
        resultFromBridge = await dispatchQaWebhooks({ readKey, orderId: result.depositOrderId,
          processNotice: (notice: Request) => receiveMarketplaceWebhook(new NextRequest(notice)) });
        if (resultFromBridge.confirmed || resultFromBridge.pending) break;
        await delay(200);
      }
      expect(resultFromBridge).toEqual({ confirmed: 1, pending: 0 });
      expect((await providerResponse)?.status).toBe(200);
      expect((await send()).status).toBe(200);
    };
    await publish('approved');
    expect((await db.doc(`appointments/${result.id}`).get()).data()).toMatchObject({ status: 'Confirmado', paymentStatus: 'paid', depositPaid: 300 });
    payment.status = 'refunded';
    payment.transaction_amount_refunded = 300;
    await publish('refunded');
    expect((await db.doc('depositPayments/42').get()).get('status')).toBe('reversed');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('reversal_review');
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  }, 55_000);

  it('settles a booking through the signed webhook and records a reversal without duplicate delivery', async () => {
    const result = await reserve('service', 'hybrid');
    const send = (requestId: string, correctlySigned = true) => {
      const ts = String(Date.now());
      const signature = createHmac('sha256', environment.MP_MARKETPLACE_WEBHOOK_SECRET)
        .update(`id:42;request-id:${requestId};ts:${ts};`).digest('hex');
      const url = new URL(providerBody.notification_url as string);
      url.searchParams.set('data.id', '42');
      return receiveMarketplaceWebhook(new NextRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': requestId,
          'x-signature': `ts=${ts},v1=${correctlySigned ? signature : '0'.repeat(64)}` },
        body: JSON.stringify({ type: 'payment', data: { id: '42' }, user_id: 555 }),
      }));
    };
    const appointment = db.doc(`appointments/${result.id}`);

    expect((await send('forged', false)).status).toBe(401);
    expect((await appointment.get()).get('paymentStatus')).toBe('pending');
    payment.currency_id = 'USD';
    expect((await send('wrong-currency')).status).toBe(503);
    expect((await appointment.get()).get('paymentStatus')).toBe('pending');
    expect((await db.doc('depositPayments/42').get()).exists).toBe(false);

    payment.currency_id = 'ARS';
    const approval = await send('approved');
    expect(approval.status).toBe(200);
    expect(await approval.json()).toMatchObject({ processed: true });
    expect((await appointment.get()).data()).toMatchObject({ status: 'Confirmado', paymentStatus: 'paid', depositPaid: 300 });
    expect(await (await send('approved')).json()).toMatchObject({ duplicate: true });

    payment.status = 'refunded';
    payment.transaction_amount_refunded = 300;
    const refund = await send('refunded');
    expect(refund.status).toBe(200);
    expect((await db.doc('depositPayments/42').get()).data()).toMatchObject({ status: 'reversed', providerStatus: 'refunded', amountRefunded: 300 });
    expect((await appointment.get()).get('paymentStatus')).toBe('reversal_review');
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  });

  it.each(['cancha', 'space'] as const)('holds %s without sending a confirmation until the seller payment is verified', async kind => {
    const result = await reserve(kind);
    expect(result.checkoutUrl).toContain('sandbox.mercadopago.com.ar');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('pending');
    expect((await db.doc(`bookingEmailOutbox/${result.order.outboxId}`).get()).get('status')).toBe('awaiting_payment');
    expect(mocks.delivery).not.toHaveBeenCalled();
    expect((await processDepositPayment('42', result.depositOrderId)).processed).toBe(true);
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('paid');
    expect((await db.doc(`appointments/${result.id}`).get()).get('status')).toBe('Confirmado');
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
    expect((await processDepositPayment('42', result.depositOrderId)).duplicate).toBe(true);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  });
  it('rejects approval by a different MP application', async () => {
    const result = await reserve(); merchant.application_id = 999;
    await expect(processDepositPayment('42', result.depositOrderId)).rejects.toThrow('Merchant order does not match');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('pending');
  });
  it('verifies the linked preference when the merchant order omits the MP application', async () => {
    const result = await reserve(); merchant.application_id = null;
    preferenceApplicationId = '999';
    await expect(processDepositPayment('42', result.depositOrderId)).rejects.toThrow('Merchant order preference does not match');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('pending');

    preferenceApplicationId = '123';
    expect((await processDepositPayment('42', result.depositOrderId)).processed).toBe(true);
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('paid');
  });
  it('prevents manually confirming an unpaid deposit', async () => {
    const result = await reserve();
    const response = await updateStatus(new Request('https://pediturno.test/api', { method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: JSON.stringify({ status: 'Confirmado' }) }) as never, { params: Promise.resolve({ appointmentId: result.id }) });
    expect(response.status).toBe(409);
  });
  it('stops exposing a cached checkout after the owner cancels the unpaid booking', async () => {
    const result = await reserve();
    await db.doc(`appointments/${result.id}`).update({ status: 'Cancelado' });
    const params = { params: Promise.resolve({ orderId: result.depositOrderId }) };
    const response = await depositState(new Request('https://pediturno.test/api') as never, params);
    expect(await response.json()).toMatchObject({ status: 'cancelled', checkoutUrl: null });
    expect(await ensureDepositCheckout(result.depositOrderId)).toBeNull();
    const opened = await openDeposit(new Request('https://pediturno.test/api', { method: 'POST' }) as never, params);
    expect(opened.status).toBe(409);
    expect((await opened.json()).checkoutUrl ?? null).toBeNull();
  });
  it('shows an elapsed hold as expired before the expiry worker runs', async () => {
    const result = await reserve();
    await db.doc(`depositOrders/${result.depositOrderId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    const response = await depositState(new Request('https://pediturno.test/api') as never, { params: Promise.resolve({ orderId: result.depositOrderId }) });
    expect(await response.json()).toMatchObject({ status: 'expired', checkoutUrl: null });
  });
  it('keeps payment review visible for a cancelled booking with a late payment', async () => {
    const result = await reserve();
    await db.doc(`appointments/${result.id}`).update({ status: 'Cancelado' });
    await processDepositPayment('42', result.depositOrderId);
    const response = await depositState(new Request('https://pediturno.test/api') as never, { params: Promise.resolve({ orderId: result.depositOrderId }) });
    expect(await response.json()).toMatchObject({ status: 'review', checkoutUrl: null });
  });
  it('does not reopen a cached checkout when a pending booking already needs payment review', async () => {
    const result = await reserve();
    await db.doc(`depositOrders/${result.depositOrderId}`).update({ paymentReviewRequired: true });
    expect(await ensureDepositCheckout(result.depositOrderId)).toBeNull();
  });
  it('releases only expired unpaid slot holds', async () => {
    const result = await reserve(); payment = {};
    expect((await expireDepositHolds(result.order.expiresAt.toMillis() + 1)).expired).toBe(1);
    expect((await db.doc(`appointments/${result.id}`).get()).get('status')).toBe('Cancelado');
    expect((await db.collection('bookingSlots').get()).empty).toBe(true);
  });
  it('checks provider payments before expiry and preserves a timely payment with delayed webhook', async () => {
    const result = await reserve();
    expect((await expireDepositHolds(result.order.expiresAt.toMillis() + 1)).expired).toBe(0);
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('paid');
    expect((await db.collection('bookingSlots').get()).empty).toBe(false);
  });
  it('advances past failed seller checks so later holds can expire', async () => {
    const result = await reserve(); payment = {};
    for (let index = 0; index < 10; index++) await db.doc(`depositOrders/stalled-${index}`).set({ ...result.order, businessId: 'stalled', expiresAt: Timestamp.fromMillis(result.order.expiresAt.toMillis() - 1000) });
    mocks.seller.mockImplementation(async (id: string) => {
      if (id === 'stalled') throw new Error('Provider unavailable');
      return { merchantUserId: '555', accessToken: 'synthetic', liveMode: false };
    });
    expect(await expireDepositHolds(result.order.expiresAt.toMillis() + 1)).toEqual({ expired: 0, failed: 10 });
    expect(await expireDepositHolds(result.order.expiresAt.toMillis() + 1)).toEqual({ expired: 1, failed: 0 });
  });
  it('records late payment after a released hold for review instead of rebooking', async () => {
    const result = await reserve(); const approved = { ...payment }; payment = {};
    await expireDepositHolds(result.order.expiresAt.toMillis() + 1); payment = approved;
    expect((await processDepositPayment('42', result.depositOrderId)).processed).toBe(true);
    expect((await db.doc(`appointments/${result.id}`).get()).get('status')).toBe('Cancelado');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentReviewRequired')).toBe(true);
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
  it('records a refund after a late payment entered review without reopening the booking', async () => {
    const result = await reserve(); const approved = { ...payment }; payment = {};
    await expireDepositHolds(result.order.expiresAt.toMillis() + 1); payment = approved;
    await processDepositPayment('42', result.depositOrderId);
    expect((await db.doc('depositPayments/42').get()).get('status')).toBe('review');
    payment.status = 'refunded'; payment.transaction_amount_refunded = 300;
    expect(await processDepositPayment('42', result.depositOrderId)).toEqual({ processed: true });
    const receipt = await db.doc('depositPayments/42').get();
    expect(receipt.get('status')).toBe('reversed');
    expect(receipt.get('providerStatus')).toBe('refunded');
    expect(receipt.get('amountRefunded')).toBe(300);
    expect((await db.doc(`appointments/${result.id}`).get()).get('status')).toBe('Cancelado');
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentReviewRequired')).toBe(true);
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
  it('preserves the primary deposit when a secondary payment is reversed', async () => {
    const result = await reserve();
    await processDepositPayment('42', result.depositOrderId);
    payment.id = '43'; merchant.payments.push({ id: 43 });
    await processDepositPayment('43', result.depositOrderId);
    payment.status = 'charged_back';
    expect(await processDepositPayment('43', result.depositOrderId)).toEqual({ processed: true });
    expect((await db.doc('depositPayments/43').get()).get('status')).toBe('reversed');
    const order = await db.doc(`depositOrders/${result.depositOrderId}`).get();
    expect(order.get('paymentId')).toBe('42');
    expect(order.get('status')).toBe('approved');
    expect(order.get('secondaryPaymentReviewRequired')).toBe(true);
    const booking = await db.doc(`appointments/${result.id}`).get();
    expect(booking.get('paymentStatus')).toBe('paid');
    expect(booking.get('depositPaid')).toBe(300);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  });
  it('does not restore a refunded payment on a stale approval event', async () => {
    const result = await reserve(); payment.status = 'refunded'; payment.transaction_amount_refunded = 300;
    await processDepositPayment('42', result.depositOrderId);
    payment.status = 'approved'; payment.transaction_amount_refunded = 0;
    expect((await processDepositPayment('42', result.depositOrderId)).duplicate).toBe(true);
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('reversal_review');
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it('settles a historical Services deposit exactly once without granting Pro', async () => {
    const result = await historicalServiceDeposit();
    expect(await processDepositPayment('42', result.depositOrderId)).toMatchObject({ processed: true });
    expect((await db.doc(`appointments/${result.id}`).get()).data()).toMatchObject({ status: 'Confirmado', paymentStatus: 'paid', depositPaid: 300 });
    expect((await db.doc('businesses/owner').get()).get('membership')).toEqual({ type: 'free' });
    expect((await db.collection('membershipPaymentCredits').get()).empty).toBe(true);
    expect((await processDepositPayment('42', result.depositOrderId)).duplicate).toBe(true);
    expect(mocks.seller).toHaveBeenCalledWith('owner', true);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  });

  it('retains an existing Services checkout without creating a new preference or refreshing OAuth', async () => {
    const result = await historicalServiceDeposit();
    expect(await ensureDepositCheckout(result.depositOrderId)).toBe(result.checkoutUrl);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.seller).not.toHaveBeenCalled();
  });

  it('does not claim or create a missing checkout for a historical Services hold', async () => {
    const result = await historicalServiceDeposit();
    const orderRef = db.doc(`depositOrders/${result.depositOrderId}`);
    await orderRef.set({ ...result.order, status: 'pending', checkoutUrl: null, preferenceId: null });
    const before = (await orderRef.get()).data();
    expect(await ensureDepositCheckout(result.depositOrderId)).toBeNull();
    expect((await orderRef.get()).data()).toEqual(before);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.seller).not.toHaveBeenCalled();
  });

  it('records a historical Services refund for review without cancelling the appointment or changing Pro', async () => {
    const result = await historicalServiceDeposit();
    await processDepositPayment('42', result.depositOrderId);
    payment.status = 'refunded'; payment.transaction_amount_refunded = 300;
    expect(await processDepositPayment('42', result.depositOrderId)).toEqual({ processed: true });
    expect((await db.doc('depositPayments/42').get()).data()).toMatchObject({ status: 'reversed', providerStatus: 'refunded', amountRefunded: 300 });
    expect((await db.doc(`appointments/${result.id}`).get()).data()).toMatchObject({ status: 'Confirmado', paymentStatus: 'reversal_review', paymentReviewRequired: true });
    expect((await db.doc('businesses/owner').get()).get('membership')).toEqual({ type: 'free' });
    payment.status = 'approved'; payment.transaction_amount_refunded = 0;
    expect((await processDepositPayment('42', result.depositOrderId)).duplicate).toBe(true);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
  });

  it('keeps a late historical Services payment in review after the unpaid hold expired', async () => {
    const result = await historicalServiceDeposit(); const approved = { ...payment }; payment = {};
    expect((await expireDepositHolds(result.order.expiresAt.toMillis() + 1)).expired).toBe(1);
    payment = approved;
    await processDepositPayment('42', result.depositOrderId);
    expect((await db.doc(`appointments/${result.id}`).get()).data()).toMatchObject({ status: 'Cancelado', paymentStatus: 'expired', paymentReviewRequired: true });
    expect((await db.collection('bookingSlots').get()).empty).toBe(true);
    expect((await db.doc('businesses/owner').get()).get('membership')).toEqual({ type: 'free' });
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'amount', change: { transaction_amount: 1 } },
    { label: 'currency', change: { currency_id: 'USD' } },
    { label: 'collector', change: { collector_id: 999 } },
    { label: 'environment', change: { live_mode: true } },
    { label: 'reference', change: { external_reference: 'foreign_' + 'a'.repeat(24) } },
  ])('rejects a historical Services payment with mismatched $label before crediting it', async ({ change }) => {
    const result = await historicalServiceDeposit(); Object.assign(payment, change);
    await expect(processDepositPayment('42', result.depositOrderId)).rejects.toThrow('Payment does not match deposit order');
    expect((await db.doc('depositPayments/42').get()).exists).toBe(false);
    expect((await db.doc(`appointments/${result.id}`).get()).get('paymentStatus')).toBe('pending');
    expect((await db.doc('businesses/owner').get()).get('membership')).toEqual({ type: 'free' });
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
});
