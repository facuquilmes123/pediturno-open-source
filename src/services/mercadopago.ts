'use server';

import crypto from 'crypto';
import { addMonths } from 'date-fns';
import MercadoPagoConfig, { MerchantOrder, Payment, Preference } from 'mercadopago';
import { FieldValue, Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getMembershipPlanVertical, getMembershipPriceArs, usesGooglePlayMembership, type MembershipPlanVertical } from '@/lib/config';
import { getVerticalFromBusinessType, getVerticalOrigin, type ProductVertical } from '@/lib/verticals';
import { requireFirebaseUser } from '@/lib/payments/auth';
import { depositsAvailable } from '@/lib/payments/deposits';
import { getSellerConnection } from '@/lib/payments/marketplace';
import { isBusinessOperational } from '@/lib/server-membership';
import { canUseOnlineDeposits, SERVICES_DEPOSITS_UNAVAILABLE } from '@/lib/release-features';
import {
  createOpaqueId,
  isOpaqueOrderId,
  paymentAmountMatches,
} from '@/lib/payments/security';

// Webhooks are verified by the central Pediturno deployment. Checkout returns
// are intentionally selected from the immutable order/profile vertical below.
const PLATFORM_ORIGIN = 'https://pediturno.com';
const PAYMENT_ORDER_TTL_MS = 30 * 60 * 1000;
const SERVICES_PLAY_ONLY = 'La membresía de PediTurno Servicios se contrata exclusivamente desde Google Play. Los períodos ya abonados se conservan.';

type ActionResult = { success: boolean; message: string };

interface MembershipPaymentOrder {
  kind: 'membership';
  businessId: string;
  amount: number;
  currency: 'ARS';
  /** Immutable commercial terms, captured from the server-side profile. */
  plan?: 'monthly_membership';
  vertical?: MembershipPlanVertical;
  collectorId: string;
  applicationId: string;
  expectedLiveMode: boolean;
  status: 'pending' | 'approved' | 'preference_failed' | 'preference_create_uncertain' | 'reversed' | 'reversal_pending_review' | 'payment_conflict_review';
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  preferenceId?: string | null;
  /** Stable UUID sent as X-Idempotency-Key for every retry of this preference. */
  preferenceCreateKey: string;
  paymentId?: string;
}

type MembershipSnapshot = Record<string, unknown> | null;

type MembershipPaymentCredit = {
  paymentId: string;
  orderId: string;
  businessId: string;
  status: 'active' | 'reversed' | 'reversed_uncredited' | 'reversal_pending_review' | 'partial_refund_review' | 'approval_pending_review';
  previousMembership: MembershipSnapshot;
  grantedMembership?: Record<string, unknown>;
  createdAt?: unknown;
  reversalStatus?: string;
  reviewReason?: string;
  reversalRecordedAt?: unknown;
  reversedAt?: unknown;
  amountRefunded?: number | null;
  providerStatusDetail?: string | null;
  disputeStatus?: string;
};

function timestampMillis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis() as number;
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

function copyMembership(value: unknown): MembershipSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

/**
 * A reversal can change the live membership only when it is still exactly the
 * grant created for this payment. This deliberately leaves later renewals and
 * manual/lifetime grants untouched and sends them to durable review instead.
 */
function membershipStillMatchesCredit(
  membership: unknown,
  grantedMembership: Record<string, unknown> | undefined,
  paymentId: string,
): boolean {
  if (!membership || typeof membership !== 'object' || !grantedMembership) return false;
  const current = membership as Record<string, unknown>;
  return current.type === 'pro'
    && current.paymentId === paymentId
    && current.startsAt !== undefined
    && current.expiresAt !== undefined
    && current.type === grantedMembership.type
    && timestampMillis(current.startsAt) === timestampMillis(grantedMembership.startsAt)
    && timestampMillis(current.expiresAt) === timestampMillis(grantedMembership.expiresAt);
}

/**
 * Walk back paid grants that have already been fully reversed. This prevents a
 * later refund from restoring a snapshot whose own payment was refunded. The
 * walk is deliberately bounded and stops for partial/manual-review credits.
 */
async function resolveRestorableMembership(
  transaction: { get: (ref: any) => Promise<{ exists: boolean; data: () => unknown }> },
  db: ReturnType<typeof getAdminFirestore>,
  credit: MembershipPaymentCredit,
): Promise<{ restorable: boolean; membership?: MembershipSnapshot }> {
  let candidate = credit.previousMembership;
  for (let depth = 0; depth < 8; depth += 1) {
    const sourcePaymentId = candidate?.paymentId;
    if (typeof sourcePaymentId !== 'string' || !sourcePaymentId) return { restorable: true, membership: candidate };

    const sourceCreditSnapshot = await transaction.get(db.collection('membershipPaymentCredits').doc(sourcePaymentId));
    if (!sourceCreditSnapshot.exists) return { restorable: false };
    const sourceCredit = sourceCreditSnapshot.data() as MembershipPaymentCredit;
    if (sourceCredit.status === 'active') return { restorable: true, membership: candidate };
    if (sourceCredit.status !== 'reversed' && sourceCredit.status !== 'reversed_uncredited') return { restorable: false };
    candidate = sourceCredit.previousMembership;
  }
  return { restorable: false };
}

