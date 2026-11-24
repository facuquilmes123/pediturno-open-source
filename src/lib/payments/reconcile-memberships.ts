import MercadoPagoConfig, { Payment } from 'mercadopago';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { processWebhookNotificationAdmin } from '@/services/mercadopago';

// A small page caps provider work in one cron run. Cursors let subsequent runs
// cover every record instead of permanently failing once the ledger grows.
// Ten ordinary orders provide timely coverage. A per-order cap keeps a single
// anomalous preference from consuming the complete cron window.
export const PAYMENT_RECONCILIATION_PAGE_SIZE = 10;
const PROVIDER_SEARCH_LIMIT = 10;
const PROVIDER_SEARCH_MAX_RESULTS_PER_ORDER = 20;
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const STATE_COLLECTION = 'paymentReconciliationState';
const STATE_ID = 'membership-v1';
const FAILURE_COLLECTION = 'paymentReconciliationFailures';

type ReconciliationStream = 'orders' | 'payments';
type FailureReason = 'provider_results_overflow' | 'firestore_document_too_large' | 'provider_http_error' | 'ledger_error' | 'unknown';
type PaymentSearchResult = { id?: string | number };
type CandidateSnapshot = { id: string; get: (field: string) => unknown };

type ReconciliationState = {
  nextStream?: ReconciliationStream;
  orderCursor?: string;
  paymentCursor?: string;
};

function platformAccessToken(): string {
  // This intentionally does not consult MP_PAYMENTS_ENABLED: disabling new
  // checkouts must never stop reconciliation of payments already created.
  const token = process.env.MP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('Payment reconciliation is not configured.');
  return token;
}

function validPaymentId(value: unknown): value is string {
  return typeof value === 'string' && PAYMENT_ID_PATTERN.test(value);
}

function isReconciliationStream(value: unknown): value is ReconciliationStream {
  return value === 'orders' || value === 'payments';
}

function nextStream(stream: ReconciliationStream): ReconciliationStream {
  return stream === 'orders' ? 'payments' : 'orders';
}

function failureReason(error: unknown, fallback: FailureReason): FailureReason {
  const text = error instanceof Error ? error.message.toLowerCase() : '';
  if (text.includes('document') && (text.includes('too large') || text.includes('1 mib') || text.includes('1048576'))) return 'firestore_document_too_large';
  if (text.includes('firestore') || text.includes('transaction') || text.includes('ledger')) return 'ledger_error';
  if (text.includes('http') || text.includes('mercado pago') || text.includes('mercadopago') || text.includes('api')) return 'provider_http_error';
  return fallback;
}

async function paymentIdsForOrder(
  payment: Pick<Payment, 'search'>,
  orderId: string,
): Promise<{ ids: string[]; overflow: boolean; invalidResults: boolean }> {
  const ids = new Set<string>();
  let invalidResults = false;
  let offset = 0;
  let knownTotal: number | null = null;
  while (offset < PROVIDER_SEARCH_MAX_RESULTS_PER_ORDER) {
    const result = await payment.search({
      options: {
        external_reference: orderId,
        limit: PROVIDER_SEARCH_LIMIT,
        offset,
        sort: 'date_last_updated',
        criteria: 'desc',
      },
    });
    const results = result.results ?? [];
    const total = Number(result.paging?.total);
    if (Number.isFinite(total) && total >= 0) knownTotal = total;
    for (const resultItem of results) {
      const id = String((resultItem as PaymentSearchResult).id ?? '');
      if (validPaymentId(id)) ids.add(id);
      else invalidResults = true;
    }
    offset += results.length;
    if (results.length < PROVIDER_SEARCH_LIMIT || (knownTotal !== null && offset >= knownTotal)) break;
  }
  return { ids: [...ids], overflow: knownTotal === null ? offset >= PROVIDER_SEARCH_MAX_RESULTS_PER_ORDER : knownTotal > PROVIDER_SEARCH_MAX_RESULTS_PER_ORDER, invalidResults };
}

