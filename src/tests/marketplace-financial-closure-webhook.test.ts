import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ payment: vi.fn(), closure: vi.fn(), defer: vi.fn() }));
vi.mock('@/lib/payments/deposits', () => ({ processDepositPayment: mocks.payment }));
vi.mock('@/lib/payments/marketplace-financial-closure', () => ({ reconcileDeletedSellerAfterPayment: mocks.closure, deferClosedSellerEvent: mocks.defer }));
import { POST } from '@/app/api/webhooks/mercadopago/marketplace/route';
const oldSecret = process.env.MP_MARKETPLACE_WEBHOOK_SECRET;
beforeEach(() => { process.env.MP_MARKETPLACE_WEBHOOK_SECRET = 'synthetic-unit-webhook-key'; mocks.payment.mockResolvedValue({ processed: true }); mocks.closure.mockResolvedValue({ purged: true }); mocks.defer.mockResolvedValue(false); });
afterEach(() => { if (oldSecret === undefined) delete process.env.MP_MARKETPLACE_WEBHOOK_SECRET; else process.env.MP_MARKETPLACE_WEBHOOK_SECRET = oldSecret; });
function request(valid = true) {
  const ts = String(Date.now()), id = '42', requestId = 'synthetic-request';
  const hash = createHmac('sha256', process.env.MP_MARKETPLACE_WEBHOOK_SECRET!).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return new NextRequest('https://pediturno.com/api/webhooks/mercadopago/marketplace?order=' + 'a'.repeat(24), { method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${valid ? hash : '0'.repeat(64)}`, 'x-request-id': requestId, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id }, user_id: '123' }) });
}
describe('Signed settlement integrates financial closure', () => {
  it('rejects a forged notification before reconciliation or credential purge', async () => {
    expect((await POST(request(false))).status).toBe(401); expect(mocks.payment).not.toHaveBeenCalled(); expect(mocks.closure).not.toHaveBeenCalled();
  });
  it('reconciles closure after the payment provider validation, including duplicate deliveries', async () => {
    mocks.payment.mockResolvedValue({ processed: false, duplicate: true });
    expect((await POST(request())).status).toBe(200); expect(mocks.payment).toHaveBeenCalledWith('42', 'a'.repeat(24), '123'); expect(mocks.closure).toHaveBeenCalledWith('42');
  });
  it('asks the provider to retry when closure verification is unavailable', async () => {
    mocks.closure.mockRejectedValue(Error('Claims API unavailable'));
    expect((await POST(request())).status).toBe(503);
  });
  it('acknowledges a durably queued post-purge resource without calling a deleted credential', async () => {
    mocks.defer.mockResolvedValue(true); expect((await POST(request())).status).toBe(202); expect(mocks.payment).not.toHaveBeenCalled(); expect(mocks.closure).not.toHaveBeenCalled();
  });
});
