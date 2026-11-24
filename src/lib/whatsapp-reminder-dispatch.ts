import 'server-only';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { planWhatsAppReminder, type WhatsAppReminderSource } from './whatsapp-reminder-policy';

type Options = { businessId: string; deliveryKey: string; leaseToken: string; nowMs: number };
type References = { businessId: string; appointmentId: string; clientId: string };
const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : NaN;

/**
 * Last transactional check before a future provider adapter. Does NOT send.
 * Ready data is private, ephemeral server input: never log/return it to a UI or
 * store it in the queue. Adapter must submit immediately, not cache this result.
 * A change after this gate can still race a provider request; no unsend promise.
 */
export async function prepareWhatsAppReminderDispatch(db: Firestore, options: Options,
  loadSource: (transaction: Transaction, references: References) => Promise<WhatsAppReminderSource | null>) {
  if (typeof options.businessId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(options.businessId) ||
      typeof options.deliveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(options.deliveryKey) ||
      typeof options.leaseToken !== 'string' || !/^[a-f0-9-]{36}$/.test(options.leaseToken) ||
      !Number.isSafeInteger(options.nowMs) || options.nowMs <= 0) throw new Error('Invalid WhatsApp dispatch reference');
  return db.runTransaction(async transaction => {
    const ref = db.collection('whatsappReminderOutbox').doc(options.deliveryKey);
    const job = (await transaction.get(ref)).data();
    if (!job || job.businessId !== options.businessId || job.kind !== 'whatsapp-appointment-reminder' || job.schemaVersion !== 1 ||
        job.status !== 'claimed' || job.leaseToken !== options.leaseToken || !Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > 3 ||
        !Number.isFinite(millis(job.claimedAt)) || options.nowMs < millis(job.claimedAt)) return { status: 'stale' as const };
    const now = Timestamp.fromMillis(options.nowMs);
    if (!(millis(job.leaseExpiresAt) > options.nowMs)) {
      transaction.update(ref, { status: 'uncertain', lastResult: 'lease_expired', updatedAt: now });
      return { status: 'uncertain' as const };
    }
    if (job.dispatchAttempt === job.attempts) return { status: 'already_prepared' as const };
    if (job.dispatchAttempt !== undefined && (!Number.isInteger(job.dispatchAttempt) || job.dispatchAttempt < 1 || job.dispatchAttempt > job.attempts)) throw new Error('Invalid WhatsApp dispatch state');
    const source = await loadSource(transaction, { businessId: options.businessId, appointmentId: job.appointmentId, clientId: job.clientId });
    const plan = source ? planWhatsAppReminder({ ...source, nowMs: options.nowMs }) : null;
    if (!plan || !plan.eligible || plan.deliveryKey !== options.deliveryKey ||
        !Object.entries(plan.source).every(([key, value]) => job[key] === value)) {
      transaction.update(ref, { status: 'cancelled', lastResult: !plan ? 'source_missing' : !plan.eligible ? plan.reason : 'source_changed', updatedAt: now });
      return { status: 'cancelled' as const };
    }
    transaction.update(ref, { dispatchAttempt: job.attempts, dispatchPreparedAt: now, updatedAt: now });
    return { status: 'ready' as const, deliveryKey: options.deliveryKey,
      // No credentials, message body or action link. Actual template parameters
      // and provider call remain deliberately unimplemented.
      dispatch: { businessId: plan.source.businessId, appointmentId: plan.source.appointmentId,
        startsAtMs: plan.source.startsAtMs, phoneE164: source!.client.phoneE164,
        senderId: plan.source.senderId, templateName: source!.template!.name, templateLanguage: source!.template!.language } };
  });
}
