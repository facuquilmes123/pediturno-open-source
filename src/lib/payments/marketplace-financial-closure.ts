import 'server-only';
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getSellerConnection, marketplaceConfiguration, mercadoPagoRequest } from './marketplace';
import { paymentAmountMatches } from './security';

const MAX_ORDERS = 20;
const MAX_PAYMENTS = 100;
type Row = Record<string, any>;
const numericId = (value: unknown) => /^\d{1,32}$/.test(String(value));
const blocked = (reason: string) => ({ eligible: false, purged: false, reason });

/** Deliberately narrow: only fully refunded, provider-verified deposits close
 * automatically. Unpaid/expired, partial refunds, chargebacks and missing API
 * permissions remain in restricted review; no guessed ageing window. */
export async function reconcileMarketplaceFinancialClosure(ownerId: string, apply = false) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) return blocked('invalid_owner');
  const db = getAdminFirestore();
  const requestRef = db.doc(`accountDeletionRequests/${ownerId}`);
  const tombstoneRef = db.doc(`businessDeletions/${ownerId}`);
  const connectionRef = db.doc(`mercadoPagoConnections/${ownerId}`);
  const ticket = await requestRef.get();
  if (ticket.get('status') !== 'financial_review_required') return blocked('not_retained_deletion');
  const [tombstone, connection, orders, receipts] = await Promise.all([
    tombstoneRef.get(), connectionRef.get(),
    db.collection('depositOrders').where('businessId', '==', ownerId).limit(MAX_ORDERS + 1).get(),
    db.collection('depositPayments').where('businessId', '==', ownerId).limit(MAX_PAYMENTS + 1).get(),
  ]);
  if (ticket.get('status') !== 'financial_review_required' || tombstone.get('status') !== 'financial_review_required' ||
    ticket.get('ownerId') !== ownerId || tombstone.get('businessId') !== ownerId ||
    !(ticket.get('operationalCompletedAt') instanceof Timestamp) || !connection.exists || connection.get('active') !== false ||
    connection.get('deletionRetention.reason') !== 'unclosed_deposit_obligation') return blocked('not_retained_deletion');
  if (!orders.size || orders.size > MAX_ORDERS || receipts.size > MAX_PAYMENTS) return blocked('manual_scope_review');
  const seller = await getSellerConnection(ownerId, true);
  // A refresh changes the connection generation: compare the snapshot taken after it.
  const boundConnection = await connectionRef.get();
  if (boundConnection.get('active') !== false || boundConnection.get('deletionRetention.reason') !== 'unclosed_deposit_obligation' || seller.merchantUserId !== boundConnection.get('merchantUserId')) return blocked('connection_changed');
  const appId = marketplaceConfiguration().clientId;
  const deadline = Date.now() + 20_000;
  const proofs: Array<{ order: FirebaseFirestore.QueryDocumentSnapshot; payments: Row[]; hash: string }> = [];
  const found = new Set<string>();
  for (const order of orders.docs) {
    if (Date.now() >= deadline) return blocked('manual_scope_review');
    if (!(order.get('expiresAt') instanceof Timestamp) || order.get('expiresAt').toMillis() > Date.now() ||
      order.get('collectorId') !== seller.merchantUserId || order.get('applicationId') !== appId || order.get('expectedLiveMode') !== seller.liveMode ||
      order.get('currency') !== 'ARS' || !order.get('preferenceId')) return blocked('order_terms_unverified');
    const preference = await mercadoPagoRequest<Row>(`/checkout/preferences/${encodeURIComponent(order.get('preferenceId'))}`, seller.accessToken);
    if (preference.id !== order.get('preferenceId') || preference.external_reference !== order.id || String(preference.collector_id) !== seller.merchantUserId ||
      String(preference.client_id) !== appId || preference.expires !== true || Date.parse(preference.expiration_date_to) !== order.get('expiresAt').toMillis() ||
      Date.parse(preference.expiration_date_to) > Date.now()) return blocked('provider_preference_not_expired');
    const search = await mercadoPagoRequest<Row>(`/v1/payments/search?external_reference=${encodeURIComponent(order.id)}&limit=100&offset=0`, seller.accessToken);
    if (!Array.isArray(search.results) || !Number.isInteger(search.paging?.total) || search.paging.offset !== 0 ||
      search.paging.total !== search.results.length || !search.results.length || found.size + search.results.length > MAX_PAYMENTS) return blocked('incomplete_payment_history');
    const verified: Row[] = [];
    for (const item of search.results) {
      if (!numericId(item.id) || found.has(String(item.id)) || Date.now() >= deadline) return blocked('payment_scope_unverified');
      const payment = await mercadoPagoRequest<Row>(`/v1/payments/${item.id}`, seller.accessToken);
      if (String(payment.id) !== String(item.id) || payment.external_reference !== order.id || String(payment.collector_id) !== seller.merchantUserId ||
        payment.currency_id !== order.get('currency') || payment.live_mode !== seller.liveMode || !paymentAmountMatches(payment.transaction_amount, order.get('amount')) ||
        payment.status !== 'refunded' || !paymentAmountMatches(payment.transaction_amount_refunded, payment.transaction_amount) || !numericId(payment.order?.id)) return blocked('payment_not_fully_refunded');
      const merchant = await mercadoPagoRequest<Row>(`/merchant_orders/${payment.order.id}`, seller.accessToken);
      // The preference above already binds the linked order to this application.
      if (merchant.preference_id !== preference.id || merchant.external_reference !== order.id ||
        (merchant.application_id != null && String(merchant.application_id) !== appId) ||
        String(merchant.collector?.id) !== seller.merchantUserId || !Array.isArray(merchant.payments) || !merchant.payments.some((p: Row) => String(p.id) === String(payment.id)) ||
        merchant.payments.some((p: Row) => !search.results.some((s: Row) => String(s.id) === String(p.id)))) return blocked('merchant_order_unverified');
      const refunds = await mercadoPagoRequest<Row[]>(`/v1/payments/${payment.id}/refunds`, seller.accessToken);
      if (!Array.isArray(refunds) || !refunds.length || refunds.length > 100 || new Set(refunds.map(r => String(r.id))).size !== refunds.length ||
        refunds.some(r => !numericId(r.id) || String(r.payment_id) !== String(payment.id) || r.status !== 'approved' || !Number.isFinite(r.amount) || r.amount <= 0) ||
        !paymentAmountMatches(refunds.reduce((sum, r) => sum + r.amount, 0), payment.transaction_amount)) return blocked('refunds_not_settled');
      // No status filter: include every claim, not merely the closed subset.
      const claims = await mercadoPagoRequest<Row>(`/post-purchase/v1/claims/search?resource=payment&resource_id=${payment.id}&limit=100&offset=0`, seller.accessToken);
      if (!Array.isArray(claims.data) || !Number.isInteger(claims.paging?.total) || claims.paging.offset !== 0 || claims.paging.total !== claims.data.length || claims.data.length > 100 ||
        claims.data.some((c: Row) => c.resource !== 'payment' || String(c.resource_id) !== String(payment.id) || c.status !== 'closed' || !c.resolution?.date_created)) return blocked('claims_not_closed');
      found.add(String(payment.id));
      verified.push({ id: String(payment.id), amount: payment.transaction_amount, amountRefunded: payment.transaction_amount_refunded,
        refundIds: refunds.map(r => String(r.id)).sort(), claimIds: claims.data.map((c: Row) => String(c.id)).sort(), merchantOrderId: String(payment.order.id) });
    }
    proofs.push({ order, payments: verified, hash: createHash('sha256').update(JSON.stringify(verified)).digest('hex') });
  }
  if (receipts.docs.some(r => !found.has(r.id))) return blocked('unmatched_local_receipt');
  if (!apply) return { eligible: true, purged: false, orders: proofs.length, payments: found.size, basis: 'provider_full_refund' };
  const purged = await db.runTransaction(async tx => {
    const currentOrdersQuery = db.collection('depositOrders').where('businessId', '==', ownerId).limit(MAX_ORDERS + 1);
    const currentReceiptsQuery = db.collection('depositPayments').where('businessId', '==', ownerId).limit(MAX_PAYMENTS + 1);
    const [currentTicket, currentTombstone, currentConnection, currentOrders, currentReceipts] = await Promise.all([
      tx.get(requestRef), tx.get(tombstoneRef), tx.get(connectionRef), tx.get(currentOrdersQuery), tx.get(currentReceiptsQuery),
    ]);
    const same = (a: FirebaseFirestore.DocumentSnapshot, b: FirebaseFirestore.DocumentSnapshot) => !!a.updateTime && !!b.updateTime && a.updateTime.isEqual(b.updateTime);
    if (!same(ticket, currentTicket) || !same(tombstone, currentTombstone) || !same(boundConnection, currentConnection) || currentOrders.size !== orders.size || currentReceipts.size !== receipts.size ||
      currentOrders.docs.some(r => !orders.docs.some(old => old.id === r.id && same(old, r))) ||
      currentReceipts.docs.some(r => !receipts.docs.some(old => old.id === r.id && same(old, r))) || Date.now() >= deadline) return false;
    // Read every target receipt too: a foreign owner's resource id must never be overwritten.
    const paymentRefs = [...found].map(id => db.doc(`depositPayments/${id}`));
    const targets = await Promise.all(paymentRefs.map(ref => tx.get(ref)));
    if (targets.some(r => r.exists && r.get('businessId') !== ownerId)) return false;
    for (const proof of proofs) {
      const closure = { source: 'MERCADO_PAGO_FULL_REFUND', evidenceHash: proof.hash, verifiedAt: FieldValue.serverTimestamp() };
      tx.update(proof.order.ref, { financialClosedAt: FieldValue.serverTimestamp(), financialClosure: closure });
      for (const payment of proof.payments) tx.set(db.doc(`depositPayments/${payment.id}`), {
        businessId: ownerId, orderId: proof.order.id, paymentId: payment.id, amount: payment.amount, amountRefunded: payment.amountRefunded,
        status: 'reversed', providerStatus: 'refunded', financialClosedAt: FieldValue.serverTimestamp(), financialClosure: closure,
      }, { merge: true });
    }
    tx.delete(connectionRef);
    tx.set(tombstoneRef, { marketplaceCredentialsPurgedAt: FieldValue.serverTimestamp(), marketplaceClosureBasis: 'MERCADO_PAGO_FULL_REFUND' }, { merge: true });
    tx.update(requestRef, { marketplaceCredentialsPurgedAt: FieldValue.serverTimestamp() });
    // Retain minimal accounting evidence and the tombstone; never resurrect Auth/profile.
    return true;
  });
  return { eligible: true, purged, orders: proofs.length, payments: found.size, basis: 'provider_full_refund' };
}