async function getPage(
  collection: { orderBy: (fieldPath: FieldPath) => any },
  cursor: string | undefined,
): Promise<{ docs: CandidateSnapshot[]; resetCursor: boolean }> {
  let query = collection.orderBy(FieldPath.documentId()).limit(PAYMENT_RECONCILIATION_PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  let snapshot = await query.get();
  if (snapshot.docs.length === 0 && cursor) {
    snapshot = await collection.orderBy(FieldPath.documentId()).limit(PAYMENT_RECONCILIATION_PAGE_SIZE).get();
    return { docs: snapshot.docs as CandidateSnapshot[], resetCursor: true };
  }
  return { docs: snapshot.docs as CandidateSnapshot[], resetCursor: false };
}

export type MembershipPaymentReconciliationResult = {
  stream: ReconciliationStream;
  candidates: number;
  eligible: number;
  providerPaymentsFound: number;
  checkedPayments: number;
  processed: number;
  duplicates: number;
  ignored: number;
  failed: number;
  truncatedSearches: number;
  nextStream: ReconciliationStream;
};

/**
 * Replays authoritative provider reads through the same idempotent webhook
 * processor. It never creates refunds, captures, or cancellation requests.
 * A bad provider response is recorded per item and does not stop the page.
 */
export async function reconcileMembershipPayments(): Promise<MembershipPaymentReconciliationResult> {
  const db = getAdminFirestore();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_ID);
  const [stateSnapshot, openFailures] = await Promise.all([
    stateRef.get(),
    db.collection(FAILURE_COLLECTION).where('status', '==', 'open').limit(10).get(),
  ]);
  const state = (stateSnapshot.exists ? stateSnapshot.data() : {}) as ReconciliationState;
  const stream: ReconciliationStream = isReconciliationStream(state.nextStream) ? state.nextStream : 'orders';
  const cursor = stream === 'orders' ? state.orderCursor : state.paymentCursor;
  const collectionName = stream === 'orders' ? 'paymentOrders' : 'processedPayments';
  const page = await getPage(db.collection(collectionName), cursor);
  const payment = new Payment(new MercadoPagoConfig({ accessToken: platformAccessToken() }));
  const openFailureKeys = new Set(openFailures.docs.map((failure: { id: string }) => failure.id));
  const priorityFailure = openFailures.docs.find((failure: { get: (field: string) => unknown }) => failure.get('stream') === stream);
  let priorityCandidate: CandidateSnapshot | undefined;
  if (priorityFailure) {
    const subjectId = priorityFailure.get('subjectId');
    if (typeof subjectId === 'string' && subjectId) {
      if (stream === 'orders') {
        const order = await db.collection('paymentOrders').doc(subjectId).get();
        if (order.exists) priorityCandidate = order as CandidateSnapshot;
      } else if (validPaymentId(subjectId)) {
        // The prior failure was created only after this payment passed the
        // ledger status filter, so retry it before the cursor page.
        priorityCandidate = { id: subjectId, get: field => field === 'status' ? 'approved' : undefined };
      }
    }
  }
  const candidates = priorityCandidate && !page.docs.some(item => item.id === priorityCandidate!.id)
    ? [priorityCandidate, ...page.docs]
    : page.docs;

  const paymentIds = new Set<string>();
  let eligible = 0;
  let providerPaymentsFound = 0;
  let failed = 0;
  let truncatedSearches = 0;

  const recordFailure = async (
    subjectId: string,
    reason: FailureReason,
    failureStream: ReconciliationStream = stream,
  ) => {
    failed += 1;
    const failureId = `${failureStream}_${subjectId}`;
    await db.collection(FAILURE_COLLECTION).doc(failureId).set({
      stream: failureStream, subjectId, reason, status: 'open',
      attempts: FieldValue.increment(1), lastFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    openFailureKeys.add(failureId);
  };
  const resolveFailure = async (subjectId: string, failureStream: ReconciliationStream = stream) => {
    const failureId = `${failureStream}_${subjectId}`;
    // Healthy periodic checks must not create a write-heavy audit row. Only
    // close failures that were observed open at the start of this run.
    if (!openFailureKeys.has(failureId)) return;
    await db.collection(FAILURE_COLLECTION).doc(failureId).set({
      status: 'resolved', lastSucceededAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    openFailureKeys.delete(failureId);
  };

  for (const snapshot of candidates) {
    if (stream === 'orders') {
      // A preference can have a second/third payment even after the order was
      // approved, reversed, or sent to review. Search every server-created
      // preference; the webhook processor remains the entitlement authority.
      const preferenceId = snapshot.get('preferenceId');
      if (typeof preferenceId !== 'string' || !preferenceId) continue;
      eligible += 1;
      try {
        const found = await paymentIdsForOrder(payment, snapshot.id);
        providerPaymentsFound += found.ids.length;
        found.ids.forEach(id => paymentIds.add(id));
        if (found.overflow || found.invalidResults) {
          truncatedSearches += 1;
          await recordFailure(snapshot.id, found.overflow ? 'provider_results_overflow' : 'provider_http_error', 'orders');
        } else {
          await resolveFailure(snapshot.id);
        }
      } catch (error) {
        await recordFailure(snapshot.id, failureReason(error, 'provider_http_error'), 'orders');
      }
    } else {
      const status = snapshot.get('status');
      if (status !== 'approved' && status !== 'partially_refunded' && status !== 'approval_pending_review') continue;
      eligible += 1;
      if (validPaymentId(snapshot.id)) paymentIds.add(snapshot.id);
      else await recordFailure(snapshot.id, 'unknown');
    }
  }

  let processed = 0;
  let duplicates = 0;
  let ignored = 0;
  for (const paymentId of paymentIds) {
    try {
      const result = await processWebhookNotificationAdmin(paymentId);
      if (result.processed) processed += 1;
      else if (result.duplicate) duplicates += 1;
      else ignored += 1;
      await resolveFailure(paymentId, 'payments');
    } catch (error) {
      // Payment validation errors always retry as payments, even when their
      // ID was discovered while searching an order.
      await recordFailure(paymentId, failureReason(error, 'unknown'), 'payments');
    }
  }

  const lastId = page.docs.at(-1)?.id;
  const updatedState: Record<string, unknown> = {
    nextStream: nextStream(stream),
    lastRunAt: FieldValue.serverTimestamp(),
    lastRun: { stream, candidates: page.docs.length, eligible, processed, duplicates, ignored, failed, truncatedSearches },
  };
  if (stream === 'orders') updatedState.orderCursor = lastId ?? (page.resetCursor ? null : state.orderCursor ?? null);
  else updatedState.paymentCursor = lastId ?? (page.resetCursor ? null : state.paymentCursor ?? null);
  await stateRef.set(updatedState, { merge: true });

  return {
    stream,
    candidates: page.docs.length,
    eligible,
    providerPaymentsFound,
    checkedPayments: paymentIds.size,
    processed,
    duplicates,
    ignored,
    failed,
    truncatedSearches,
    nextStream: nextStream(stream),
  };
}
