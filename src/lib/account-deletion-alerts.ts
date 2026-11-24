import 'server-only';
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { sendAccountDeletionOperationalAlert } from '@/services/email';

const COUNTERS = ['overdue', 'quarantined', 'unknownDeadline', 'runnerStale', 'workerFailed'] as const;
export type DeletionIncidentCounts = Partial<Record<typeof COUNTERS[number], number>>;

/** One successful summary/day; durable retry and lease limit duplicate concurrent sends. */
export async function deliverAccountDeletionAlerts(input: DeletionIncidentCounts) {
  const clean = Object.fromEntries(COUNTERS.map(name => [name, Number.isSafeInteger(input[name]) && input[name]! >= 0 ? input[name]! : 0]));
  const hasIncident = Object.values(clean).some(value => value > 0);
  const recipient = process.env.ACCOUNT_DELETION_ALERT_TO?.trim();
  if (!recipient || recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) return { sent: 0, skipped: 0, failed: hasIncident ? 1 : 0, pending: hasIncident ? 1 : 0 };
  const now = Date.now(); const claimId = randomUUID();
  const ref = getAdminFirestore().collection('maintenanceJobs').doc('account-deletion-ops-alert');
  try {
    const claim = await getAdminFirestore().runTransaction(async tx => {
      const row = await tx.get(ref);
      const lastSent = row.get('lastSentAt');
      if (row.get('status') === 'sent' && lastSent instanceof Timestamp && now - lastSent.toMillis() < 86400000) return { send: false, pending: false };
      const retrying = row.get('status') === 'retry' || row.get('status') === 'sending';
      if (!hasIncident && !retrying) return { send: false, pending: false };
      const lease = row.get('leaseUntil'); const next = row.get('nextAttemptAt');
      if (lease instanceof Timestamp && lease.toMillis() > now || next instanceof Timestamp && next.toMillis() > now) return { send: false, pending: true };
      const counts = hasIncident ? clean : Object.fromEntries(COUNTERS.map(name => [name, Number.isSafeInteger(row.get('counts')?.[name]) && row.get('counts')[name] >= 0 ? row.get('counts')[name] : 0]));
      tx.set(ref, { status: 'sending', claimId, leaseUntil: Timestamp.fromMillis(now + 5 * 60000), counts, lastAttemptAt: FieldValue.serverTimestamp() }, { merge: true });
      return { send: true, pending: true, counts };
    });
    if (!claim.send) return { sent: 0, skipped: 1, failed: 0, pending: Number(claim.pending) };
    const delivered = await sendAccountDeletionOperationalAlert(claim.counts!);
    await getAdminFirestore().runTransaction(async tx => {
      const row = await tx.get(ref);
      if (row.get('claimId') !== claimId) throw new Error('Alert claim changed');
      tx.set(ref, {
        status: delivered ? 'sent' : 'retry', leaseUntil: Timestamp.fromMillis(0), lastDeliverySucceeded: delivered,
        nextAttemptAt: Timestamp.fromMillis(delivered ? 0 : now + 15 * 60000),
        ...(delivered ? { lastSentAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
    });
    return { sent: Number(delivered), skipped: 0, failed: Number(!delivered), pending: Number(!delivered) };
  } catch { return { sent: 0, skipped: 0, failed: 1, pending: 1 }; }
}
