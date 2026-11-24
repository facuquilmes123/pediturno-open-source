import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeTimestamp {
  constructor(private readonly value: number) {}
  toMillis() { return this.value; }
  toDate() { return new Date(this.value); }
  static fromMillis(value: number) { return new FakeTimestamp(value); }
  static fromDate(value: Date) { return new FakeTimestamp(value.getTime()); }
}

const paymentGet = vi.fn();
const merchantOrderGet = vi.fn();
const writes: Array<{ kind: string; ref: { path: string }; value?: Record<string, unknown> }> = [];
let documents: Record<string, Record<string, unknown> | undefined> = {};

const ref = (path: string) => ({ path });
const applyWrite = (documentRef: { path: string }, value: Record<string, unknown>) => {
  const current = documents[documentRef.path] ?? {};
  const next = { ...current, ...value };
  if (next.membership === 'DELETE') delete next.membership;
  documents[documentRef.path] = next;
};
const fakeDb = {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
  runTransaction: async (callback: (transaction: any) => Promise<any>) => callback({
    get: async (documentRef: { path: string }) => {
      const data = documents[documentRef.path];
      return { exists: !!data, data: () => data, get: (field: string) => data?.[field] };
    },
    create: (documentRef: { path: string }, value: Record<string, unknown>) => { writes.push({ kind: 'create', ref: documentRef, value }); applyWrite(documentRef, value); },
    update: (documentRef: { path: string }, value: Record<string, unknown>) => { writes.push({ kind: 'update', ref: documentRef, value }); applyWrite(documentRef, value); },
  }),
};

vi.mock('mercadopago', () => ({
  default: class MercadoPagoConfig {},
  Payment: class Payment { get = paymentGet; },
  MerchantOrder: class MerchantOrder { get = merchantOrderGet; },
  Preference: class Preference {},
}));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => fakeDb }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => 'DELETE' },
  Timestamp: FakeTimestamp,
}));
vi.mock('@/lib/payments/auth', () => ({ requireFirebaseUser: vi.fn() }));

