import 'server-only';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { createSmtpUsageController, summarizeSmtpUsage, type SmtpUsageState, type SmtpUsageStore } from '@/lib/smtp-usage';
import { FieldValue } from 'firebase-admin/firestore';

// Avoid competing pessimistic locks from this worker. Cross-worker safety still
// comes from Firestore transactions and the persisted alert lease.
let transactionQueue: Promise<unknown> = Promise.resolve();

export function getSmtpUsageController() {
  const db = getAdminFirestore();
  const ref = db.collection('maintenanceJobs').doc('smtp-notificaciones-usage-v1');
  const store: SmtpUsageStore = {
    appendAccepted: async event => {
      const current = await ref.get();
      // Never silently replace a corrupt non-array field with arrayUnion.
      summarizeSmtpUsage((current.data() ?? {}) as SmtpUsageState, Date.now());
      await ref.set({ events: FieldValue.arrayUnion(event) }, { merge: true });
    },
    transaction: fn => {
    const task = transactionQueue.then(() => db.runTransaction(async tx => {
    const row = await tx.get(ref);
    const previous = (row.data() ?? {}) as SmtpUsageState;
    const outcome = fn(previous);
    // Read-only decisions (busy, deduplicated, idle) need no repeated write.
    if (!row.exists || JSON.stringify(previous) !== JSON.stringify(outcome.state)) tx.set(ref, outcome.state);
    return outcome.result;
  }, { maxAttempts: 3 }));
    transactionQueue = task.then(() => undefined, () => undefined);
    return task;
  } };
  return createSmtpUsageController(store);
}