function getPlatformAccessToken(): string {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('La configuración de cobros no está disponible.');
  return accessToken;
}

function getPlatformPaymentConfiguration(): { applicationId: string } {
  if (process.env.MP_PAYMENTS_ENABLED !== 'true') {
    throw new Error('Los cobros con Mercado Pago todavía no están habilitados.');
  }
  if (!process.env.MP_WEBHOOK_SECRET?.trim()) {
    throw new Error('La conciliación de cobros no está configurada.');
  }
  const applicationId = process.env.MP_PLATFORM_APPLICATION_ID?.trim();
  if (!applicationId || !/^\d{1,32}$/.test(applicationId)) {
    throw new Error('La aplicación de cobros no está configurada.');
  }
  return { applicationId };
}

function getMercadoPagoClient(): MercadoPagoConfig {
  return new MercadoPagoConfig({ accessToken: getPlatformAccessToken() });
}

function expectedLiveMode(): boolean {
  const configured = process.env.MP_EXPECT_LIVE_MODE;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return !getPlatformAccessToken().startsWith('TEST-');
}

async function getPlatformCollectorId(): Promise<string> {
  const configured = process.env.MP_COLLECTOR_ID?.trim();
  if (configured && /^\d{1,32}$/.test(configured)) return configured;

  const response = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${getPlatformAccessToken()}` },
    cache: 'no-store',
  });
  const profile = await response.json().catch(() => null) as { id?: number | string } | null;
  if (!response.ok || !profile?.id || !/^\d{1,32}$/.test(String(profile.id))) {
    throw new Error('No se pudo verificar la cuenta receptora de Mercado Pago.');
  }
  return String(profile.id);
}

async function createMembershipOrder(businessId: string): Promise<{
  id: string;
  order: MembershipPaymentOrder;
  checkoutVertical: MembershipPlanVertical;
}> {
  const db = getAdminFirestore();
  const collectorId = await getPlatformCollectorId();
  const { applicationId } = getPlatformPaymentConfiguration();
  const createdAt = AdminTimestamp.fromMillis(Date.now());
  const id = createOpaqueId(24);
  const businessRef = db.collection('businesses').doc(businessId);
  const orderRef = db.collection('paymentOrders').doc(id);
  const lockRef = db.collection('membershipPaymentOrderLocks').doc(businessId);
  const created = await db.runTransaction(async transaction => {
    const [businessSnapshot, lockSnapshot] = await Promise.all([transaction.get(businessRef), transaction.get(lockRef)]);
    if (!businessSnapshot.exists) throw new Error('Negocio no encontrado.');
    if (businessSnapshot.get('status') !== 'active') {
      throw new Error('El negocio debe estar activo para adquirir el plan.');
    }
    const currentMembership = copyMembership(businessSnapshot.get('membership'));
    if (currentMembership?.type === 'lifetime') {
      throw new Error('Una membresía de por vida no puede generar un cobro mensual.');
    }
    const checkoutVertical = getMembershipPlanVertical(businessSnapshot.get('businessType'));
    if (usesGooglePlayMembership(checkoutVertical)) {
      throw new Error(SERVICES_PLAY_ONLY);
    }
    const lockExpiresAt = lockSnapshot.exists ? timestampMillis(lockSnapshot.get('expiresAt')) : null;
    if (lockExpiresAt !== null && lockExpiresAt > Date.now()) {
      const lockedOrderId = lockSnapshot.get('orderId');
      if (typeof lockedOrderId === 'string') {
        const lockedOrderSnapshot = await transaction.get(db.collection('paymentOrders').doc(lockedOrderId));
        const lockedOrder = lockedOrderSnapshot.exists ? lockedOrderSnapshot.data() as MembershipPaymentOrder : null;
        // A connection timeout is ambiguous: Mercado Pago may have created the
        // preference. Retrying the exact server-stored request key is safe and
        // lets the provider return that same preference instead of orphaning it.
        if (lockedOrder
          && lockedOrder.kind === 'membership'
          && lockedOrder.businessId === businessId
          && (lockedOrder.status === 'pending' || lockedOrder.status === 'preference_create_uncertain')
          && typeof lockedOrder.preferenceCreateKey === 'string') {
          // Old orders predate the vertical field. Preserve their immutable
          // amount, but select their return portal from the persisted profile.
          return { id: lockedOrderId, order: lockedOrder, checkoutVertical: lockedOrder.vertical ?? checkoutVertical };
        }
      }
      throw new Error('Ya hay un checkout de membresía pendiente.');
    }
    // The price is never accepted from the browser. It is calculated only
    // after reading the owner profile in this transaction, then persisted on
    // the order so retries, reconciliation and historical payments retain the
    // exact commercial terms they were created with.
    const vertical = checkoutVertical;
    const order: MembershipPaymentOrder = {
      kind: 'membership',
      businessId,
      amount: getMembershipPriceArs(vertical),
      currency: 'ARS',
      plan: 'monthly_membership',
      vertical,
      collectorId,
      applicationId,
      expectedLiveMode: expectedLiveMode(),
      status: 'pending',
      preferenceCreateKey: crypto.randomUUID(),
      createdAt,
      expiresAt: AdminTimestamp.fromMillis(createdAt.toMillis() + PAYMENT_ORDER_TTL_MS),
    };
    transaction.create(orderRef, order);
    transaction.set(lockRef, { businessId, orderId: id, expiresAt: order.expiresAt, createdAt: FieldValue.serverTimestamp() });
    return { id, order, checkoutVertical };
  });
  return created;
}

async function releaseMembershipOrderLock(businessId: string, orderId: string): Promise<void> {
  const db = getAdminFirestore();
  const lockRef = db.collection('membershipPaymentOrderLocks').doc(businessId);
  await db.runTransaction(async transaction => {
    const lockSnapshot = await transaction.get(lockRef);
    if (lockSnapshot.exists && lockSnapshot.get('orderId') === orderId) transaction.delete(lockRef);
  });
}

export async function createPaymentPreference({ idToken }: { idToken: string }): Promise<ActionResult & { init_point?: string }> {
  let orderId: string | undefined;
  let businessId: string | undefined;
  let preferenceRequestStarted = false;
  try {
    getPlatformPaymentConfiguration();
    const user = await requireFirebaseUser(idToken);
    businessId = user.uid;
    const { id, order, checkoutVertical } = await createMembershipOrder(user.uid);
    orderId = id;
    const productVertical: ProductVertical = getVerticalFromBusinessType(checkoutVertical);
    const checkoutOrigin = getVerticalOrigin(productVertical);
    const isSportsCheckout = productVertical === 'sports_facility';
    const isSpacesCheckout = productVertical === 'spaces';
    const preference = new Preference(getMercadoPagoClient());
    preferenceRequestStarted = true;
    const result = await preference.create({
      body: {
        items: [{
          id: `membership-${orderId}`,
          title: isSpacesCheckout ? 'Suscripción mensual a Pediturno Espacios' : isSportsCheckout ? 'Suscripción mensual a Pediturno Canchas' : 'Suscripción mensual a Pediturno Servicios',
          quantity: 1,
          unit_price: order.amount,
          currency_id: order.currency,
          description: isSpacesCheckout
            ? 'Acceso por 1 mes a Pediturno Espacios para gestionar reservas de salones y espacios.'
            : isSportsCheckout
            ? 'Acceso por 1 mes a Pediturno Canchas para gestionar reservas deportivas.'
            : 'Acceso por 1 mes a Pediturno Servicios para gestionar turnos.',
        }],
        payer: user.email ? { email: user.email } : undefined,
        back_urls: {
          success: `${checkoutOrigin}/dashboard/membresia?status=approved`,
          failure: `${checkoutOrigin}/dashboard/membresia?status=failure`,
          pending: `${checkoutOrigin}/dashboard/membresia?status=pending`,
        },
        auto_return: 'approved',
        external_reference: orderId,
        notification_url: `${PLATFORM_ORIGIN}/api/webhooks/mercadopago`,
        // The provider checkout must close at exactly the same point as our
        // server-side order. Otherwise an approved late payment would be
        // rejected by the webhook and leave the payer without a membership.
        expires: true,
        expiration_date_from: order.createdAt.toDate().toISOString(),
        expiration_date_to: order.expiresAt.toDate().toISOString(),
      },
      requestOptions: { idempotencyKey: order.preferenceCreateKey },
    });

    if (!result.init_point || !result.id) throw new Error('Mercado Pago no devolvió una preferencia de pago completa.');
    const confirmed = await preference.get({ preferenceId: result.id });
    const item = confirmed.items?.[0];
    if (
      confirmed.id !== result.id ||
      confirmed.init_point !== result.init_point ||
      String(confirmed.client_id ?? '') !== order.applicationId ||
      String(confirmed.collector_id ?? '') !== order.collectorId ||
      confirmed.external_reference !== orderId ||
      confirmed.items?.length !== 1 ||
      item?.quantity !== 1 ||
      Number(item?.unit_price) !== order.amount ||
      item?.currency_id !== order.currency ||
      Number(confirmed.marketplace_fee ?? 0) !== 0 ||
      confirmed.notification_url !== `${PLATFORM_ORIGIN}/api/webhooks/mercadopago`
    ) {
      throw new Error('La preferencia de Mercado Pago no coincide con la aplicación y la orden esperadas.');
    }
    await getAdminFirestore().collection('paymentOrders').doc(orderId).update({
      preferenceId: result.id,
      status: 'pending',
      preferenceConfirmedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, init_point: result.init_point, message: 'Preferencia creada.' };
  } catch (error) {
    if (error instanceof Error && error.message === SERVICES_PLAY_ONLY) {
      return { success: false, message: SERVICES_PLAY_ONLY };
    }
    if (orderId) {
      // Once the provider request starts, a timeout or a failed validation is
      // ambiguous: it may already have created a payable checkout. Keep the
      // internal order and lock so a retry reuses its idempotency key.
      const status = preferenceRequestStarted ? 'preference_create_uncertain' : 'preference_failed';
      await getAdminFirestore().collection('paymentOrders').doc(orderId).update({
        status,
        preferenceCreateFailureRecordedAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);
      if (!preferenceRequestStarted && businessId) await releaseMembershipOrderLock(businessId, orderId).catch(() => undefined);
    }
    console.error('[MP Membership Preference] Failed to create payment preference.');
    return { success: false, message: 'No se pudo iniciar el pago. Verificá tu sesión e intentá nuevamente.' };
  }
}

export async function disconnectMercadoPagoAccount(idToken: string): Promise<ActionResult> {
  try {
    const user = await requireFirebaseUser(idToken);
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(user.uid);
    await db.runTransaction(async transaction => {
      const business = await transaction.get(businessRef);
      if (!business.exists) throw new Error('Negocio no encontrado.');
      // Stop new checkouts, retain encrypted credentials for settlement/refund
      // notifications of existing charges until their financial retention ends.
      transaction.set(db.collection('mercadoPagoConnections').doc(user.uid), { active: false, disconnectedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(businessRef, {
        'mercadopago.isConnected': false,
        'mercadopago.userId': FieldValue.delete(),
        'mercadopago.publicKey': FieldValue.delete(),
        'mercadopago.accessToken': FieldValue.delete(),
        'mercadopago.refreshToken': FieldValue.delete(),
        'mercadopago.requireDeposit': false,
      });
    });
    return { success: true, message: 'Cuenta de Mercado Pago desvinculada.' };
  } catch (error) {
    console.error('[MP Disconnect] Failed.');
    return { success: false, message: 'No se pudo desvincular la cuenta de Mercado Pago.' };
  }
}

export async function updateMercadoPagoSettings(
  idToken: string,
  settings: { requireDeposit?: boolean; depositType?: 'fixed' | 'percentage'; depositValue?: number },
): Promise<ActionResult> {
  try {
    const user = await requireFirebaseUser(idToken);
    const requireDeposit = settings.requireDeposit === true;
    if (requireDeposit && !depositsAvailable()) return { success: false, message: 'El servicio de señas todavía no está configurado.' };
    const depositType = settings.depositType === 'percentage' ? 'percentage' : 'fixed';
    const depositValue = Number(settings.depositValue ?? 0);
    const maximum = depositType === 'percentage' ? 100 : 1_000_000;
    if (!Number.isFinite(depositValue) || depositValue < 0 || depositValue > maximum || requireDeposit && depositValue === 0) {
      return { success: false, message: 'El valor de la seña no es válido.' };
    }

    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(user.uid);
    if (requireDeposit && !canUseOnlineDeposits((await businessRef.get()).get('businessType'))) {
      return { success: false, message: SERVICES_DEPOSITS_UNAVAILABLE };
    }
    const seller = requireDeposit ? await getSellerConnection(user.uid) : null;
    await db.runTransaction(async tx => {
      const business = await tx.get(businessRef);
      if (requireDeposit && !canUseOnlineDeposits(business.get('businessType'))) throw new Error(SERVICES_DEPOSITS_UNAVAILABLE);
      const connection = await tx.get(db.collection('mercadoPagoConnections').doc(user.uid));
      if (!isBusinessOperational(business.data()) || seller && (connection.get('active') === false || !connection.get('encryptedAccessToken') || connection.get('merchantUserId') !== seller.merchantUserId || seller.liveMode !== (process.env.MP_MARKETPLACE_EXPECT_LIVE_MODE === 'true'))) throw new Error('Seller connection unavailable');
      tx.update(businessRef, {
      'mercadopago.requireDeposit': requireDeposit,
      'mercadopago.depositType': depositType,
      'mercadopago.depositValue': Math.round(depositValue * 100) / 100,
      });
    });
    return { success: true, message: 'Configuración de señas actualizada.' };
  } catch (error) {
    console.error('[MP Settings] Failed.');
    return { success: false, message: 'No se pudieron guardar los ajustes de seña.' };
  }
}

/** Credits a platform membership only for a valid, server-created order. */
export async function processWebhookNotificationAdmin(paymentId: string): Promise<{ processed: boolean; duplicate?: boolean }> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(paymentId)) throw new Error('Identificador de pago inválido.');

  const paymentDetails = await new Payment(getMercadoPagoClient()).get({ id: paymentId }) as unknown as Record<string, unknown>;
  const orderId = paymentDetails.external_reference;
  if (!isOpaqueOrderId(orderId)) throw new Error('La referencia de pago no corresponde a una orden interna.');

  const db = getAdminFirestore();
  const orderRef = db.collection('paymentOrders').doc(orderId);
  const processedRef = db.collection('processedPayments').doc(paymentId);
  const creditRef = db.collection('membershipPaymentCredits').doc(paymentId);
  const paymentStatus = typeof paymentDetails.status === 'string' ? paymentDetails.status : '';
  const paymentStatusDetail = typeof paymentDetails.status_detail === 'string' ? paymentDetails.status_detail : null;
  // Mercado Pago can preserve an approved/processed status while reporting a
  // partial refund in status_detail. That remaining balance is real money, so
  // it must go to review instead of granting a full monthly membership.
  const isPartialRefund = paymentStatus === 'partially_refunded'
    || ((paymentStatus === 'approved' || paymentStatus === 'processed') && paymentStatusDetail === 'partially_refunded');
  const isFullRefund = paymentStatus === 'refunded'
    || ((paymentStatus === 'approved' || paymentStatus === 'processed') && paymentStatusDetail === 'refunded');
  // A chargeback in_process is a dispute, not a completed reversal. Mercado
  // Pago documents `settled` as refunded to the buyer and `reimbursed` as
  // credited to the seller, so only the former may revoke an entitlement.
  const isChargebackInProcess = paymentStatus === 'charged_back' && paymentStatusDetail === 'in_process';
  const isChargebackSettled = paymentStatus === 'charged_back' && paymentStatusDetail === 'settled';
  const isChargebackReimbursed = paymentStatus === 'charged_back' && paymentStatusDetail === 'reimbursed';
  const isTerminalReversal = isFullRefund || isChargebackSettled;
  const ledgerStatus = isPartialRefund ? 'partially_refunded' : isFullRefund ? 'refunded' : paymentStatus;
  if (ledgerStatus !== 'approved' && !isPartialRefund && !isTerminalReversal && !isChargebackInProcess && !isChargebackReimbursed) return { processed: false };

  // Checkout Pro's documented payment response links to a merchant order.
  // Resolve that server-side object rather than trusting undocumented payment
  // fields: it binds the payment to our exact preference and MP application.
  const providerOrderId = (paymentDetails.order as { id?: unknown } | undefined)?.id;
  if (typeof providerOrderId !== 'string' && typeof providerOrderId !== 'number') {
    throw new Error('El pago no está vinculado a una orden de Mercado Pago.');
  }
  const providerOrder = await new MerchantOrder(getMercadoPagoClient()).get({ merchantOrderId: providerOrderId });

  return db.runTransaction(async transaction => {
    const [processedSnapshot, orderSnapshot, creditSnapshot] = await Promise.all([
      transaction.get(processedRef),
      transaction.get(orderRef),
      transaction.get(creditRef),
    ]);
    if (!orderSnapshot.exists) throw new Error('Orden de pago no encontrada.');

    const order = orderSnapshot.data() as MembershipPaymentOrder;
    // An order can retain a primary credited payment while another provider
    // payment for the same preference is under review. Every branch below
    // must preserve this attribution for the secondary payment.
    const isSecondaryPayment = typeof order.paymentId === 'string' && order.paymentId !== paymentId;
    // Expiration controls when checkout can begin. A signed, provider-confirmed
    // payment may arrive after that instant (webhook delivery can be delayed);
    // denying credit then would charge the customer without service.
    if (
      !paymentAmountMatches(paymentDetails.transaction_amount, order.amount) ||
      paymentDetails.currency_id !== order.currency ||
      String(paymentDetails.collector_id ?? '') !== order.collectorId ||
      paymentDetails.live_mode !== order.expectedLiveMode ||
      !order.preferenceId ||
      providerOrder.preference_id !== order.preferenceId ||
      providerOrder.external_reference !== orderId ||
      String(providerOrder.collector?.id ?? '') !== order.collectorId ||
      String(providerOrder.application_id ?? '') !== order.applicationId ||
      !providerOrder.payments?.some(providerPayment => String(providerPayment.id ?? '') === paymentId)
    ) {
      throw new Error('Los datos del pago no coinciden con la orden.');
    }
    const providerEvidence = {
      merchantOrderId: String(providerOrderId),
      preferenceId: order.preferenceId,
      applicationId: order.applicationId,
      providerStatusDetail: paymentStatusDetail,
      amountRefunded: typeof paymentDetails.transaction_amount_refunded === 'number' ? paymentDetails.transaction_amount_refunded : null,
      moneyReleaseStatus: typeof paymentDetails.money_release_status === 'string' ? paymentDetails.money_release_status : null,
      moneyReleaseDate: typeof paymentDetails.money_release_date === 'string' ? paymentDetails.money_release_date : null,
    };

    // A payment ID may never be re-attributed to another internal order.
    if (processedSnapshot.exists && processedSnapshot.get('orderId') !== orderId) {
      throw new Error('El pago ya está asociado a otra orden.');
    }

    if (isChargebackInProcess) {
      const priorStatus = processedSnapshot.exists ? processedSnapshot.get('status') : null;
      if (priorStatus === 'charged_back_in_process') return { processed: false, duplicate: true };

      if (!processedSnapshot.exists) {
        transaction.create(processedRef, {
          paymentId, orderId, businessId: order.businessId, status: 'charged_back_in_process',
          reviewReason: 'chargeback_in_process_before_approval', ...providerEvidence,
          disputeRecordedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(creditRef, {
          paymentId, orderId, businessId: order.businessId, status: 'reversal_pending_review', previousMembership: null,
          reversalStatus: 'charged_back_in_process', reviewReason: 'chargeback_in_process_before_approval',
          reversalRecordedAt: FieldValue.serverTimestamp(),
        } satisfies MembershipPaymentCredit);
      } else {
        transaction.update(processedRef, {
          status: 'charged_back_in_process', ...providerEvidence,
          reviewReason: 'chargeback_in_process', disputeRecordedAt: FieldValue.serverTimestamp(),
        });
        if (creditSnapshot.exists) {
          // Preserve `active`: a terminal reversal may later need this exact
          // grant to restore the prior membership safely.
          transaction.update(creditRef, {
            disputeStatus: 'charged_back_in_process', disputeRecordedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      if (isSecondaryPayment) {
        // A second payment was never the entitlement source. Do not replace
        // the original paymentId while its dispute is being reconciled.
        transaction.update(orderRef, {
          status: 'payment_conflict_review', conflictingPaymentId: paymentId,
          reversalStatus: 'charged_back_in_process', reviewReason: 'chargeback_in_process_secondary_payment',
          conflictRecordedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(orderRef, {
          status: 'reversal_pending_review', paymentId,
          reversalStatus: 'charged_back_in_process', reviewReason: 'chargeback_in_process',
          reversalRecordedAt: FieldValue.serverTimestamp(),
        });
      }
      return { processed: true };
    }

    if (isChargebackReimbursed) {
      const priorStatus = processedSnapshot.exists ? processedSnapshot.get('status') : null;
      if (priorStatus === 'charged_back_reimbursed') return { processed: false, duplicate: true };

      // A seller-favorable result must never create a second grant. If the
      // approval ledger is missing, preserve the provider evidence for review
      // instead of assuming the historical entitlement state.
      if (!processedSnapshot.exists || !creditSnapshot.exists) {
        if (!processedSnapshot.exists) {
          transaction.create(processedRef, {
            paymentId, orderId, businessId: order.businessId, status: 'approval_pending_review',
            reviewReason: 'chargeback_reimbursed_without_credit_ledger', ...providerEvidence,
            recordedAt: FieldValue.serverTimestamp(),
          });
        }
        if (!creditSnapshot.exists) {
          transaction.create(creditRef, {
            paymentId, orderId, businessId: order.businessId, status: 'reversal_pending_review', previousMembership: null,
            reversalStatus: 'charged_back_reimbursed', reviewReason: 'chargeback_reimbursed_without_credit_ledger',
            reversalRecordedAt: FieldValue.serverTimestamp(),
          } satisfies MembershipPaymentCredit);
        }
        if (isSecondaryPayment) {
          transaction.update(orderRef, {
            status: 'payment_conflict_review', conflictingPaymentId: paymentId,
            reversalStatus: 'charged_back_reimbursed', reviewReason: 'chargeback_reimbursed_secondary_payment',
            conflictRecordedAt: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.update(orderRef, {
            status: 'reversal_pending_review', paymentId, reversalStatus: 'charged_back_reimbursed',
            reviewReason: 'chargeback_reimbursed_without_credit_ledger', reversalRecordedAt: FieldValue.serverTimestamp(),
          });
        }
        return { processed: true };
      }

      transaction.update(processedRef, {
        status: 'charged_back_reimbursed', ...providerEvidence,
        reviewReason: 'chargeback_reimbursed', disputeRecordedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(creditRef, {
        disputeStatus: 'charged_back_reimbursed', ...providerEvidence,
        disputeRecordedAt: FieldValue.serverTimestamp(),
      });
      // Restore the order ledger's normal state only when this was the order's
      // credited payment. The business membership is deliberately untouched.
      const existingCredit = creditSnapshot.data() as MembershipPaymentCredit;
      if (order.paymentId === paymentId && existingCredit.status === 'active') {
        transaction.update(orderRef, { status: 'approved', paymentId, chargebackResolvedAt: FieldValue.serverTimestamp() });
      } else if (order.paymentId === paymentId) {
        // An out-of-order seller-favorable event after a recorded reversal
        // cannot safely recreate a membership. Preserve the payment linkage
        // and route it to financial review instead of declaring it approved.
        transaction.update(orderRef, {
          status: 'reversal_pending_review', paymentId,
          reversalStatus: 'charged_back_reimbursed', reviewReason: 'chargeback_reimbursed_after_reversal',
          reversalRecordedAt: FieldValue.serverTimestamp(),
        });
      }
      return { processed: true };
    }

    if (ledgerStatus === 'approved') {
      // Reversal states are terminal. A delayed/older approved notification
      // must never reactivate a payment that Mercado Pago has reversed.
      if (processedSnapshot.exists || creditSnapshot.exists) {
        return { processed: false, duplicate: true };
      }
      if (order.kind !== 'membership') {
        throw new Error('La orden de pago no está disponible para acreditación.');
      }
      if (order.status !== 'pending' && order.status !== 'preference_failed') {
        // A second distinct payment for the same one-time preference must not
        // be retried as a 5xx. It receives no entitlement and remains visible
        // for financial reconciliation.
        if (order.status === 'approved' || order.status === 'payment_conflict_review' || order.status === 'reversed' || order.status === 'reversal_pending_review') {
          transaction.create(processedRef, {
            paymentId, orderId, businessId: order.businessId, status: 'approval_pending_review',
            reviewReason: 'second_approved_payment_for_order', recordedAt: FieldValue.serverTimestamp(), ...providerEvidence,
          });
          transaction.create(creditRef, {
            paymentId, orderId, businessId: order.businessId, status: 'approval_pending_review', previousMembership: null,
            reviewReason: 'second_approved_payment_for_order', createdAt: FieldValue.serverTimestamp(),
          } satisfies MembershipPaymentCredit);
          transaction.update(orderRef, { status: 'payment_conflict_review', conflictingPaymentId: paymentId, conflictRecordedAt: FieldValue.serverTimestamp() });
          return { processed: true };
        }
        return { processed: false, duplicate: true };
      }

      const businessRef = db.collection('businesses').doc(order.businessId);
      const businessSnapshot = await transaction.get(businessRef);
      const previousMembership = businessSnapshot.exists ? copyMembership(businessSnapshot.get('membership')) : null;
      if (!businessSnapshot.exists || businessSnapshot.get('status') !== 'active' || previousMembership?.type === 'lifetime') {
        // The business can change while the buyer is on Mercado Pago. Record
        // the charge for review without overwriting a blocked or lifetime grant.
        transaction.create(processedRef, {
          paymentId, orderId, businessId: order.businessId, status: 'approval_pending_review',
          reviewReason: 'business_ineligible_after_checkout', recordedAt: FieldValue.serverTimestamp(), ...providerEvidence,
        });
        transaction.create(creditRef, {
          paymentId, orderId, businessId: order.businessId, status: 'approval_pending_review',
          previousMembership, reviewReason: 'business_ineligible_after_checkout', createdAt: FieldValue.serverTimestamp(),
        } satisfies MembershipPaymentCredit);
        transaction.update(orderRef, isSecondaryPayment ? {
          status: 'payment_conflict_review', conflictingPaymentId: paymentId,
          reviewReason: 'secondary_payment_business_ineligible_after_checkout', conflictRecordedAt: FieldValue.serverTimestamp(),
        } : {
          status: 'payment_conflict_review', paymentId,
          reviewReason: 'business_ineligible_after_checkout', conflictRecordedAt: FieldValue.serverTimestamp(),
        });
        return { processed: true };
      }
      const currentExpiry = previousMembership?.expiresAt;
      const currentExpiryMillis = timestampMillis(currentExpiry);
      const now = new Date();
      const baseDate = currentExpiryMillis !== null && currentExpiryMillis > now.getTime() ? new Date(currentExpiryMillis) : now;
      const grantedMembership = {
        type: 'pro',
        startsAt: AdminTimestamp.fromDate(now),
        expiresAt: AdminTimestamp.fromDate(addMonths(baseDate, 1)),
        paymentId,
      };

      transaction.create(processedRef, {
        paymentId,
        orderId,
        businessId: order.businessId,
        amount: order.amount,
        currency: order.currency,
        collectorId: order.collectorId,
        status: 'approved',
        ...providerEvidence,
        processedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(creditRef, {
        paymentId,
        orderId,
        businessId: order.businessId,
        status: 'active',
        previousMembership,
        grantedMembership,
        createdAt: FieldValue.serverTimestamp(),
      } satisfies MembershipPaymentCredit);
      transaction.update(orderRef, isSecondaryPayment ? {
        status: 'payment_conflict_review', conflictingPaymentId: paymentId,
        reviewReason: 'secondary_payment_approval_with_existing_primary', conflictRecordedAt: FieldValue.serverTimestamp(),
      } : { status: 'approved', paymentId, approvedAt: FieldValue.serverTimestamp() });
      transaction.update(businessRef, { membership: grantedMembership });
      return { processed: true };
    }

    // Older ledger rows predate the explicit status field; they only existed
    // after a successful approval, so treat a missing status as approved for
    // the sole purpose of recording a later reversal safely.
    const processedStatus = processedSnapshot.get('status');
    const mayEscalatePartialRefund = processedStatus === 'partially_refunded' && isTerminalReversal;
    const mayRefreshPartialRefund = processedStatus === 'partially_refunded' && isPartialRefund;
    const mayResolveChargebackDispute = (processedStatus === 'charged_back_in_process' || processedStatus === 'charged_back_reimbursed') && isTerminalReversal;
    const wasUncreditedApproval = processedSnapshot.get('reviewReason') === 'second_approved_payment_for_order'
      || processedSnapshot.get('reviewReason') === 'business_ineligible_after_checkout'
      || processedSnapshot.get('reviewReason') === 'partial_refund_before_approval';
    const mayResolveUncreditedApproval = processedStatus === 'approval_pending_review'
      || (wasUncreditedApproval && mayEscalatePartialRefund)
      || (mayResolveChargebackDispute && creditSnapshot.exists
        && (creditSnapshot.get('status') === 'reversal_pending_review' || creditSnapshot.get('status') === 'approval_pending_review'));
    if (processedSnapshot.exists && processedStatus && processedStatus !== 'approved' && !mayEscalatePartialRefund && !mayRefreshPartialRefund && !mayResolveChargebackDispute && !mayResolveUncreditedApproval) {
      return { processed: false, duplicate: true };
    }

    const reversalStatus = isPartialRefund ? 'partial_refund_review' : 'reversed';
    const reviewReason = isPartialRefund ? 'partial_refund' : 'membership_changed_or_credit_missing';
    if (mayResolveUncreditedApproval) {
      // A second charge or a charge for an ineligible business was never
      // credited. Its reversal must close that payment's review without
      // changing a different payment's membership or order attribution.
      transaction.update(processedRef, { status: ledgerStatus, ...providerEvidence, reversalRecordedAt: FieldValue.serverTimestamp() });
      if (creditSnapshot.exists) {
        transaction.update(creditRef, {
          status: isPartialRefund ? 'partial_refund_review' : 'reversed_uncredited',
          reversalStatus: ledgerStatus,
          ...providerEvidence,
          reversalRecordedAt: FieldValue.serverTimestamp(),
        });
      }
      if (order.paymentId === paymentId && !isPartialRefund) {
        transaction.update(orderRef, { status: 'reversed', reversalStatus: ledgerStatus, reversedAt: FieldValue.serverTimestamp() });
      }
      return { processed: true };
    }
    if (!processedSnapshot.exists) {
      // A reversal can arrive before its approved notification. Persisting this
      // terminal state blocks a later stale approval from creating an entitlement.
      const isPartialWithoutCredit = isPartialRefund;
      transaction.create(processedRef, {
        paymentId, orderId, businessId: order.businessId, status: ledgerStatus,
        ...(isPartialWithoutCredit ? { reviewReason: 'partial_refund_before_approval' } : {}),
        ...providerEvidence,
        reversalRecordedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(creditRef, {
        paymentId, orderId, businessId: order.businessId,
        status: isPartialWithoutCredit ? 'partial_refund_review' : 'reversed_uncredited',
        previousMembership: null, reversalStatus: ledgerStatus,
        ...(isPartialWithoutCredit ? { reviewReason: 'partial_refund_before_approval' } : {}),
        reversalRecordedAt: FieldValue.serverTimestamp(),
      } satisfies MembershipPaymentCredit);
      if (isPartialWithoutCredit || (order.paymentId && order.paymentId !== paymentId)) {
        transaction.update(orderRef, {
          status: 'payment_conflict_review',
          ...(order.paymentId && order.paymentId !== paymentId ? { conflictingPaymentId: paymentId } : { paymentId }),
          reviewReason: isPartialWithoutCredit ? 'partial_refund_before_approval' : 'uncredited_secondary_payment_reversed',
          conflictRecordedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(orderRef, { status: 'reversed', paymentId, reversalStatus: ledgerStatus, reversedAt: FieldValue.serverTimestamp() });
      }
      return { processed: true };
    }

    if (!creditSnapshot.exists) {
      transaction.update(processedRef, { status: ledgerStatus, ...providerEvidence, reversalRecordedAt: FieldValue.serverTimestamp() });
      transaction.create(creditRef, {
        paymentId, orderId, businessId: order.businessId, status: 'reversal_pending_review',
        previousMembership: null, reversalStatus: ledgerStatus, reviewReason: 'credit_ledger_missing', reversalRecordedAt: FieldValue.serverTimestamp(),
      } satisfies MembershipPaymentCredit);
      if (isSecondaryPayment) {
        transaction.update(orderRef, {
          status: 'payment_conflict_review', conflictingPaymentId: paymentId,
          reversalStatus: ledgerStatus, reviewReason: 'credit_ledger_missing_secondary_payment',
          conflictRecordedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(orderRef, { status: 'reversal_pending_review', paymentId, reversalStatus: ledgerStatus, reviewReason: 'credit_ledger_missing', reversalRecordedAt: FieldValue.serverTimestamp() });
      }
      return { processed: true };
    }

    const credit = creditSnapshot.data() as MembershipPaymentCredit;
    const businessRef = db.collection('businesses').doc(order.businessId);
    const businessSnapshot = await transaction.get(businessRef);
    if (!businessSnapshot.exists) {
      transaction.update(processedRef, { status: ledgerStatus, ...providerEvidence, reversalRecordedAt: FieldValue.serverTimestamp() });
      transaction.update(creditRef, {
        status: 'reversal_pending_review', reversalStatus: ledgerStatus,
        reviewReason: 'business_missing_at_reversal', reversalRecordedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(orderRef, {
        status: 'reversal_pending_review', reversalStatus: ledgerStatus,
        reviewReason: 'business_missing_at_reversal', reversalRecordedAt: FieldValue.serverTimestamp(),
      });
      return { processed: true };
    }
    const membershipMatchesCredit = membershipStillMatchesCredit(businessSnapshot.get('membership'), credit.grantedMembership, paymentId);
    const resolvedMembership = !isPartialRefund
      && (credit.status === 'active' || credit.status === 'partial_refund_review')
      && membershipMatchesCredit
      ? await resolveRestorableMembership(transaction, db, credit)
      : { restorable: false };
    const canRestorePreviousMembership = resolvedMembership.restorable;

    transaction.update(processedRef, { status: ledgerStatus, ...providerEvidence, reversalRecordedAt: FieldValue.serverTimestamp() });
    if (canRestorePreviousMembership) {
      transaction.update(creditRef, { status: 'reversed', reversalStatus: ledgerStatus, reversedAt: FieldValue.serverTimestamp() });
      if (isSecondaryPayment) {
        transaction.update(orderRef, {
          status: 'payment_conflict_review', conflictingPaymentId: paymentId,
          reversalStatus: ledgerStatus, reviewReason: 'secondary_payment_reversed',
          conflictRecordedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(orderRef, { status: 'reversed', paymentId, reversalStatus: ledgerStatus, reversedAt: FieldValue.serverTimestamp() });
      }
      transaction.update(businessRef, { membership: resolvedMembership.membership ?? FieldValue.delete() });
    } else {
      transaction.update(creditRef, { status: reversalStatus, reversalStatus: ledgerStatus, reviewReason, ...providerEvidence, reversalRecordedAt: FieldValue.serverTimestamp() });
      if (isSecondaryPayment) {
        transaction.update(orderRef, {
          status: 'payment_conflict_review', conflictingPaymentId: paymentId,
          reversalStatus: ledgerStatus, reviewReason: 'secondary_payment_reversal_pending_review',
          conflictRecordedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(orderRef, { status: 'reversal_pending_review', paymentId, reversalStatus: ledgerStatus, reviewReason, reversalRecordedAt: FieldValue.serverTimestamp() });
      }
    }
    return { processed: true };
  });
}
