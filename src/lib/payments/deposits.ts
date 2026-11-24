import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import 'server-only';
import { releaseAppointmentQuota } from '@/lib/appointment-quota';
import { dateKeyInZone, BUSINESS_TIME_ZONE } from '@/lib/booking-constraints';
import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getSellerConnection, marketplaceConfiguration, marketplaceDepositUrls, mercadoPagoRequest } from './marketplace';
import { paymentAmountMatches } from './security';
import { isBusinessOperational } from '@/lib/server-membership';
import { scheduleBookingDelivery } from '@/lib/booking-delivery';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const DEPOSIT_HOLD_MS = 30 * 60000;
export function depositsAvailable(): boolean {
  try { marketplaceConfiguration(); } catch { return false; }
  return process.env.MP_MARKETPLACE_ENABLED === 'true' && !!process.env.MP_MARKETPLACE_WEBHOOK_SECRET && /^(true|false)$/.test(process.env.MP_MARKETPLACE_EXPECT_LIVE_MODE || '');
}
export function depositAmount(price: number, settings: { depositType?: unknown; depositValue?: unknown }): number {
  const value = Number(settings.depositValue);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0 || !['fixed', 'percentage'].includes(String(settings.depositType)) || settings.depositType === 'percentage' && value > 100) throw new Error('Invalid deposit settings');
  const amount = Math.round((settings.depositType === 'percentage' ? price * value / 100 : value) * 100) / 100;
  if (amount <= 0 || amount > price) throw new Error('Deposit exceeds booking price');
  return amount;
}

export type DepositOrder = {
  kind: 'deposit'; businessId: string; appointmentId: string; amount: number; currency: 'ARS';
  collectorId: string; applicationId: string; expectedLiveMode: boolean; status: string;
  createdAt: Timestamp; expiresAt: Timestamp; preferenceCreateKey: string; targetStatus: 'Confirmado' | 'Pendiente'; outboxId: string;
  preferenceId?: string; checkoutUrl?: string; paymentId?: string; paymentReviewRequired?: boolean;
};
export async function prepareDeposit(businessId: string, price: number, settings: { depositType?: unknown; depositValue?: unknown }) {
  if (!depositsAvailable()) throw new Error('Deposits unavailable');
  const seller = await getSellerConnection(businessId);
  if (seller.liveMode !== (process.env.MP_MARKETPLACE_EXPECT_LIVE_MODE === 'true')) throw new Error('Wrong marketplace mode');
  return { amount: depositAmount(price, settings), collectorId: seller.merchantUserId, applicationId: marketplaceConfiguration().clientId, expectedLiveMode: seller.liveMode };
}

