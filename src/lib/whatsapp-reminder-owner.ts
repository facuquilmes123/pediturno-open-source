import 'server-only';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

// Internal owner service: authenticated UID must come from a verified token,
// never a request body's owner/business field. No route or client API is added.
function validate(ownerUid: string, deliveryKey: string) {
  if (typeof ownerUid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ||
      typeof deliveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(deliveryKey)) throw new Error('Invalid WhatsApp owner reference');
}
const states = ['pending', 'retry', 'claimed', 'uncertain', 'sent', 'delivered', 'read', 'failed', 'cancelled'];
const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : null;

export async function readWhatsAppReminderForOwner(db: Firestore, authenticatedUid: string, deliveryKey: string) {
  validate(authenticatedUid, deliveryKey);
  const job = (await db.collection('whatsappReminderOutbox').doc(deliveryKey).get()).data();
  if (!job || job.businessId !== authenticatedUid || job.kind !== 'whatsapp-appointment-reminder' || job.schemaVersion !== 1) return null;
  if (!states.includes(job.status) || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.attempts > 3 ||
      ![job.appointmentId, job.clientId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v))) throw new Error('Invalid WhatsApp job');
  return { deliveryKey, appointmentId: job.appointmentId, clientId: job.clientId, status: job.status as string,
    attempts: job.attempts as number, createdAtMs: millis(job.createdAt), dueAtMs: millis(job.dueAt),
    canCancel: ['pending', 'retry'].includes(job.status) };
}

/** A claimed/uncertain message may already be submitted: never claim it was stopped. */
export async function cancelWhatsAppReminderForOwner(db: Firestore, authenticatedUid: string, deliveryKey: string, nowMs: number) {
  validate(authenticatedUid, deliveryKey);
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('Invalid WhatsApp cancellation clock');
  return db.runTransaction(async transaction => {
    const ref = db.collection('whatsappReminderOutbox').doc(deliveryKey);
    const job = (await transaction.get(ref)).data();
    if (!job || job.businessId !== authenticatedUid) return { status: 'not_found' as const };
    if (job.kind !== 'whatsapp-appointment-reminder' || job.schemaVersion !== 1 || !states.includes(job.status) ||
        !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.attempts > 3 ||
        !(job.createdAt instanceof Timestamp) || nowMs < job.createdAt.toMillis()) throw new Error('Invalid WhatsApp job');
    if (job.status === 'cancelled') return { status: 'already_cancelled' as const };
    if (!['pending', 'retry'].includes(job.status)) return { status: 'not_cancellable' as const };
    const now = Timestamp.fromMillis(nowMs);
    transaction.update(ref, { status: 'cancelled', cancelledAt: now, updatedAt: now, lastResult: 'owner_cancelled' });
    return { status: 'cancelled' as const };
  });
}
