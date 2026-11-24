import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyAdminRequest, getAdminFirestore } = vi.hoisted(() => ({
  verifyAdminRequest: vi.fn(),
  getAdminFirestore: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({ verifyAdminRequest }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore }));

import { GET } from '@/app/api/admin/payment-reviews/route';

const request = () => new Request('https://pediturno.test/api/admin/payment-reviews') as any;

describe('admin payment review queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not query financial orders for an unauthorized caller', async () => {
    verifyAdminRequest.mockResolvedValue({ authorized: false });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });

  it('returns only reviewable order identifiers for an admin', async () => {
    verifyAdminRequest.mockResolvedValue({ authorized: true });
    const orderQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        size: 1,
        docs: [{ id: 'order-1', data: () => ({
          businessId: 'business-1', paymentId: 'payment-1', status: 'reversal_pending_review',
          reviewReason: 'partial_refund', accessToken: 'must-not-leak',
        }) }],
      }),
    };
    const paymentQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
    };
    const failureQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ size: 1, docs: [{ id: 'orders_order-2', data: () => ({
        stream: 'orders', subjectId: 'order-2', reason: 'provider_or_ledger_error', accessToken: 'must-not-leak',
      }) }] }),
    };
    getAdminFirestore.mockReturnValue({ collection: vi.fn((name: string) => name === 'paymentOrders' ? orderQuery : name === 'processedPayments' ? paymentQuery : failureQuery) });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reviews: [{
      orderId: 'order-1', businessId: 'business-1', paymentId: 'payment-1',
      status: 'reversal_pending_review', reason: 'partial_refund',
    }, {
      orderId: 'order-2', businessId: '', paymentId: '', status: 'reconciliation_error',
      reason: 'provider_or_ledger_error', source: 'reconciliation',
    }], more: false });
    expect(orderQuery.where).toHaveBeenCalledWith('status', 'in', ['reversal_pending_review', 'payment_conflict_review']);
    expect(paymentQuery.where).toHaveBeenCalledWith('status', '==', 'approval_pending_review');
    expect(failureQuery.where).toHaveBeenCalledWith('status', '==', 'open');
  });
});
