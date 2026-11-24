import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  paymentSearch: vi.fn(), processWebhookNotificationAdmin: vi.fn(), getAdminFirestore: vi.fn(),
  state: {} as Record<string, unknown>, failures: [] as Array<{ id: string; value: Record<string, unknown> }>,
  openFailures: [] as Array<{ id: string; stream: string; subjectId: string }>, orderLookups: {} as Record<string, { id: string; status: string }>,
  pendingDocs: [] as Array<{ id: string; status: string }>, ledgerDocs: [] as Array<{ id: string; status: string }>,
}));

vi.mock('mercadopago', () => ({ default: class MercadoPagoConfig {}, Payment: class Payment { search = mocked.paymentSearch; } }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocked.getAdminFirestore }));
vi.mock('@/services/mercadopago', () => ({ processWebhookNotificationAdmin: mocked.processWebhookNotificationAdmin }));
vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  FieldValue: { increment: (value: number) => ({ increment: value }), serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

const doc = (entry: { id: string; status: string }) => ({ id: entry.id, get: (field: string) => field === 'status' ? entry.status : field === 'preferenceId' ? 'pref_synthetic' : undefined });

function pagedQuery(entries: Array<{ id: string; status: string }>) {
  let after: string | undefined;
  let pageSize = 10;
  const query = {
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn((value: number) => { pageSize = value; return query; }),
    startAfter: vi.fn((value: string) => { after = value; return query; }),
    get: vi.fn(async () => {
      const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
      const index = after ? sorted.findIndex(entry => entry.id === after) + 1 : 0;
      return { docs: sorted.slice(Math.max(0, index), Math.max(0, index) + pageSize).map(doc) };
    }),
  };
  return query;
}

function fakeDb() {
  return {
    collection: (name: string) => {
      if (name === 'paymentOrders') return Object.assign(pagedQuery(mocked.pendingDocs), {
        doc: (id: string) => ({ get: async () => {
          const entry = mocked.orderLookups[id];
          return { exists: !!entry, ...(entry ? doc(entry) : {}) };
        } }),
      });
      if (name === 'processedPayments') return pagedQuery(mocked.ledgerDocs);
      if (name === 'paymentReconciliationState') return { doc: () => ({
        get: async () => ({ exists: Object.keys(mocked.state).length > 0, data: () => mocked.state }),
        set: async (value: Record<string, unknown>) => { Object.assign(mocked.state, value); },
      }) };
      return {
        where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: async () => ({ docs: mocked.openFailures.map(entry => ({ id: entry.id, get: (field: string) => field === 'stream' ? entry.stream : field === 'subjectId' ? entry.subjectId : 'open' })) }),
        doc: (id: string) => ({ set: async (value: Record<string, unknown>) => { mocked.failures.push({ id, value }); } }),
      };
    },
  };
}

describe('membership payment reconciliation', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); process.env.MP_ACCESS_TOKEN = 'TEST-synthetic';
    mocked.pendingDocs = []; mocked.ledgerDocs = []; mocked.failures = []; mocked.openFailures = []; mocked.orderLookups = {};
    for (const key of Object.keys(mocked.state)) delete mocked.state[key];
    mocked.getAdminFirestore.mockReturnValue(fakeDb());
    mocked.paymentSearch.mockResolvedValue({ paging: { total: 0 }, results: [] });
    mocked.processWebhookNotificationAdmin.mockResolvedValue({ processed: false });
  });

  it('finds a missed pending payment by external reference and uses the normal idempotent processor', async () => {
    mocked.pendingDocs = [{ id: 'order_pending_1', status: 'pending' }];
    mocked.paymentSearch.mockResolvedValue({ paging: { total: 1 }, results: [{ id: 'payment_pending_1' }] });
    mocked.processWebhookNotificationAdmin.mockResolvedValue({ processed: true });
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    await expect(reconcileMembershipPayments()).resolves.toMatchObject({ stream: 'orders', candidates: 1, eligible: 1, providerPaymentsFound: 1, checkedPayments: 1, processed: 1, failed: 0 });
    expect(mocked.paymentSearch).toHaveBeenCalledWith({ options: { external_reference: 'order_pending_1', limit: 10, offset: 0, sort: 'date_last_updated', criteria: 'desc' } });
    expect(mocked.processWebhookNotificationAdmin).toHaveBeenCalledWith('payment_pending_1');
    expect(mocked.failures).toEqual([]);
  });

  it('paginates more than 100 orders without a permanent failure and resumes after the stored cursor', async () => {
    mocked.pendingDocs = Array.from({ length: 101 }, (_, index) => ({ id: `order_${String(index).padStart(3, '0')}`, status: 'pending' }));
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const first = await reconcileMembershipPayments();
    expect(first).toMatchObject({ candidates: 10, stream: 'orders', failed: 0 });
    expect(mocked.state.orderCursor).toBe('order_009');
    await reconcileMembershipPayments();
    const third = await reconcileMembershipPayments();
    expect(third).toMatchObject({ candidates: 10, stream: 'orders' });
    expect(mocked.paymentSearch.mock.calls[10]?.[0]).toMatchObject({ options: { external_reference: 'order_010' } });
    expect(mocked.state.orderCursor).toBe('order_019');
  });

  it('checks approved orders for a second webhook-missed payment and rechecks unsettled ledger entries', async () => {
    mocked.pendingDocs = [{ id: 'order_approved_1', status: 'approved' }];
    mocked.ledgerDocs = [
      { id: 'payment_previously_approved', status: 'approved' }, { id: 'payment_partially_refunded', status: 'partially_refunded' }, { id: 'payment_awaiting_review', status: 'approval_pending_review' },
    ];
    mocked.paymentSearch.mockResolvedValue({ paging: { total: 1 }, results: [{ id: 'payment_second' }] });
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    await reconcileMembershipPayments(); await reconcileMembershipPayments();
    expect(mocked.paymentSearch).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ external_reference: 'order_approved_1' }) }));
    for (const paymentId of ['payment_second', 'payment_previously_approved', 'payment_partially_refunded', 'payment_awaiting_review']) expect(mocked.processWebhookNotificationAdmin).toHaveBeenCalledWith(paymentId);
  });

  it('records one provider failure, advances the page, and retries it on the next cursor cycle', async () => {
    mocked.pendingDocs = [{ id: 'order_001', status: 'pending' }, { id: 'order_002', status: 'pending' }];
    mocked.paymentSearch.mockRejectedValueOnce(new Error('synthetic provider fault')).mockResolvedValue({ paging: { total: 0 }, results: [] });
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const first = await reconcileMembershipPayments();
    expect(first).toMatchObject({ candidates: 2, failed: 1 });
    expect(mocked.state.orderCursor).toBe('order_002');
    expect(mocked.failures.some(entry => entry.id === 'orders_order_001' && entry.value.status === 'open')).toBe(true);
    await reconcileMembershipPayments();
    // A later round starts at the collection head. The failed item is visible
    // in its durable record in the meantime and is not silently discarded.
    delete mocked.state.orderCursor;
    mocked.state.nextStream = 'orders';
    mocked.openFailures = [{ id: 'orders_order_001', stream: 'orders', subjectId: 'order_001' }];
    const retry = await reconcileMembershipPayments();
    expect(retry).toMatchObject({ stream: 'orders', failed: 0 });
    expect(mocked.paymentSearch).toHaveBeenCalledTimes(4);
    expect(mocked.failures.some(entry => entry.id === 'orders_order_001' && entry.value.status === 'resolved')).toBe(true);
  });

  it('retries an open order failure before the normal cursor page without blocking that page', async () => {
    mocked.openFailures = [{ id: 'orders_order_old', stream: 'orders', subjectId: 'order_old' }];
    mocked.orderLookups = { order_old: { id: 'order_old', status: 'approved' } };
    mocked.pendingDocs = [{ id: 'order_new', status: 'pending' }];
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const result = await reconcileMembershipPayments();
    expect(result).toMatchObject({ stream: 'orders', candidates: 1, eligible: 2 });
    expect(mocked.paymentSearch).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ external_reference: 'order_old' }) }));
    expect(mocked.paymentSearch).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ external_reference: 'order_new' }) }));
    expect(mocked.state.orderCursor).toBe('order_new');
  });

  it('records processor failures under the payments stream and prioritizes their retry', async () => {
    mocked.pendingDocs = [{ id: 'order_source', status: 'pending' }];
    mocked.paymentSearch.mockResolvedValue({ paging: { total: 1 }, results: [{ id: 'payment_retry' }] });
    mocked.processWebhookNotificationAdmin.mockRejectedValueOnce(new Error('synthetic payment fault'));
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const first = await reconcileMembershipPayments();
    expect(first.failed).toBe(1);
    expect(mocked.failures.some(entry => entry.id === 'payments_payment_retry' && entry.value.status === 'open')).toBe(true);

    mocked.openFailures = [{ id: 'payments_payment_retry', stream: 'payments', subjectId: 'payment_retry' }];
    mocked.processWebhookNotificationAdmin.mockResolvedValue({ processed: true });
    const retry = await reconcileMembershipPayments();
    expect(retry.stream).toBe('payments');
    expect(mocked.processWebhookNotificationAdmin).toHaveBeenLastCalledWith('payment_retry');
    expect(mocked.failures.some(entry => entry.id === 'payments_payment_retry' && entry.value.status === 'resolved')).toBe(true);
  });

  it('marks an order search with an invalid provider payment ID as failed', async () => {
    mocked.pendingDocs = [{ id: 'order_invalid_payment', status: 'pending' }];
    mocked.paymentSearch.mockResolvedValue({ paging: { total: 1 }, results: [{}] });
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const result = await reconcileMembershipPayments();
    expect(result).toMatchObject({ failed: 1, checkedPayments: 0 });
    expect(mocked.failures.some(entry => entry.id === 'orders_order_invalid_payment' && entry.value.reason === 'provider_http_error')).toBe(true);
  });

  it('paginates the eleventh provider payment and processes it', async () => {
    mocked.pendingDocs = [{ id: 'order_good', status: 'pending' }];
    mocked.paymentSearch
      .mockResolvedValueOnce({ paging: { total: 11 }, results: Array.from({ length: 10 }, (_, index) => ({ id: `payment_${index}` })) })
      .mockResolvedValueOnce({ paging: { total: 11 }, results: [{ id: 'payment_10' }] });
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const result = await reconcileMembershipPayments();
    expect(result).toMatchObject({ candidates: 1, truncatedSearches: 0, failed: 0, checkedPayments: 11 });
    expect(mocked.paymentSearch).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ external_reference: 'order_good', offset: 10 }) }));
    expect(mocked.processWebhookNotificationAdmin).toHaveBeenCalledWith('payment_10');
    expect(mocked.state.orderCursor).toBe('order_good');
  });

  it('records visible overflow after twenty provider payments without stopping the page', async () => {
    mocked.pendingDocs = [{ id: 'order_overflow', status: 'pending' }];
    for (let page = 0; page < 2; page += 1) {
      mocked.paymentSearch.mockResolvedValueOnce({ paging: { total: 21 }, results: Array.from({ length: 10 }, (_, index) => ({ id: `payment_${page}_${index}` })) });
    }
    const { reconcileMembershipPayments } = await import('@/lib/payments/reconcile-memberships');
    const result = await reconcileMembershipPayments();
    expect(result).toMatchObject({ candidates: 1, truncatedSearches: 1, failed: 1, checkedPayments: 20 });
    expect(mocked.failures.some(entry => entry.id === 'orders_order_overflow' && entry.value.reason === 'provider_results_overflow')).toBe(true);
  });
});
