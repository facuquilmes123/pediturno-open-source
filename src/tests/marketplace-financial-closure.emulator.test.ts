import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
const provider = vi.hoisted(() => ({ request: vi.fn(), seller: vi.fn() }));
vi.mock('@/lib/payments/marketplace', () => ({ mercadoPagoRequest: provider.request, getSellerConnection: provider.seller, marketplaceConfiguration: () => ({ clientId: '456' }) }));
import { deferClosedSellerEvent, reconcileMarketplaceFinancialClosure } from '@/lib/payments/marketplace-financial-closure';
import { POST } from '@/app/api/v1/internal/account-deletion/financial-closure/route';
let app: App, db: Firestore, index = 0;
const prefix = `it_closure_${Date.now()}_`, paths = new Set<string>();
let status: string, refundStatus: string, claims: any[], total: number, race: (() => Promise<void>) | undefined;
let merchantApplicationId: number | null;
async function set(path: string, value: Record<string, unknown>) { paths.add(path); await db.doc(path).set(value); }
async function seed() {
  const uid = prefix + ++index, order = uid + '_order';
  await set(`accountDeletionRequests/${uid}`, { ownerId: uid, status: 'financial_review_required', operationalCompletedAt: Timestamp.now() });
  await set(`businessDeletions/${uid}`, { businessId: uid, status: 'financial_review_required' });
  await set(`mercadoPagoConnections/${uid}`, { merchantUserId: '123', active: false, encryptedAccessToken: { ciphertext: 'synthetic' }, deletionRetention: { reason: 'unclosed_deposit_obligation' } });
  await set(`depositOrders/${order}`, { businessId: uid, amount: 10, currency: 'ARS', collectorId: '123', applicationId: '456', expectedLiveMode: false, expiresAt: Timestamp.fromMillis(Date.now() - 60_000), preferenceId: 'pref_' + order });
  const id = String(100000 + index); paths.add(`depositPayments/${id}`);
  provider.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/checkout/preferences/')) { const o = await db.doc(`depositOrders/${order}`).get(); return { id: 'pref_' + order, external_reference: order, collector_id: 123, client_id: 456, expires: true, expiration_date_to: o.get('expiresAt').toDate().toISOString() }; }
    if (path.startsWith('/v1/payments/search?')) return { paging: { total, offset: 0 }, results: [{ id }] };
    if (path === `/v1/payments/${id}`) return { id, status, external_reference: order, collector_id: 123, currency_id: 'ARS', live_mode: false, transaction_amount: 10, transaction_amount_refunded: status === 'refunded' ? 10 : 0, order: { id: '789' } };
    if (path === '/merchant_orders/789') return { preference_id: 'pref_' + order, external_reference: order, application_id: merchantApplicationId, collector: { id: 123 }, payments: [{ id }] };
    if (path.endsWith('/refunds')) return [{ id: '901', payment_id: id, amount: 10, status: refundStatus }];
    if (path.startsWith('/post-purchase/v1/claims/search?')) { await race?.(); return { paging: { total: claims.length, offset: 0 }, data: claims }; }
    throw Error('Unexpected provider route');
  });
  return { uid, order, id };
}
beforeAll(() => { if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Firestore emulator required'); app = initializeApp({ projectId: 'demo-pediturno-audit' }); db = getFirestore(app); });
beforeEach(() => { status = 'refunded'; refundStatus = 'approved'; claims = []; total = 1; race = undefined; merchantApplicationId = 456; provider.seller.mockResolvedValue({ accessToken: 'synthetic-not-a-credential', merchantUserId: '123', liveMode: false }); });
afterAll(async () => { for (const path of paths) await db.doc(path).delete(); for (const row of (await db.collection('marketplaceClosedSellerEvents').get()).docs) if (String(row.get('businessId')).startsWith(prefix)) await row.ref.delete(); await db.terminate(); await deleteApp(app); });
describe('Provider-verified financial closure', () => {
  it('previews without mutations then atomically closes ledgers and purges only retained credentials', async () => {
    const { uid, order, id } = await seed();
    expect(await reconcileMarketplaceFinancialClosure(uid)).toMatchObject({ eligible: true, purged: false });
    expect((await db.doc(`depositOrders/${order}`).get()).get('financialClosedAt')).toBeUndefined();
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(true);
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: true, purged: true });
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(false);
    expect((await db.doc(`depositOrders/${order}`).get()).get('financialClosedAt')).toBeInstanceOf(Timestamp);
    expect((await db.doc(`depositPayments/${id}`).get()).get('status')).toBe('reversed');
    expect((await db.doc(`businessDeletions/${uid}`).get()).exists).toBe(true);
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: false, purged: false });
    expect(await deferClosedSellerEvent(id, id, 'payment')).toBe(true);
    expect(await deferClosedSellerEvent(id, id, 'payment')).toBe(true);
    expect((await db.doc(`accountDeletionRequests/${uid}`).get()).get('postClosureEventReviewRequired')).toBe(true);
    const events = await db.collection('marketplaceClosedSellerEvents').where('businessId', '==', uid).get(); expect(events.size).toBe(1);
    expect((await db.doc(`depositPayments/${id}`).get()).get('providerStatus')).toBe('refunded');
  });
  it.each(['approved', 'pending', 'charged_back', 'cancelled'])('retains credentials for %s instead of inventing closure', async value => {
    const { uid, order } = await seed(); status = value;
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: false, purged: false });
    expect((await db.doc(`depositOrders/${order}`).get()).get('financialClosedAt')).toBeUndefined();
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(true);
  });
  it('rejects incomplete payment searches and pending refunds', async () => {
    const { uid } = await seed(); total = 2;
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ reason: 'incomplete_payment_history' });
    total = 1; refundStatus = 'in_process';
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ reason: 'refunds_not_settled' });
  });
  it('does not treat an expired order without provider payments as closed', async () => {
    const { uid } = await seed(); provider.request.mockResolvedValue({ paging: { total: 0, offset: 0 }, results: [] });
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: false, purged: false });
  });
  it('rejects any open claim and leaves ledgers untouched', async () => {
    const { uid, id } = await seed(); claims = [{ id: '902', resource: 'payment', resource_id: id, status: 'opened' }];
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ reason: 'claims_not_closed' });
  });
  it('uses the verified preference for a missing app id and still rejects an explicit mismatch', async () => {
    const { uid } = await seed();
    merchantApplicationId = 789;
    expect(await reconcileMarketplaceFinancialClosure(uid)).toMatchObject({ eligible: false, reason: 'merchant_order_unverified' });
    merchantApplicationId = null;
    expect(await reconcileMarketplaceFinancialClosure(uid)).toMatchObject({ eligible: true, purged: false });
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(true);
  });
  it('detects a local source changing while provider evidence is fetched', async () => {
    const { uid, order } = await seed(); race = async () => { await db.doc(`depositOrders/${order}`).update({ status: 'review' }); };
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: true, purged: false });
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(true);
  });
  it('never overwrites another business payment even when it was absent from the owner query', async () => {
    const { uid, id } = await seed(); await set(`depositPayments/${id}`, { businessId: 'foreign_owner', amount: 99 });
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ purged: false });
    expect((await db.doc(`depositPayments/${id}`).get()).get('businessId')).toBe('foreign_owner');
  });
  it('rejects an active connection and bounds large histories without partial closure', async () => {
    const { uid } = await seed(); await db.doc(`mercadoPagoConnections/${uid}`).update({ active: true });
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ eligible: false });
    await db.doc(`mercadoPagoConnections/${uid}`).update({ active: false });
    for (let i = 0; i < 20; i++) await set(`depositOrders/${uid}_extra_${i}`, { businessId: uid });
    expect(await reconcileMarketplaceFinancialClosure(uid, true)).toMatchObject({ reason: 'manual_scope_review' });
  });
  it('retains credentials if provider verification fails', async () => {
    const { uid } = await seed(); provider.request.mockRejectedValue(Error('Provider unavailable'));
    await expect(reconcileMarketplaceFinancialClosure(uid, true)).rejects.toThrow('Provider unavailable');
    expect((await db.doc(`mercadoPagoConnections/${uid}`).get()).exists).toBe(true);
  });
  it('requires the private worker key before any provider request', async () => {
    provider.request.mockClear(); const response = await POST(new NextRequest('http://localhost/api/v1/internal/account-deletion/financial-closure', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401); expect(provider.request).not.toHaveBeenCalled();
  });
});