export async function reconcileDeletedSellerAfterPayment(paymentId: string) {
  const receipt = await getAdminFirestore().doc(`depositPayments/${paymentId}`).get();
  if (receipt.get('status') !== 'reversed' || typeof receipt.get('businessId') !== 'string') return;
  return reconcileMarketplaceFinancialClosure(receipt.get('businessId'), true);
}

/** Once credentials have been erased, do not keep retrying a duplicate forever
 * or guess its current provider state. Durably queue the signed resource for an
 * operator to recheck through the provider; no payment/booking state is changed. */
export async function deferClosedSellerEvent(paymentId: string, signedResourceId: string, topic: 'payment' | 'chargeback') {
  const db = getAdminFirestore();
  const receiptRef = db.doc(`depositPayments/${paymentId}`);
  const initial = await receiptRef.get();
  const ownerId = initial.get('businessId');
  if (typeof ownerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId) || initial.get('financialClosure.source') !== 'MERCADO_PAGO_FULL_REFUND') return false;
  const eventId = createHash('sha256').update(`${topic}:${signedResourceId}:${paymentId}`).digest('hex');
  const eventRef = db.doc(`marketplaceClosedSellerEvents/${eventId}`);
  return db.runTransaction(async tx => {
    const requestRef = db.doc(`accountDeletionRequests/${ownerId}`);
    const [receipt, request, tombstone, connection, event] = await Promise.all([
      tx.get(receiptRef), tx.get(requestRef), tx.get(db.doc(`businessDeletions/${ownerId}`)), tx.get(db.doc(`mercadoPagoConnections/${ownerId}`)), tx.get(eventRef),
    ]);
    if (receipt.get('businessId') !== ownerId || !(receipt.get('financialClosedAt') instanceof Timestamp) ||
      receipt.get('financialClosure.source') !== 'MERCADO_PAGO_FULL_REFUND' || !/^[a-f0-9]{64}$/.test(receipt.get('financialClosure.evidenceHash') || '') ||
      !(request.get('marketplaceCredentialsPurgedAt') instanceof Timestamp) || !(tombstone.get('marketplaceCredentialsPurgedAt') instanceof Timestamp) || connection.exists) return false;
    if (!event.exists) tx.create(eventRef, { businessId: ownerId, paymentIdHint: paymentId, signedResourceId, topic,
      source: 'verified_webhook_signature', status: 'manual_review_required', receivedAt: FieldValue.serverTimestamp() });
    tx.update(requestRef, { postClosureEventReviewRequired: true, postClosureEventId: eventId, lastPostClosureEventAt: FieldValue.serverTimestamp() });
    return true;
  });
}
