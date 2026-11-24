import 'server-only';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { BUSINESS_TIME_ZONE, dateKeyInZone, isTime, localTimeToUtc } from './booking-constraints';
import { isServicesBusiness } from './membership-entitlement';
import { isBusinessOperational } from './server-membership';
import { loadWhatsAppReminderConsent } from './whatsapp-reminder-consent';
import type { WhatsAppReminderSource } from './whatsapp-reminder-policy';

export type WhatsAppReminderReferences = { businessId: string; appointmentId: string; clientId: string };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Private pilot configuration only. No config is created or enabled here.
 * Callers authenticate before owner operations; workers supply trusted refs.
 * Never derive consent from the contact record or use the booking's cached phone.
 */
export function createWhatsAppReminderSourceLoader(db: Firestore, nowMs: number) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error('Invalid WhatsApp source clock');
  return async (transaction: Transaction, refs: WhatsAppReminderReferences): Promise<WhatsAppReminderSource | null> => {
    if (![refs.businessId, refs.appointmentId, refs.clientId].every(id)) throw new Error('Invalid WhatsApp source reference');
    const [businessDoc, appointmentDoc, clientDoc, settingsDoc] = await transaction.getAll(
      db.collection('businesses').doc(refs.businessId), db.collection('appointments').doc(refs.appointmentId),
      db.collection('clients').doc(refs.clientId), db.collection('whatsappReminderSettings').doc(refs.businessId));
    const business = businessDoc.data(), appointment = appointmentDoc.data(), client = clientDoc.data(), settings = settingsDoc.data();
    if (!business || !appointment || !client || !isServicesBusiness(business) ||
        appointment.businessId !== refs.businessId || appointment.clientId !== refs.clientId || client.businessId !== refs.businessId ||
        !settings || settings.schemaVersion !== 1 || settings.businessId !== refs.businessId || typeof settings.enabled !== 'boolean' ||
        !Number.isInteger(settings.leadMinutes) || settings.leadMinutes < 1 || settings.leadMinutes > 10080 ||
        !(appointment.date instanceof Timestamp) || !isTime(appointment.time) ||
        typeof client.phone !== 'string' || !/^\+?[0-9\s().-]{6,40}$/.test(client.phone) ||
        appointment.paymentReviewRequired !== undefined && typeof appointment.paymentReviewRequired !== 'boolean' ||
        appointment.paymentStatus != null && typeof appointment.paymentStatus !== 'string') return null;
    let startsAtMs: number;
    try {
      const zone = business.timeZone ?? BUSINESS_TIME_ZONE;
      if (typeof zone !== 'string') return null;
      startsAtMs = localTimeToUtc(dateKeyInZone(appointment.date.toDate(), zone), appointment.time, zone).getTime();
    } catch { return null; }
    const consent = await loadWhatsAppReminderConsent(db, transaction, refs.businessId, refs.clientId);
    const digits = client.phone.replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    // Existing client records may keep digits only. Accept that representation
    // only when it exactly matches a separately recorded explicit E.164 consent.
    // Never guess a country code or reuse the booking's cached contact.
    const phoneE164 = client.phone.startsWith('+') ? `+${digits}`
      : consent && typeof consent.phoneE164 === 'string' && consent.phoneE164 === `+${digits}` ? consent.phoneE164 : null;
    if (!phoneE164) return null;
    const sender = record(settings.sender) ? settings.sender : null;
    const template = record(settings.template) ? settings.template : null;
    return {
      nowMs, business: { id: refs.businessId, status: business.status, remindersEnabled: settings.enabled && isBusinessOperational(business, nowMs) },
      appointment: { id: refs.appointmentId, businessId: appointment.businessId, clientId: appointment.clientId,
        status: appointment.status, startsAtMs, reminderDueAtMs: startsAtMs - settings.leadMinutes * 60000,
        paymentStatus: appointment.paymentReviewRequired === true ? 'reversal_review' : appointment.paymentStatus },
      client: { id: refs.clientId, businessId: client.businessId, phoneE164 }, consent,
      sender: sender && typeof sender.businessId === 'string' && typeof sender.phoneNumberId === 'string' && typeof sender.active === 'boolean'
        ? { businessId: sender.businessId, phoneNumberId: sender.phoneNumberId, active: sender.active } : null,
      template: template && ['businessId', 'name', 'language', 'category', 'status', 'revision'].every(k => typeof template[k] === 'string')
        ? { businessId: template.businessId as string, name: template.name as string, language: template.language as string,
          category: template.category as string, status: template.status as string, revision: template.revision as string } : null,
    };
  };
}
