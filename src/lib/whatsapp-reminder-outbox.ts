import 'server-only';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { planWhatsAppReminder, type WhatsAppReminderSource, type WhatsAppReminderPlan } from './whatsapp-reminder-policy';

type References = { businessId: string; appointmentId: string; clientId: string };
type EligiblePlan = Extract<WhatsAppReminderPlan, { eligible: true }>;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** V2 preparation: trusted server input only; no route, scheduler or sender. */
export async function enqueueWhatsAppReminder(db: Firestore, source: WhatsAppReminderSource) {
  const plan = planWhatsAppReminder(source);
  if (!plan.eligible) return { status: 'rejected' as const, reason: plan.reason };
  return retryCreationConflict(db, transaction => enqueuePlanned(db, transaction, source, plan));
}

/** All mutable records must be read by this loader in the same transaction. */
export async function enqueueCurrentWhatsAppReminder(db: Firestore, references: References, nowMs: number,
  loadSource: (transaction: Transaction, references: References) => Promise<WhatsAppReminderSource | null>) {
  if (![references.businessId, references.appointmentId, references.clientId].every(validId) ||
      !Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('Invalid WhatsApp source reference');
  return retryCreationConflict(db, async transaction => {
    const source = await loadSource(transaction, references);
    if (!source) return { status: 'rejected' as const, reason: 'source_missing' as const };
    if (source.business.id !== references.businessId || source.appointment.id !== references.appointmentId ||
        source.client.id !== references.clientId) return { status: 'rejected' as const, reason: 'tenant_mismatch' as const };
    const current = { ...source, nowMs };
    const plan = planWhatsAppReminder(current);
    if (!plan.eligible) return { status: 'rejected' as const, reason: plan.reason };
    return enqueuePlanned(db, transaction, current, plan);
  });
}

async function retryCreationConflict<T>(db: Firestore, action: (transaction: Transaction) => Promise<T>): Promise<T> {
  // An absent-document create can surface gRPC ALREADY_EXISTS rather than
  // ABORTED. Retry the WHOLE transaction so source/consent are re-read; never
  // turn an arbitrary failure into success or overwrite the winning job.
  for (let attempt = 0; ; attempt++) {
    try { return await db.runTransaction(action); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code !== 6 || attempt >= 2) throw error;
    }
  }
}

async function enqueuePlanned(db: Firestore, transaction: Transaction, source: WhatsAppReminderSource, plan: EligiblePlan) {
    const ref = db.collection('whatsappReminderOutbox').doc(plan.deliveryKey);
    const previous = await transaction.get(ref);
    if (previous.exists) {
      if (previous.get('businessId') !== plan.source.businessId || previous.get('appointmentId') !== plan.source.appointmentId || previous.get('clientId') !== plan.source.clientId) {
        throw new Error('WhatsApp reminder source conflict');
      }
      // Never reset an existing job, including delivered, cancelled, failed or
      // uncertain deliveries. A provider result must be reconciled separately.
      return { status: 'duplicate' as const, deliveryKey: plan.deliveryKey };
    }
    transaction.create(ref, {
      kind: 'whatsapp-appointment-reminder', schemaVersion: 1,
      ...plan.source, status: 'pending', attempts: 0,
      createdAt: Timestamp.fromMillis(source.nowMs),
      dueAt: Timestamp.fromMillis(source.appointment.reminderDueAtMs),
    });
    // No phone, message body, action link, credential or capability is stored.
    // The internal worker reloads current sources and checks the occurrence
    // before claiming. Provider dispatch is intentionally not connected.
    return { status: 'enqueued' as const, deliveryKey: plan.deliveryKey };
}
