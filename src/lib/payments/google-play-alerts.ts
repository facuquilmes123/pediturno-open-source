import 'server-only';
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';

export type PlayOperationalIncident = {
  kind: 'reconciliation_failed' | 'reconciliation_unavailable' | 'rtdn_unmapped';
  checked?: number; processed?: number; failed?: number; pending?: number;
};

/** One bounded operator alert per incident kind/hour; no customer or purchase data. */
export async function reportGooglePlayOperationalIncident(incident: PlayOperationalIncident): Promise<void> {
  const recipient = process.env.GOOGLE_PLAY_OPS_ALERT_EMAIL?.trim();
  if (!recipient || recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) return;
  if (process.env.FIREBASE_PROJECT_ID?.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) return;
  if (!['reconciliation_failed', 'reconciliation_unavailable', 'rtdn_unmapped'].includes(incident.kind)) return;
  const claimId = randomUUID();
  try {
    const db = getAdminFirestore();
    const ref = db.collection('googlePlayOperationalAlerts').doc(incident.kind);
    const claimed = await db.runTransaction(async tx => {
      const record = await tx.get(ref);
      const sent = record.get('lastSentAt')?.toMillis?.() ?? 0;
      const lease = record.get('leaseUntil')?.toMillis?.() ?? 0;
      const now = Date.now();
      if (lease > now || sent > now - 60 * 60_000) return false;
      tx.set(ref, { claimId, leaseUntil: Timestamp.fromMillis(now + 60_000), lastAttemptAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) return;
    let delivered = false;
    try {
      const { sendGooglePlayOperationalAlert } = await import('@/services/email');
      const counts: Record<string, number> = {};
      for (const key of ['checked', 'processed', 'failed', 'pending'] as const) {
        const value = incident[key];
        if (Number.isSafeInteger(value) && value! >= 0) counts[key] = value!;
      }
      delivered = await sendGooglePlayOperationalAlert({ kind: incident.kind, counts });
    } catch { /* Retry next reconciliation; never expose provider diagnostics. */ }
    await db.runTransaction(async tx => {
      const record = await tx.get(ref);
      if (record.get('claimId') !== claimId) return;
      tx.set(ref, {
        leaseUntil: Timestamp.fromMillis(0),
        lastDeliverySucceeded: delivered,
        ...(delivered ? { lastSentAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
    });
  } catch { console.warn('Google Play operator alert could not be recorded.'); }
}
