import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeTimestamp {
  constructor(private readonly value: number) {}
  toMillis() { return this.value; }
  toDate() { return new Date(this.value); }
  static fromMillis(value: number) { return new FakeTimestamp(value); }
}

const preferenceCreate = vi.fn();
const preferenceGet = vi.fn();
const orderWrites: Array<{ path: string; value: Record<string, unknown> }> = [];
let preferenceDocs: Record<string, Record<string, unknown> | undefined> = {};

vi.mock('mercadopago', () => ({
  default: class MercadoPagoConfig {},
  Payment: class Payment {},
  Preference: class Preference { create = preferenceCreate; get = preferenceGet; },
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => 'DELETE' },
  Timestamp: FakeTimestamp,
}));
vi.mock('@/lib/payments/auth', () => ({ requireFirebaseUser: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  getAdminFirestore: () => ({
    runTransaction: async (callback: (transaction: any) => Promise<unknown>) => callback({
      get: async (documentRef: { path: string }) => {
        const data = preferenceDocs[documentRef.path];
        return { exists: !!data, data: () => data, get: (field: string) => data?.[field] };
      },
      create: (documentRef: { path: string }, value: Record<string, unknown>) => { preferenceDocs[documentRef.path] = value; orderWrites.push({ path: documentRef.path, value }); },
      set: (documentRef: { path: string }, value: Record<string, unknown>) => { preferenceDocs[documentRef.path] = value; orderWrites.push({ path: documentRef.path, value }); },
      delete: (documentRef: { path: string }) => { delete preferenceDocs[documentRef.path]; },
    }),
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        create: async (value: Record<string, unknown>) => { orderWrites.push({ path: `${name}/${id}`, value }); },
        update: async (value: Record<string, unknown>) => { orderWrites.push({ path: `${name}/${id}`, value }); },
      }),
    }),
  }),
}));