/** Accepts only an order already created in the booking transaction, never a browser amount. */
export async function ensureDepositCheckout(orderId: string): Promise<string | null> {
  const db = getAdminFirestore();
  const ref = db.collection('depositOrders').doc(orderId);
  const order = (await ref.get()).data() as DepositOrder | undefined;
  if (!order || order.kind !== 'deposit' || order.paymentReviewRequired || !['pending', 'creating', 'checkout_ready'].includes(order.status) || order.expiresAt.toMillis() <= Date.now()) return null;
  const booking = await db.collection('appointments').doc(order.appointmentId).get();
  if (booking.get('businessId') !== order.businessId || booking.get('status') !== 'Pendiente' || booking.get('paymentStatus') !== 'pending') return null;
  if (order.checkoutUrl) return order.checkoutUrl;
  if (!canUseOnlineDeposits((await db.collection('businesses').doc(order.businessId).get()).get('businessType'))) return null;
  if (!depositsAvailable()) throw new Error('Deposits unavailable');
  const claim = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || !['pending', 'creating'].includes(current.status) || current.checkoutLeaseUntil instanceof Timestamp && current.checkoutLeaseUntil.toMillis() > Date.now()) return false;
    tx.update(ref, { status: 'creating', checkoutClaim: claim, checkoutLeaseUntil: Timestamp.fromMillis(Date.now() + 60000) });
    return true;
  });
  if (!claimed) return null;
  try {
    const [seller, appointment, business] = await Promise.all([getSellerConnection(order.businessId), db.collection('appointments').doc(order.appointmentId).get(), db.collection('businesses').doc(order.businessId).get()]);
    if (seller.merchantUserId !== order.collectorId || seller.liveMode !== order.expectedLiveMode || !isBusinessOperational(business.data()) || appointment.get('status') !== 'Pendiente' || appointment.get('paymentStatus') !== 'pending') throw new Error('Deposit order changed');
    const urls = marketplaceDepositUrls(orderId);
    const provider = await mercadoPagoRequest<{ id: string; init_point: string; sandbox_init_point?: string; collector_id: number; client_id: string; external_reference: string; marketplace_fee?: number; notification_url: string; expires: boolean; expiration_date_to: string; items: Array<{ quantity: number; unit_price: number; currency_id: string }> }>('/checkout/preferences', seller.accessToken, {
      method: 'POST', headers: { 'X-Idempotency-Key': order.preferenceCreateKey }, body: JSON.stringify({
        items: [{ id: order.appointmentId, title: `Seña de reserva en ${String(business.get('name')).slice(0, 100)}`, quantity: 1, unit_price: order.amount, currency_id: 'ARS' }],
        payer: { email: appointment.get('clientEmail') }, external_reference: orderId, marketplace_fee: 0,
        notification_url: urls.notification,
        back_urls: { success: urls.returnTo, failure: urls.returnTo, pending: urls.returnTo },
        auto_return: 'approved', statement_descriptor: 'PEDITURNO', expires: true, expiration_date_from: order.createdAt.toDate().toISOString(), expiration_date_to: order.expiresAt.toDate().toISOString(),
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
      }),
    });
    // Re-read what Mercado Pago actually persisted before exposing a checkout.
    const saved = await mercadoPagoRequest<typeof provider>(`/checkout/preferences/${encodeURIComponent(provider.id)}`, seller.accessToken);
    const checkoutUrl = order.expectedLiveMode ? saved.init_point : saved.sandbox_init_point;
    const url = new URL(checkoutUrl || '');
    if (url.protocol !== 'https:' || url.username || url.password || !['www.mercadopago.com.ar', 'www.mercadopago.com', 'sandbox.mercadopago.com.ar', 'sandbox.mercadopago.com'].includes(url.hostname) || saved.id !== provider.id || saved.external_reference !== orderId || String(saved.collector_id) !== order.collectorId || String(saved.client_id) !== order.applicationId || (saved.marketplace_fee || 0) !== 0 || saved.notification_url !== urls.notification || saved.expires !== true || Date.parse(saved.expiration_date_to) !== order.expiresAt.toMillis() || saved.items?.length !== 1 || saved.items[0].quantity !== 1 || saved.items[0].currency_id !== 'ARS' || !paymentAmountMatches(saved.items[0].unit_price, order.amount)) throw new Error('Preference validation failed');
    const accepted = await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const booking = await tx.get(db.collection('appointments').doc(order.appointmentId));
      if (current.get('checkoutClaim') !== claim || !['creating', 'checkout_ready'].includes(current.get('status')) || booking.get('status') !== 'Pendiente' || booking.get('paymentStatus') !== 'pending') return false;
      tx.update(ref, { status: 'checkout_ready', preferenceId: saved.id, checkoutUrl: url.toString(), checkoutLeaseUntil: FieldValue.delete() });
      return true;
    });
    return accepted ? url.toString() : null;
  } catch {
    // Keep the same idempotency key after an uncertain network result.
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.get('checkoutClaim') === claim && current.get('status') === 'creating') tx.update(ref, { checkoutLeaseUntil: FieldValue.delete() });
    }).catch(() => undefined);
    throw new Error('Deposit checkout unavailable');
  }
}

type SellerPayment = { id: number | string; status: string; external_reference: string; collector_id: number | string; currency_id: string; transaction_amount: number; transaction_amount_refunded?: number; live_mode: boolean; date_approved?: string; order?: { id?: string | number } };
export function depositPaymentMatches(payment: SellerPayment, orderId: string, order: DepositOrder): boolean {
  return payment.external_reference === orderId && String(payment.collector_id) === order.collectorId && payment.currency_id === order.currency && paymentAmountMatches(payment.transaction_amount, order.amount) && payment.live_mode === order.expectedLiveMode;
}

