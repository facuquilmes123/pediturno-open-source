import 'server-only';
import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { planWhatsAppReminder, type WhatsAppReminderSource } from './whatsapp-reminder-policy';

// Internal V2 lifecycle only. No provider adapter, route, cron or network call.
// The eventual sender must recheck cancellation/consent immediately before HTTP.
type References = { businessId: string; appointmentId: string; clientId: string };
type Options = { businessId: string; deliveryKey: string; nowMs: number };
type LoadSource = (transaction: Transaction, references: References) => Promise<WhatsAppReminderSource | null>;
export type WhatsAppAttemptOutcome =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'not_submitted'; retryable: boolean }
  | { kind: 'uncertain' };

const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const instant = (value: number) => Number.isSafeInteger(value) && value > 0;
const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : NaN;
function validate(options: Options) {
  if (!id(options.businessId) || !/^[a-f0-9]{64}$/.test(options.deliveryKey) || !instant(options.nowMs)) throw new Error('Invalid WhatsApp job reference');
}

export async function claimWhatsAppReminder(db: Firestore, options: Options & { leaseMs?: number }, loadSource: LoadSource) {
  validate(options);
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 30_000 || leaseMs > 300_000) throw new Error('Invalid WhatsApp lease');
  const token = randomUUID();
  const ref = db.collection('whatsappReminderOutbox').doc(options.deliveryKey);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: 'missing' as const };
    const job = snapshot.data()!;
    if (job.businessId !== options.businessId) return { status: 'foreign' as const };
    if (job.kind !== 'whatsapp-appointment-reminder' || job.schemaVersion !== 1 || !id(job.appointmentId) || !id(job.clientId) ||
        !instant(job.startsAtMs) || !Number.isSafeInteger(job.attempts) || job.attempts < 0) throw new Error('Invalid WhatsApp job');
    const now = Timestamp.fromMillis(options.nowMs);
    if (job.status === 'claimed') {
      if (millis(job.leaseExpiresAt) > options.nowMs) return { status: 'busy' as const };
      // An expired lease may already have reached the provider. Never resend it.
      transaction.update(ref, { status: 'uncertain', lastResult: 'lease_expired', updatedAt: now });
      return { status: 'uncertain' as const };
    }
    if (!['pending', 'retry'].includes(job.status)) return { status: 'ignored' as const };
    if (!Number.isFinite(millis(job.dueAt))) throw new Error('Invalid WhatsApp due date');
    if (millis(job.dueAt) > options.nowMs || millis(job.nextAttemptAt) > options.nowMs) return { status: 'deferred' as const };
    if (job.attempts >= 3) {
      transaction.update(ref, { status: 'failed', lastResult: 'attempt_limit', updatedAt: now });
      return { status: 'failed' as const };
    }
    // Loader must use this transaction for every mutable source record. Never
    // use a queued phone/body or trust a snapshot taken outside the transaction.
    const source = await loadSource(transaction, { businessId: options.businessId, appointmentId: job.appointmentId, clientId: job.clientId });
    if (source && (source.business.id !== job.businessId || source.appointment.id !== job.appointmentId ||
        source.client.id !== job.clientId || source.appointment.startsAtMs !== job.startsAtMs)) {
      transaction.update(ref, { status: 'cancelled', lastResult: 'source_changed', updatedAt: now });
      return { status: 'cancelled' as const };
    }
    const plan = source ? planWhatsAppReminder({ ...source, nowMs: options.nowMs }) : null;
    if (plan && !plan.eligible && plan.reason === 'not_due') {
      transaction.update(ref, { dueAt: Timestamp.fromMillis(source!.appointment.reminderDueAtMs), updatedAt: now });
      return { status: 'deferred' as const };
    }
    if (!plan || !plan.eligible || plan.deliveryKey !== options.deliveryKey || plan.source.businessId !== job.businessId ||
        plan.source.appointmentId !== job.appointmentId || plan.source.clientId !== job.clientId || plan.source.startsAtMs !== job.startsAtMs) {
      transaction.update(ref, { status: 'cancelled', lastResult: !plan ? 'source_missing' : !plan.eligible ? plan.reason : 'source_changed', updatedAt: now });
      return { status: 'cancelled' as const };
    }
    const attempt = job.attempts + 1;
    transaction.update(ref, { ...plan.source, status: 'claimed', attempts: attempt, leaseToken: token,
      claimedAt: now, leaseExpiresAt: Timestamp.fromMillis(options.nowMs + leaseMs), updatedAt: now });
    // References only: no phone, rendered message, link or provider credentials.
    return { status: 'claimed' as const, deliveryKey: options.deliveryKey, leaseToken: token, attempt, references: plan.source };
  });
}

export async function finishWhatsAppReminderAttempt(db: Firestore, options: Options & { leaseToken: string }, outcome: WhatsAppAttemptOutcome) {
  validate(options);
  if (!/^[a-f0-9-]{36}$/.test(options.leaseToken) ||
      !['accepted', 'not_submitted', 'uncertain'].includes(outcome.kind) ||
      outcome.kind === 'accepted' && (typeof outcome.messageId !== 'string' || !/^[A-Za-z0-9._:=/+\-]{1,256}$/.test(outcome.messageId)) ||
      outcome.kind === 'not_submitted' && typeof outcome.retryable !== 'boolean') throw new Error('Invalid WhatsApp attempt result');
  const ref = db.collection('whatsappReminderOutbox').doc(options.deliveryKey);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const job = snapshot.data();
    if (!job || job.kind !== 'whatsapp-appointment-reminder' || job.schemaVersion !== 1 ||
        !Number.isSafeInteger(job.attempts) || job.attempts < 1 || job.attempts > 3 ||
        job.businessId !== options.businessId || job.leaseToken !== options.leaseToken ||
        !Number.isFinite(millis(job.claimedAt)) || options.nowMs < millis(job.claimedAt) ||
        outcome.kind === 'accepted' && job.providerMessageId && job.providerMessageId !== outcome.messageId ||
        !['claimed', 'uncertain'].includes(job.status)) return { status: 'stale' as const };
    const now = Timestamp.fromMillis(options.nowMs);
    if (job.status === 'uncertain' || !(millis(job.leaseExpiresAt) > options.nowMs) || outcome.kind === 'uncertain') {
      // Preserve a late acceptance ID for reconciliation, without authorizing
      // another attempt or inferring recipient delivery/read from acceptance.
      transaction.update(ref, { status: 'uncertain', lastResult: job.status === 'uncertain' ? job.lastResult : 'outcome_uncertain', updatedAt: now,
        ...(outcome.kind === 'accepted' ? { providerMessageId: outcome.messageId } : {}) });
      return { status: 'uncertain' as const };
    }
    if (outcome.kind === 'accepted') {
      transaction.update(ref, { status: 'sent', providerMessageId: outcome.messageId, acceptedAt: now, updatedAt: now, lastResult: 'provider_accepted' });
      return { status: 'sent' as const };
    }
    // Only a trusted adapter proving that no request was submitted may request
    // a retry. A timeout, connection loss or ambiguous provider response may not.
    const nextMs = options.nowMs + 60_000 * 2 ** (job.attempts - 1);
    if (outcome.retryable && job.attempts < 3 && nextMs < job.startsAtMs) {
      transaction.update(ref, { status: 'retry', nextAttemptAt: Timestamp.fromMillis(nextMs), updatedAt: now, lastResult: 'not_submitted' });
      return { status: 'retry' as const };
    }
    transaction.update(ref, { status: 'failed', updatedAt: now, lastResult: 'not_submitted' });
    return { status: 'failed' as const };
  });
}