describe('membership webhook processor', () => {
  beforeEach(async () => {
    vi.resetModules();
    writes.length = 0;
    paymentGet.mockReset();
    merchantOrderGet.mockReset();
    documents = {
      'paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ': {
        kind: 'membership', businessId: 'business-a', amount: 4000, currency: 'ARS', collectorId: '12345',
        applicationId: '98765', expectedLiveMode: true, status: 'pending', preferenceId: 'preference-123', expiresAt: FakeTimestamp.fromMillis(Date.now() + 60_000),
      },
      'businesses/business-a': { status: 'active', membership: {} },
    };
    paymentGet.mockResolvedValue({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockImplementation(() => ({
      preference_id: 'preference-123', application_id: '98765', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      collector: { id: 12345 }, payments: [{ id: paymentGet.mock.calls.at(-1)?.[0]?.id }],
    }));
    process.env.MP_ACCESS_TOKEN = 'TEST-synthetic';
    // Cold module loading is fixture setup; the operation keeps its 5s test deadline.
    await import('@/services/mercadopago');
  }, 30_000);

  it('credits an approved payment once and persists an idempotency ledger', async () => {
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-123')).resolves.toEqual({ processed: true });
    expect(writes.map(entry => entry.ref.path)).toEqual([
      'processedPayments/payment-123',
      'membershipPaymentCredits/payment-123',
      'paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      'businesses/business-a',
    ]);
  });

  it.each([
    ['became blocked', { status: 'blocked', membership: { type: 'trial' } }],
    ['became lifetime', { status: 'active', membership: { type: 'lifetime' } }],
  ])('records an approved charge for review when the business %s during checkout', async (_label, business) => {
    documents['businesses/business-a'] = business;
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-ineligible')).resolves.toEqual({ processed: true });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);
    expect(writes.find(entry => entry.ref.path === 'paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ')?.value).toMatchObject({
      status: 'payment_conflict_review', reviewReason: 'business_ineligible_after_checkout',
    });
  });

  it('rejects a payment whose amount does not match the server-created order', async () => {
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 1, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-124')).rejects.toThrow('no coinciden');
    expect(writes).toEqual([]);
  });

  it('credits a genuine approved payment delivered after checkout expiry', async () => {
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.expiresAt = FakeTimestamp.fromMillis(Date.now() - 60_000);
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-late')).resolves.toEqual({ processed: true });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(true);
  });

  it('rejects a payment from a different Mercado Pago preference', async () => {
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'another-preference',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce({
      preference_id: 'another-preference', application_id: '98765', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      collector: { id: 12345 }, payments: [{ id: 'payment-wrong-preference' }],
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-wrong-preference')).rejects.toThrow('no coinciden');
    expect(writes).toEqual([]);
  });

  it.each([
    { label: 'application', provider: { preference_id: 'preference-123', application_id: 'other-app', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', collector: { id: 12345 }, payments: [{ id: 'payment-merchant-mismatch' }] } },
    { label: 'payment membership', provider: { preference_id: 'preference-123', application_id: '98765', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', collector: { id: 12345 }, payments: [{ id: 'another-payment' }] } },
  ])('rejects a Merchant Order with mismatched $label', async ({ provider }) => {
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', order: { id: 777 },
      transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce(provider);
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-merchant-mismatch')).rejects.toThrow('no coinciden');
    expect(writes).toEqual([]);
  });

  it('records a refund received before approval and never reactivates that payment', async () => {
    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-refunded-first')).resolves.toEqual({ processed: true });
    expect(writes.map(entry => entry.ref.path)).toEqual([
      'processedPayments/payment-refunded-first',
      'membershipPaymentCredits/payment-refunded-first',
      'paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
    ]);

    documents['processedPayments/payment-refunded-first'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'refunded' };
    documents['membershipPaymentCredits/payment-refunded-first'] = { status: 'reversed_uncredited' };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'reversed';
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    await expect(processWebhookNotificationAdmin('payment-refunded-first')).resolves.toEqual({ processed: false, duplicate: true });
  });

  it('keeps a partial refund discovered before approval in review until the remaining money is resolved', async () => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    paymentGet.mockResolvedValueOnce({
      status: 'partially_refunded', external_reference: orderId, order: { id: 777 }, transaction_amount: 4000,
      transaction_amount_refunded: 1000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    await expect(processWebhookNotificationAdmin('payment-partial-first')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-partial-first']).toMatchObject({
      status: 'partially_refunded', amountRefunded: 1000, reviewReason: 'partial_refund_before_approval',
    });
    expect(documents['membershipPaymentCredits/payment-partial-first']).toMatchObject({ status: 'partial_refund_review' });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'payment_conflict_review' });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);

    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: orderId, order: { id: 777 }, transaction_amount: 4000,
      transaction_amount_refunded: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    await expect(processWebhookNotificationAdmin('payment-partial-first')).resolves.toEqual({ processed: true });
    expect(documents['membershipPaymentCredits/payment-partial-first']).toMatchObject({ status: 'reversed_uncredited' });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'reversed' });
  });

  it('treats approved plus partially_refunded detail as a partial refund, never as a full membership approval', async () => {
    paymentGet.mockResolvedValueOnce({
      status: 'approved', status_detail: 'partially_refunded', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, transaction_amount_refunded: 1000,
      currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-approved-partial')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-approved-partial']).toMatchObject({
      status: 'partially_refunded', providerStatusDetail: 'partially_refunded', reviewReason: 'partial_refund_before_approval',
    });
    expect(documents['membershipPaymentCredits/payment-approved-partial']).toMatchObject({ status: 'partial_refund_review' });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);
  });

  it('refreshes cumulative evidence for repeated partial refunds without treating the second notification as a duplicate', async () => {
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-multiple-partial')).resolves.toEqual({ processed: true });

    const partial = (amountRefunded: number) => paymentGet.mockResolvedValueOnce({
      status: 'approved', status_detail: 'partially_refunded', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, transaction_amount_refunded: amountRefunded,
      currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    partial(1000);
    await expect(processWebhookNotificationAdmin('payment-multiple-partial')).resolves.toEqual({ processed: true });
    partial(2500);
    await expect(processWebhookNotificationAdmin('payment-multiple-partial')).resolves.toEqual({ processed: true });

    expect(documents['processedPayments/payment-multiple-partial']).toMatchObject({
      status: 'partially_refunded', amountRefunded: 2500, providerStatusDetail: 'partially_refunded',
    });
    expect(documents['membershipPaymentCredits/payment-multiple-partial']).toMatchObject({
      status: 'partial_refund_review', amountRefunded: 2500, providerStatusDetail: 'partially_refunded',
    });
  });

  it('keeps the granted membership when charged_back/in_process resolves reimbursed to the seller', async () => {
    const original = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    const granted = { type: 'pro', paymentId: 'payment-dispute', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { status: 'active', membership: granted };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'approved';
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.paymentId = 'payment-dispute';
    documents['processedPayments/payment-dispute'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'approved' };
    documents['membershipPaymentCredits/payment-dispute'] = { status: 'active', previousMembership: original, grantedMembership: granted };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');

    paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: 'in_process', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    await expect(processWebhookNotificationAdmin('payment-dispute')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(granted);
    expect(documents['membershipPaymentCredits/payment-dispute']).toMatchObject({ status: 'active', disputeStatus: 'charged_back_in_process' });

    paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: 'reimbursed', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    await expect(processWebhookNotificationAdmin('payment-dispute')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(granted);
    expect(documents['processedPayments/payment-dispute']).toMatchObject({ status: 'charged_back_reimbursed' });
    expect(documents['membershipPaymentCredits/payment-dispute']).toMatchObject({ status: 'active', disputeStatus: 'charged_back_reimbursed' });
  });

  it('revokes only the exact grant when charged_back/settled confirms the buyer was refunded', async () => {
    const original = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    const granted = { type: 'pro', paymentId: 'payment-settled', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { status: 'active', membership: granted };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'approved';
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.paymentId = 'payment-settled';
    documents['processedPayments/payment-settled'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'approved' };
    documents['membershipPaymentCredits/payment-settled'] = { status: 'active', previousMembership: original, grantedMembership: granted };
    paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: 'settled', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-settled')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(original);
    expect(documents['membershipPaymentCredits/payment-settled']).toMatchObject({ status: 'reversed', reversalStatus: 'charged_back' });
  });

  it.each([
    { detail: 'reimbursed', expectedProcessed: 'charged_back_reimbursed', expectedCredit: 'approval_pending_review' },
    { detail: 'settled', expectedProcessed: 'charged_back', expectedCredit: 'reversed_uncredited' },
  ])('keeps the original payment attribution when a second payment chargeback resolves $detail', async ({ detail, expectedProcessed, expectedCredit }) => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const originalGrant = { type: 'pro', paymentId: 'payment-original', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { status: 'active', membership: originalGrant };
    documents[`paymentOrders/${orderId}`] = { ...documents[`paymentOrders/${orderId}`], status: 'payment_conflict_review', paymentId: 'payment-original', conflictingPaymentId: 'payment-secondary' };
    documents['processedPayments/payment-secondary'] = { orderId, status: 'approval_pending_review', reviewReason: 'second_approved_payment_for_order' };
    documents['membershipPaymentCredits/payment-secondary'] = { status: 'approval_pending_review', previousMembership: null, reviewReason: 'second_approved_payment_for_order' };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');

    const respond = (statusDetail: string) => paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: statusDetail, external_reference: orderId,
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    respond('in_process');
    await expect(processWebhookNotificationAdmin('payment-secondary')).resolves.toEqual({ processed: true });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'payment_conflict_review', paymentId: 'payment-original', conflictingPaymentId: 'payment-secondary' });

    respond(detail);
    await expect(processWebhookNotificationAdmin('payment-secondary')).resolves.toEqual({ processed: true });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'payment_conflict_review', paymentId: 'payment-original', conflictingPaymentId: 'payment-secondary' });
    expect(documents['processedPayments/payment-secondary']).toMatchObject({ status: expectedProcessed });
    expect(documents['membershipPaymentCredits/payment-secondary']).toMatchObject({ status: expectedCredit });
    expect(documents['businesses/business-a']?.membership).toEqual(originalGrant);
  });

  it('preserves the original payment attribution for direct out-of-order secondary reimbursed then settled notifications', async () => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const originalGrant = { type: 'pro', paymentId: 'payment-original', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { status: 'active', membership: originalGrant };
    documents[`paymentOrders/${orderId}`] = { ...documents[`paymentOrders/${orderId}`], status: 'approved', paymentId: 'payment-original' };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    const respond = (statusDetail: string) => paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: statusDetail, external_reference: orderId,
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });

    respond('reimbursed');
    await expect(processWebhookNotificationAdmin('payment-secondary-direct')).resolves.toEqual({ processed: true });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'payment_conflict_review', paymentId: 'payment-original', conflictingPaymentId: 'payment-secondary-direct' });

    respond('settled');
    await expect(processWebhookNotificationAdmin('payment-secondary-direct')).resolves.toEqual({ processed: true });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ status: 'payment_conflict_review', paymentId: 'payment-original', conflictingPaymentId: 'payment-secondary-direct' });
    expect(documents['membershipPaymentCredits/payment-secondary-direct']).toMatchObject({ status: 'reversed_uncredited' });
    expect(documents['businesses/business-a']?.membership).toEqual(originalGrant);
  });

  it('does not restore an approved order or regrant membership when settled arrives before reimbursed for the credited payment', async () => {
    const original = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    const granted = { type: 'pro', paymentId: 'payment-out-of-order', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { status: 'active', membership: granted };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ'] = { ...documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ'], status: 'approved', paymentId: 'payment-out-of-order' };
    documents['processedPayments/payment-out-of-order'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'approved' };
    documents['membershipPaymentCredits/payment-out-of-order'] = { status: 'active', previousMembership: original, grantedMembership: granted };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    const respond = (statusDetail: string) => paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: statusDetail, external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });

    respond('settled');
    await expect(processWebhookNotificationAdmin('payment-out-of-order')).resolves.toEqual({ processed: true });
    respond('reimbursed');
    await expect(processWebhookNotificationAdmin('payment-out-of-order')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(original);
    expect(documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']).toMatchObject({ status: 'reversal_pending_review', paymentId: 'payment-out-of-order', reviewReason: 'chargeback_reimbursed_after_reversal' });
    expect(documents['membershipPaymentCredits/payment-out-of-order']).toMatchObject({ status: 'reversed' });
  });

  it('records an approved charge for review if the business vanished during checkout', async () => {
    delete documents['businesses/business-a'];
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-business-gone')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-business-gone']).toMatchObject({
      status: 'approval_pending_review', reviewReason: 'business_ineligible_after_checkout',
    });
  });

  it('restores only the membership snapshot granted by a fully refunded payment', async () => {
    const previous = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    const granted = { type: 'pro', paymentId: 'payment-refund', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { membership: granted };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'approved';
    documents['processedPayments/payment-refund'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'approved' };
    documents['membershipPaymentCredits/payment-refund'] = { status: 'active', previousMembership: previous, grantedMembership: granted };
    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-refund')).resolves.toEqual({ processed: true });
    expect(writes.find(entry => entry.ref.path === 'businesses/business-a')?.value).toEqual({ membership: previous });
  });

  it.each([
    { status: 'charged_back', statusDetail: 'settled', expectedCreditStatus: 'reversed' },
    { status: 'partially_refunded', statusDetail: undefined, expectedCreditStatus: 'partial_refund_review' },
  ])('does not revoke a later valid grant when payment is $status/$statusDetail', async ({ status, statusDetail, expectedCreditStatus }) => {
    const oldGrant = { type: 'pro', paymentId: 'payment-old', startsAt: FakeTimestamp.fromMillis(300), expiresAt: FakeTimestamp.fromMillis(400) };
    documents['businesses/business-a'] = { membership: { type: 'pro', paymentId: 'payment-new', startsAt: FakeTimestamp.fromMillis(500), expiresAt: FakeTimestamp.fromMillis(600) } };
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'approved';
    documents['processedPayments/payment-old'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'approved' };
    documents['membershipPaymentCredits/payment-old'] = { status: 'active', previousMembership: null, grantedMembership: oldGrant };
    paymentGet.mockResolvedValueOnce({
      status, ...(statusDetail ? { status_detail: statusDetail } : {}), external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-old')).resolves.toEqual({ processed: true });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);
    expect(writes.find(entry => entry.ref.path === 'membershipPaymentCredits/payment-old')?.value).toMatchObject({ status: expectedCreditStatus });
  });

  it('treats a duplicate reversal as idempotent', async () => {
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'reversed';
    documents['processedPayments/payment-duplicate'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', status: 'refunded' };
    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-duplicate')).resolves.toEqual({ processed: false, duplicate: true });
    expect(writes).toEqual([]);
  });

  it('puts a legacy approved payment without a credit ledger into durable review', async () => {
    documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']!.status = 'approved';
    // Records written by the old processor have no explicit status or credit.
    documents['processedPayments/payment-legacy'] = { orderId: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ' };
    paymentGet.mockResolvedValueOnce({
      status: 'charged_back', status_detail: 'settled', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', preference_id: 'preference-123',
      order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-legacy')).resolves.toEqual({ processed: true });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);
    expect(writes.find(entry => entry.ref.path === 'membershipPaymentCredits/payment-legacy')?.value).toMatchObject({
      status: 'reversal_pending_review', reviewReason: 'credit_ledger_missing',
    });
  });

  it('does not resurrect a refunded earlier credit when a later credit is also refunded', async () => {
    const orderA = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const orderB = '7X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const baseMembership = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    documents['businesses/business-a'] = { status: 'active', membership: baseMembership };
    documents[`paymentOrders/${orderB}`] = {
      kind: 'membership', businessId: 'business-a', amount: 4000, currency: 'ARS', collectorId: '12345', applicationId: '98765',
      expectedLiveMode: true, status: 'pending', preferenceId: 'preference-456', expiresAt: FakeTimestamp.fromMillis(Date.now() + 60_000),
    };
    const respond = (paymentId: string, orderId: string, preferenceId: string, status: string) => {
      paymentGet.mockResolvedValueOnce({ status, external_reference: orderId, order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true });
      merchantOrderGet.mockResolvedValueOnce({ preference_id: preferenceId, application_id: '98765', external_reference: orderId, collector: { id: 12345 }, payments: [{ id: paymentId }] });
    };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    respond('payment-a', orderA, 'preference-123', 'approved');
    await expect(processWebhookNotificationAdmin('payment-a')).resolves.toEqual({ processed: true });
    respond('payment-b', orderB, 'preference-456', 'approved');
    await expect(processWebhookNotificationAdmin('payment-b')).resolves.toEqual({ processed: true });
    respond('payment-a', orderA, 'preference-123', 'refunded');
    await expect(processWebhookNotificationAdmin('payment-a')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toMatchObject({ paymentId: 'payment-b' });
    respond('payment-b', orderB, 'preference-456', 'refunded');
    await expect(processWebhookNotificationAdmin('payment-b')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(baseMembership);
  });

  it('records a second approved payment for one order for review without granting it', async () => {
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-123')).resolves.toEqual({ processed: true });
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce({
      preference_id: 'preference-123', application_id: '98765', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', collector: { id: 12345 }, payments: [{ id: 'payment-second' }],
    });
    await expect(processWebhookNotificationAdmin('payment-second')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-second']).toMatchObject({ status: 'approval_pending_review' });
    expect(documents['membershipPaymentCredits/payment-second']).toMatchObject({ status: 'approval_pending_review' });
    expect(documents['paymentOrders/6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ']).toMatchObject({ status: 'payment_conflict_review' });
    expect(documents['businesses/business-a']?.membership).toMatchObject({ paymentId: 'payment-123' });
  });

  it('records a new approved charge even if a different payment for the same order was refunded first', async () => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    documents[`paymentOrders/${orderId}`] = { ...documents[`paymentOrders/${orderId}`], status: 'reversed', paymentId: 'payment-earlier' };
    documents['processedPayments/payment-earlier'] = { orderId, status: 'refunded' };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-later')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-later']).toMatchObject({ status: 'approval_pending_review' });
    expect(writes.some(entry => entry.ref.path === 'businesses/business-a')).toBe(false);
  });

  it('records a refund of an uncredited second payment without changing the original grant', async () => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-original')).resolves.toEqual({ processed: true });
    paymentGet.mockResolvedValueOnce({
      status: 'approved', external_reference: orderId, order: { id: 777 }, transaction_amount: 4000,
      currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce({
      preference_id: 'preference-123', application_id: '98765', external_reference: orderId,
      collector: { id: 12345 }, payments: [{ id: 'payment-second' }],
    });
    await expect(processWebhookNotificationAdmin('payment-second')).resolves.toEqual({ processed: true });
    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: orderId, order: { id: 777 }, transaction_amount: 4000,
      currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce({
      preference_id: 'preference-123', application_id: '98765', external_reference: orderId,
      collector: { id: 12345 }, payments: [{ id: 'payment-second' }],
    });
    await expect(processWebhookNotificationAdmin('payment-second')).resolves.toEqual({ processed: true });
    expect(documents['processedPayments/payment-second']).toMatchObject({ status: 'refunded' });
    expect(documents['membershipPaymentCredits/payment-second']).toMatchObject({ status: 'reversed_uncredited' });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ paymentId: 'payment-original' });
    expect(documents['businesses/business-a']?.membership).toMatchObject({ paymentId: 'payment-original' });
  });

  it('does not replace an original payment when an uncredited second payment reverses before approval', async () => {
    const orderId = '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ';
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-original')).resolves.toEqual({ processed: true });
    paymentGet.mockResolvedValueOnce({
      status: 'refunded', external_reference: orderId, order: { id: 777 }, transaction_amount: 4000,
      currency_id: 'ARS', collector_id: 12345, live_mode: true,
    });
    merchantOrderGet.mockResolvedValueOnce({
      preference_id: 'preference-123', application_id: '98765', external_reference: orderId,
      collector: { id: 12345 }, payments: [{ id: 'payment-second' }],
    });
    await expect(processWebhookNotificationAdmin('payment-second')).resolves.toEqual({ processed: true });
    expect(documents[`paymentOrders/${orderId}`]).toMatchObject({ paymentId: 'payment-original', status: 'payment_conflict_review' });
    expect(documents['businesses/business-a']?.membership).toMatchObject({ paymentId: 'payment-original' });
  });

  it('escalates a partial refund to a full refund and revokes that exact grant', async () => {
    const baseMembership = { type: 'trial', startsAt: FakeTimestamp.fromMillis(100), expiresAt: FakeTimestamp.fromMillis(200) };
    documents['businesses/business-a'] = { status: 'active', membership: baseMembership };
    const { processWebhookNotificationAdmin } = await import('@/services/mercadopago');
    await expect(processWebhookNotificationAdmin('payment-123')).resolves.toEqual({ processed: true });
    const respond = (status: string) => {
      paymentGet.mockResolvedValueOnce({ status, external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', order: { id: 777 }, transaction_amount: 4000, currency_id: 'ARS', collector_id: 12345, live_mode: true });
      merchantOrderGet.mockResolvedValueOnce({ preference_id: 'preference-123', application_id: '98765', external_reference: '6X3pYlmZKpA1MrFO-ffcoZvlYSCv4PjQ', collector: { id: 12345 }, payments: [{ id: 'payment-123' }] });
    };
    respond('partially_refunded');
    await expect(processWebhookNotificationAdmin('payment-123')).resolves.toEqual({ processed: true });
    expect(documents['membershipPaymentCredits/payment-123']).toMatchObject({ status: 'partial_refund_review' });
    respond('refunded');
    await expect(processWebhookNotificationAdmin('payment-123')).resolves.toEqual({ processed: true });
    expect(documents['businesses/business-a']?.membership).toEqual(baseMembership);
    expect(documents['membershipPaymentCredits/payment-123']).toMatchObject({ status: 'reversed' });
  });
});