export async function processDepositPayment(paymentId: string, orderId?: string, merchantId?: string): Promise<{ processed: boolean; duplicate?: boolean }> {
  const db = getAdminFirestore();
  let orderSnap = orderId ? await db.collection('depositOrders').doc(orderId).get() : null;
  let businessId = orderSnap?.get('businessId');
  // App-wide webhooks lack a preference query parameter. A seller's signed event
  // supplies a lookup hint only; GET /payments plus immutable terms establish trust.
  if (!businessId && merchantId && /^\d{1,32}$/.test(merchantId)) {
    businessId = (await db.collection('mercadoPagoConnections').where('merchantUserId', '==', merchantId).limit(1).get()).docs[0]?.id;
  }
  if (typeof businessId !== 'string') throw new Error('Deposit seller unavailable');
  const seller = await getSellerConnection(businessId, true);
  const payment = await mercadoPagoRequest<SellerPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`, seller.accessToken);
  if (String(payment.id) !== paymentId || !/^[A-Za-z0-9_-]{20,128}$/.test(payment.external_reference)) throw new Error('Invalid deposit payment');
  orderId ??= payment.external_reference;
  orderSnap ??= await db.collection('depositOrders').doc(orderId).get();
  const order = orderSnap.data() as DepositOrder;
  if (!order || !depositPaymentMatches(payment, orderId, order) || seller.merchantUserId !== order.collectorId) throw new Error('Payment does not match deposit order');
  if (!payment.order?.id || !/^[\w-]{1,128}$/.test(String(payment.order.id))) throw new Error('Merchant order unavailable');
  const providerOrder = await mercadoPagoRequest<{ preference_id: string; external_reference: string; application_id?: string | number | null; collector: { id: string | number }; payments: Array<{ id: string | number }> }>(`/merchant_orders/${encodeURIComponent(payment.order.id)}`, seller.accessToken);
  if (!order.preferenceId || providerOrder.preference_id !== order.preferenceId || providerOrder.external_reference !== orderId ||
    String(providerOrder.collector?.id) !== order.collectorId || !providerOrder.payments?.some(item => String(item.id) === paymentId) ||
    (providerOrder.application_id != null && String(providerOrder.application_id) !== order.applicationId)) throw new Error('Merchant order does not match');
  // Mercado Pago can omit application_id on a merchant order. In that case,
  // look up the exact linked preference, whose client_id identifies the app.
  if (providerOrder.application_id == null) {
    const preference = await mercadoPagoRequest<{ id: string; external_reference: string; collector_id: string | number; client_id: string | number }>(`/checkout/preferences/${encodeURIComponent(order.preferenceId)}`, seller.accessToken);
    if (preference.id !== order.preferenceId || preference.external_reference !== orderId ||
      String(preference.collector_id) !== order.collectorId || String(preference.client_id) !== order.applicationId) throw new Error('Merchant order preference does not match');
  }
  const ref = orderSnap.ref;
  const paymentRef = db.collection('depositPayments').doc(paymentId);
  const bookingRef = db.collection('appointments').doc(order.appointmentId);
  const result = await db.runTransaction(async tx => {
    const [current, booking, receipt, business] = await Promise.all([tx.get(ref), tx.get(bookingRef), tx.get(paymentRef), tx.get(db.collection('businesses').doc(order.businessId))]);
    if (!booking.exists || booking.get('businessId') !== order.businessId || current.get('collectorId') !== order.collectorId) throw new Error('Deposit source unavailable');
    const returned = Number(payment.transaction_amount_refunded || 0);
    const reversed = ['refunded', 'charged_back'].includes(payment.status) || returned > 0;
    if (!reversed && payment.status !== 'approved') return { processed: false };
    // A reversal is terminal; reviewed money can still be refunded or charged back.
    // Ignore repeated approvals without suppressing that later provider evidence.
    if (receipt.get('status') === 'reversed' || !reversed && ['review', 'approved'].includes(receipt.get('status'))) return { processed: false, duplicate: true };
    const evidence = { businessId: order.businessId, orderId, paymentId, amount: payment.transaction_amount, amountRefunded: returned, providerStatus: payment.status, updatedAt: FieldValue.serverTimestamp() };
    if (reversed) {
      tx.set(paymentRef, { ...evidence, status: 'reversed' });
      // Never cancel a booking automatically after a refund: preserve the schedule
      // and flag it for the seller to decide. Secondary charges cannot erase a paid primary.
      if (!current.get('paymentId') || current.get('paymentId') === paymentId) {
        tx.update(ref, { status: 'reversal_review', paymentId });
        markOwnerAgendaChanged(tx, db, order.businessId); tx.update(bookingRef, { paymentStatus: 'reversal_review', paymentReviewRequired: true });
      } else tx.update(ref, { secondaryPaymentReviewRequired: true });
      return { processed: true };
    }
    const approvedAt = Date.parse(payment.date_approved || '');
    const mayCredit = ['pending', 'creating', 'checkout_ready'].includes(current.get('status')) && booking.get('status') === 'Pendiente' && booking.get('paymentStatus') === 'pending' &&
      !current.get('paymentId') && isBusinessOperational(business.data()) && Number.isFinite(approvedAt) && approvedAt >= order.createdAt.toMillis() && approvedAt <= order.expiresAt.toMillis();
    if (!mayCredit) {
      tx.set(paymentRef, { ...evidence, status: 'review' });
      tx.update(ref, { paymentReviewRequired: true, reviewPaymentId: paymentId });
      markOwnerAgendaChanged(tx, db, order.businessId); tx.update(bookingRef, { paymentReviewRequired: true });
      return { processed: true };
    }
    tx.set(paymentRef, { ...evidence, status: 'approved' });
    tx.update(ref, { status: 'approved', paymentId, approvedAt: FieldValue.serverTimestamp() });
    markOwnerAgendaChanged(tx, db, order.businessId); tx.update(bookingRef, { status: order.targetStatus, paymentStatus: 'paid', depositPaid: order.amount, paymentId, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.collection('bookingEmailOutbox').doc(order.outboxId), { status: 'pending', availableAt: Timestamp.now() });
    return { processed: true, outboxId: order.outboxId };
  });
  if ('outboxId' in result && result.outboxId) scheduleBookingDelivery(result.outboxId);
  return result;
}

/** Expired holds release only their own slot locks. Late money becomes a durable review. */
export async function expireDepositHolds(now = Date.now()) {
  const db = getAdminFirestore();
  const cursorRef = db.collection('maintenanceJobs').doc('deposit-expiry');
  const cursor = (await cursorRef.get()).data();
  let query = db.collection('depositOrders').where('status', 'in', ['pending', 'creating', 'checkout_ready']).where('expiresAt', '<=', Timestamp.fromMillis(now)).orderBy('expiresAt').orderBy(FieldPath.documentId()).limit(10);
  if (cursor?.expiresAt instanceof Timestamp && typeof cursor.id === 'string') query = query.startAfter(cursor.expiresAt, cursor.id);
  const snapshot = await query.get();
  const deadline = Date.now() + 25000;
  let last: { expiresAt: Timestamp; id: string } | null = null;
  let expired = 0;
  let failed = 0;
  for (const orderSnap of snapshot.docs) {
    if (Date.now() >= deadline) break;
    // Advance past failed provider checks so one account cannot starve other holds.
    last = { expiresAt: orderSnap.get('expiresAt'), id: orderSnap.id };
    if (!['pending', 'creating', 'checkout_ready'].includes(orderSnap.get('status'))) continue;
    try {
      const seller = await getSellerConnection(orderSnap.get('businessId'), true);
      const payments = await mercadoPagoRequest<{ results: Array<{ id: number | string; status: string }> }>(`/v1/payments/search?external_reference=${encodeURIComponent(orderSnap.id)}&limit=10`, seller.accessToken);
      if (!Array.isArray(payments.results) || payments.results.length >= 10) throw new Error('Unbounded payment history');
      // Never release a paid slot merely because its webhook arrived late.
      for (const payment of payments.results) {
        if (['approved', 'refunded', 'charged_back'].includes(payment.status)) await processDepositPayment(String(payment.id), orderSnap.id);
        else if (['pending', 'in_process', 'authorized'].includes(payment.status)) throw new Error('Payment still in process');
      }
      await db.runTransaction(async tx => {
      const current = await tx.get(orderSnap.ref);
      if (!['pending', 'creating', 'checkout_ready'].includes(current.get('status'))) return;
      const appointmentRef = db.collection('appointments').doc(current.get('appointmentId'));
      const booking = await tx.get(appointmentRef);
      const slots: string[] = booking.get('bookingSlotIds') || [];
      const refs = slots.map(id => db.collection('bookingSlots').doc(id));
      const owned = await Promise.all(refs.map(ref => tx.get(ref)));
      if (booking.get('paymentStatus') === 'pending') {
        const business = await tx.get(db.doc(`businesses/${booking.get('businessId')}`));
        const zone = business.get('timeZone') || BUSINESS_TIME_ZONE;
        const date = booking.get('date');
        if (date instanceof Timestamp) await releaseAppointmentQuota(tx, db, booking.get('businessId'), dateKeyInZone(date.toDate(), zone), zone);
      }
      tx.update(orderSnap.ref, { status: 'expired', expiredAt: Timestamp.fromMillis(now) });
      if (booking.get('paymentStatus') === 'pending') {
        markOwnerAgendaChanged(tx, db, booking.get('businessId')); tx.update(appointmentRef, { status: 'Cancelado', paymentStatus: 'expired', cancelledReason: 'deposit_timeout', updatedAt: FieldValue.serverTimestamp() });
        owned.forEach((slot, index) => { if (slot.get('appointmentId') === appointmentRef.id) tx.delete(refs[index]); });
        tx.update(db.collection('bookingEmailOutbox').doc(current.get('outboxId')), { status: 'cancelled', encryptedToken: FieldValue.delete() });
      }
      expired++;
    });
    } catch { failed++; }
  }
  const exhausted = snapshot.empty || snapshot.size < 10 && last?.id === snapshot.docs.at(-1)?.id;
  await cursorRef.set(exhausted ? { expiresAt: null, id: null } : last || cursor || { expiresAt: null, id: null });
  return { expired, failed };
}