describe('membership payment preference', () => {
  // Transform the server dependency graph during suite setup, outside per-case timeouts.
  // Every case still resets modules and installs its own synthetic provider configuration.
  beforeAll(async () => { await import('@/services/mercadopago'); });
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T18:00:00.000Z'));
    orderWrites.length = 0;
    preferenceDocs = { 'businesses/business-a': { status: 'active', businessType: 'sports_facility', membership: { type: 'trial' } } };
    preferenceCreate.mockReset();
    preferenceGet.mockReset();
    preferenceCreate.mockResolvedValue({ id: 'preference-123', init_point: 'https://checkout.example/pay' });
    preferenceGet.mockImplementation(({ preferenceId }: { preferenceId: string }) => {
      const body = preferenceCreate.mock.calls.at(-1)?.[0]?.body;
      return {
        id: preferenceId, init_point: 'https://checkout.example/pay', client_id: '98765', collector_id: 12345,
        external_reference: body?.external_reference, items: body?.items, marketplace_fee: 0,
        notification_url: body?.notification_url,
      };
    });
    process.env.MP_ACCESS_TOKEN = 'TEST-synthetic';
    process.env.MP_COLLECTOR_ID = '12345';
    process.env.MP_PAYMENTS_ENABLED = 'true';
    process.env.MP_PLATFORM_APPLICATION_ID = '98765';
    process.env.MP_WEBHOOK_SECRET = 'synthetic-webhook-secret';
    const { requireFirebaseUser } = await import('@/lib/payments/auth');
    vi.mocked(requireFirebaseUser).mockResolvedValue({ uid: 'business-a', email: 'owner@example.com' } as never);
  });

  it('expires the Mercado Pago checkout when the internal order expires', async () => {
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: true });

    const request = preferenceCreate.mock.calls[0][0].body;
    expect(request.expires).toBe(true);
    expect(request.expiration_date_from).toBe('2026-09-24T18:00:00.000Z');
    expect(request.expiration_date_to).toBe('2026-09-24T18:30:00.000Z');
    expect(orderWrites[0].value.expiresAt).toBeInstanceOf(FakeTimestamp);
    expect(orderWrites[0].value).toMatchObject({
      amount: 10000,
      currency: 'ARS',
      plan: 'monthly_membership',
      vertical: 'sports_facility',
    });
    expect(request.items[0].unit_price).toBe(10000);
    expect(request.items[0]).toMatchObject({
      title: 'Suscripción mensual a Pediturno Canchas',
      description: 'Acceso por 1 mes a Pediturno Canchas para gestionar reservas deportivas.',
    });
    expect(request.back_urls).toEqual({
      success: 'https://canchas.pediturno.com/dashboard/membresia?status=approved',
      failure: 'https://canchas.pediturno.com/dashboard/membresia?status=failure',
      pending: 'https://canchas.pediturno.com/dashboard/membresia?status=pending',
    });
    expect(request.notification_url).toBe('https://pediturno.com/api/webhooks/mercadopago');
  });

  it('uses the server-side sports vertical price and ignores a spoofed client amount', async () => {
    preferenceDocs = {
      'businesses/business-a': { status: 'active', businessType: 'sports_facility', membership: { type: 'trial' } },
    };
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect((createPaymentPreference as any)({
      idToken: 'synthetic-token', amount: 1, businessType: 'services', currency: 'USD',
    })).resolves.toMatchObject({ success: true });

    expect(orderWrites[0].value).toMatchObject({
      amount: 10000,
      currency: 'ARS',
      plan: 'monthly_membership',
      vertical: 'sports_facility',
    });
    expect(preferenceCreate.mock.calls[0][0].body.items[0].unit_price).toBe(10000);
    expect(preferenceCreate.mock.calls[0][0].body.items[0].currency_id).toBe('ARS');
    expect(preferenceCreate.mock.calls[0][0].body.items[0]).toMatchObject({
      title: 'Suscripción mensual a Pediturno Canchas',
      description: 'Acceso por 1 mes a Pediturno Canchas para gestionar reservas deportivas.',
    });
    expect(preferenceCreate.mock.calls[0][0].body.back_urls).toEqual({
      success: 'https://canchas.pediturno.com/dashboard/membresia?status=approved',
      failure: 'https://canchas.pediturno.com/dashboard/membresia?status=failure',
      pending: 'https://canchas.pediturno.com/dashboard/membresia?status=pending',
    });
  });

  it.each(['services', undefined])('rejects new Mercado Pago Services memberships (%s) before contacting the provider', async businessType => {
    preferenceDocs = { 'businesses/business-a': { status: 'active', businessType, membership: { type: 'pro', expiresAt: FakeTimestamp.fromMillis(Date.now() + 86400000) } } };
    const before = preferenceDocs['businesses/business-a']?.membership;
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false, message: expect.stringContaining('Google Play') });
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(orderWrites).toEqual([]);
    expect(preferenceDocs['businesses/business-a']?.membership).toEqual(before);
  });

  it('uses the server-side spaces price and checkout origin', async () => {
    preferenceDocs = {
      'businesses/business-a': { status: 'active', businessType: 'spaces', membership: { type: 'trial' } },
    };
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect((createPaymentPreference as any)({
      idToken: 'synthetic-token', amount: 1, businessType: 'services', currency: 'USD',
    })).resolves.toMatchObject({ success: true });

    expect(orderWrites[0].value).toMatchObject({ amount: 15000, currency: 'ARS', vertical: 'spaces' });
    expect(preferenceCreate.mock.calls[0][0].body.items[0]).toMatchObject({
      title: 'Suscripción mensual a Pediturno Espacios', unit_price: 15000,
    });
    expect(preferenceCreate.mock.calls[0][0].body.back_urls.success).toBe('https://espacios.pediturno.com/dashboard/membresia?status=approved');
  });

  it('keeps the amount of an already-issued order when retrying its checkout', async () => {
    const createdAt = FakeTimestamp.fromMillis(Date.now());
    const existingOrder = {
      kind: 'membership', businessId: 'business-a', amount: 4000, currency: 'ARS',
      collectorId: '12345', applicationId: '98765', expectedLiveMode: false,
      status: 'pending', preferenceCreateKey: '00000000-0000-4000-8000-000000000000',
      createdAt, expiresAt: FakeTimestamp.fromMillis(Date.now() + 60_000),
    };
    preferenceDocs = {
      'businesses/business-a': { status: 'active', businessType: 'sports_facility', membership: { type: 'trial' } },
      'membershipPaymentOrderLocks/business-a': { orderId: 'existing-order', expiresAt: existingOrder.expiresAt },
      'paymentOrders/existing-order': existingOrder,
    };
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: true });

    expect(preferenceCreate.mock.calls[0][0].body.items[0].unit_price).toBe(4000);
    expect(preferenceCreate.mock.calls[0][0].body.back_urls.success).toBe('https://canchas.pediturno.com/dashboard/membresia?status=approved');
    expect(orderWrites.filter(write => write.path === 'paymentOrders/existing-order' && write.value.amount !== undefined)).toEqual([]);
  });

  it('fails closed before creating an internal order when payment reconciliation is disabled', async () => {
    process.env.MP_PAYMENTS_ENABLED = 'false';
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(orderWrites).toEqual([]);
  });

  it('does not return a checkout link without a preference ID to reconcile', async () => {
    preferenceCreate.mockResolvedValueOnce({ init_point: 'https://checkout.example/pay' });
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });
    expect(orderWrites.some(write => write.value.preferenceId)).toBe(false);
  });

  it('does not expose a checkout created by different application credentials', async () => {
    preferenceGet.mockResolvedValueOnce({
      id: 'preference-123', init_point: 'https://checkout.example/pay', client_id: 'wrong-app', collector_id: 12345,
    });
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });
    expect(preferenceCreate).toHaveBeenCalledTimes(1);
    expect(orderWrites.some(write => write.value.preferenceId)).toBe(false);
  });

  it('retries an ambiguous preference creation with the same provider idempotency key', async () => {
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: true });
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: true });
    expect(preferenceCreate).toHaveBeenCalledTimes(2);
    const firstKey = preferenceCreate.mock.calls[0][0].requestOptions.idempotencyKey;
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(preferenceCreate.mock.calls[1][0].requestOptions.idempotencyKey).toBe(firstKey);
    expect(orderWrites.filter(write => write.path.startsWith('paymentOrders/'))).toHaveLength(3);
  });

  it('keeps an uncertain provider create attempt recoverable instead of releasing its lock', async () => {
    preferenceCreate.mockRejectedValueOnce(new Error('request timed out'));
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });

    const orderUpdate = orderWrites.find(write => write.path.startsWith('paymentOrders/') && write.value.status === 'preference_create_uncertain');
    expect(orderUpdate?.value.preferenceCreateFailureRecordedAt).toBe('SERVER_TIMESTAMP');
    expect(Object.keys(preferenceDocs).some(path => path.startsWith('membershipPaymentOrderLocks/'))).toBe(true);
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: true });
    expect(preferenceCreate.mock.calls[1][0].requestOptions.idempotencyKey).toBe(preferenceCreate.mock.calls[0][0].requestOptions.idempotencyKey);
  });

  it.each([
    ['missing business', undefined],
    ['lifetime membership', { status: 'active', membership: { type: 'lifetime' } }],
    ['blocked business', { status: 'blocked', membership: { type: 'trial' } }],
  ])('does not create a checkout for %s', async (_label, business) => {
    preferenceDocs = business ? { 'businesses/business-a': business } : {};
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(orderWrites).toEqual([]);
  });

  it('does not charge an administrator with a persisted lifetime membership', async () => {
    preferenceDocs = { 'businesses/business-a': { status: 'active', membership: { type: 'lifetime' } } };
    const { requireFirebaseUser } = await import('@/lib/payments/auth');
    vi.mocked(requireFirebaseUser).mockResolvedValueOnce({ uid: 'business-a', email: 'admin@example.com' } as never);
    const { createPaymentPreference } = await import('@/services/mercadopago');
    await expect(createPaymentPreference({ idToken: 'synthetic-token' })).resolves.toMatchObject({ success: false });
    expect(preferenceCreate).not.toHaveBeenCalled();
    expect(orderWrites).toEqual([]);
  });
});
