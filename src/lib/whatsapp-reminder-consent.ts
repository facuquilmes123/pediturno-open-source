import 'server-only';
import { createHash } from 'node:crypto';
import { type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { WhatsAppReminderSource } from './whatsapp-reminder-policy';

type Target = { businessId: string; clientId: string; phoneE164: string };
type Decision = Target & { actionId: string; nowMs: number; origin: 'client_preferences' | 'public_booking' | 'recorded_explicit_consent' } & (
  { decision: 'grant'; explicitOptIn: true; textVersion: string } | { decision: 'revoke' }
);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const key = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** Trusted explicit actions only; no route/UI grants consent in V1. Private contact data stays server-only. */
export async function recordWhatsAppReminderConsent(db: Firestore, input: Decision,
  loadTarget: (transaction: Transaction, target: Pick<Target, 'businessId' | 'clientId'>) => Promise<Target | null>) {
  if (!id(input.businessId) || !id(input.clientId) || !id(input.actionId) || !/^\+[1-9]\d{7,14}$/.test(input.phoneE164) ||
      !Number.isSafeInteger(input.nowMs) || input.nowMs <= 0 ||
      !['client_preferences', 'public_booking', 'recorded_explicit_consent'].includes(input.origin) ||
      !['grant', 'revoke'].includes(input.decision) ||
      input.decision === 'grant' && (input.explicitOptIn !== true || typeof input.textVersion !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(input.textVersion))) throw new Error('Invalid WhatsApp consent action');
  const ref = db.collection('whatsappReminderConsents').doc(key(input.businessId, input.clientId));
  const event = db.collection('whatsappReminderConsentEvents').doc(key(input.businessId, input.clientId, input.actionId));
  return db.runTransaction(async transaction => {
    const [previous, recorded] = await transaction.getAll(ref, event);
    if (recorded.exists) {
      if (recorded.get('decision') !== input.decision || recorded.get('phoneE164') !== input.phoneE164 ||
          recorded.get('textVersion') !== (input.decision === 'grant' ? input.textVersion : null) || recorded.get('origin') !== input.origin) {
        throw new Error('WhatsApp consent action conflict');
      }
      return { status: 'duplicate' as const };
    }
    const target = await loadTarget(transaction, { businessId: input.businessId, clientId: input.clientId });
    const prior = previous.data();
    if (!target || target.businessId !== input.businessId || target.clientId !== input.clientId ||
        target.phoneE164 !== input.phoneE164 && !(input.decision === 'revoke' && prior?.phoneE164 === input.phoneE164)) {
      return { status: 'rejected' as const };
    }
    if (prior && (prior.businessId !== input.businessId || prior.clientId !== input.clientId)) throw new Error('WhatsApp consent source conflict');
    const stale = prior && prior.updatedAtMs > input.nowMs;
    transaction.create(event, { businessId: input.businessId, clientId: input.clientId, phoneE164: input.phoneE164,
      category: 'appointment_reminder', decision: input.decision, origin: input.origin,
      textVersion: input.decision === 'grant' ? input.textVersion : null, recordedAtMs: input.nowMs, applied: !stale });
    if (stale) return { status: 'stale' as const };
    transaction.set(ref, { businessId: input.businessId, clientId: input.clientId, phoneE164: input.phoneE164,
      category: 'appointment_reminder', textVersion: input.decision === 'grant' ? input.textVersion : prior?.textVersion ?? null,
      grantedAtMs: input.decision === 'grant' ? input.nowMs : prior?.grantedAtMs ?? null,
      revokedAtMs: input.decision === 'revoke' ? input.nowMs : prior?.revokedAtMs ?? null, updatedAtMs: input.nowMs });
    // Equal-time revoke wins in the policy regardless of transaction ordering.
    return { status: 'recorded' as const };
  });
}

export async function loadWhatsAppReminderConsent(db: Firestore, transaction: Transaction, businessId: string, clientId: string): Promise<WhatsAppReminderSource['consent']> {
  if (!id(businessId) || !id(clientId)) throw new Error('Invalid WhatsApp consent reference');
  const record = (await transaction.get(db.collection('whatsappReminderConsents').doc(key(businessId, clientId)))).data();
  if (!record || record.businessId !== businessId || record.clientId !== clientId ||
      !Number.isSafeInteger(record.grantedAtMs) || record.grantedAtMs <= 0) return null;
  return { businessId, clientId, phoneE164: record.phoneE164, category: record.category,
    textVersion: record.textVersion, grantedAtMs: record.grantedAtMs, revokedAtMs: record.revokedAtMs };
}
