import 'server-only';
import { createHash } from 'node:crypto';

// V2 preparation only: no provider, persistence, route or scheduled worker.
// Call this with current server-side records before enqueueing AND dispatching.
export type WhatsAppReminderSource = {
  nowMs: number;
  business: { id: string; status: string; remindersEnabled: boolean };
  appointment: { id: string; businessId: string; clientId: string; status: string; startsAtMs: number; reminderDueAtMs: number; paymentStatus?: string | null };
  client: { id: string; businessId: string; phoneE164: string };
  consent: { businessId: string; clientId: string; phoneE164: string; category: string; textVersion: string; grantedAtMs: number; revokedAtMs?: number | null } | null;
  sender: { businessId: string; phoneNumberId: string; active: boolean } | null;
  template: { businessId: string; name: string; language: string; category: string; status: string; revision: string } | null;
};
type Rejection = 'disabled' | 'invalid_source' | 'tenant_mismatch' | 'appointment_ineligible' | 'not_due' | 'consent_required' | 'sender_unavailable' | 'template_unavailable';
export type WhatsAppReminderPlan = { eligible: false; reason: Rejection } | {
  eligible: true;
  deliveryKey: string;
  source: { businessId: string; appointmentId: string; clientId: string; startsAtMs: number; consentVersion: string; senderId: string; templateRevision: string; templateName: string; templateLanguage: string };
};
const documentId = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const instant = (value: number) => Number.isSafeInteger(value) && value > 0;
const phone = (value: string) => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const label = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);

export function planWhatsAppReminder(input: WhatsAppReminderSource): WhatsAppReminderPlan {
  const { business, appointment, client, consent, sender, template, nowMs } = input;
  if (business.remindersEnabled !== true || business.status !== 'active') return { eligible: false, reason: 'disabled' };
  if (!documentId(business.id) || !documentId(appointment.id) || !documentId(client.id) || !phone(client.phoneE164) ||
      !instant(nowMs) || !instant(appointment.startsAtMs) || !instant(appointment.reminderDueAtMs) || appointment.reminderDueAtMs >= appointment.startsAtMs) return { eligible: false, reason: 'invalid_source' };
  if (appointment.businessId !== business.id || client.businessId !== business.id || appointment.clientId !== client.id) return { eligible: false, reason: 'tenant_mismatch' };
  if (appointment.status !== 'Confirmado' || appointment.startsAtMs <= nowMs || appointment.paymentStatus != null && appointment.paymentStatus !== 'paid') return { eligible: false, reason: 'appointment_ineligible' };
  if (appointment.reminderDueAtMs > nowMs) return { eligible: false, reason: 'not_due' };
  if (!consent || consent.businessId !== business.id || consent.clientId !== client.id || consent.phoneE164 !== client.phoneE164 ||
      consent.category !== 'appointment_reminder' || !label(consent.textVersion) || !instant(consent.grantedAtMs) || consent.grantedAtMs > nowMs ||
      consent.revokedAtMs != null && (!instant(consent.revokedAtMs) || consent.revokedAtMs > nowMs || consent.revokedAtMs >= consent.grantedAtMs)) return { eligible: false, reason: 'consent_required' };
  if (!sender || sender.businessId !== business.id || sender.active !== true || typeof sender.phoneNumberId !== 'string' || !/^\d{1,32}$/.test(sender.phoneNumberId)) return { eligible: false, reason: 'sender_unavailable' };
  if (!template || template.businessId !== business.id || template.status !== 'APPROVED' || template.category !== 'UTILITY' ||
      typeof template.name !== 'string' || !/^[a-z0-9_]{1,128}$/.test(template.name) ||
      typeof template.language !== 'string' || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language) || !label(template.revision)) return { eligible: false, reason: 'template_unavailable' };
  // A wording/template/sender update cannot turn the same occurrence into a
  // second reminder. Atomic outbox insertion/claim and provider reconciliation
  // remain integration requirements; this key alone does not prove delivery.
  const deliveryKey = createHash('sha256').update(JSON.stringify(['whatsapp-reminder-v1', business.id, appointment.id, appointment.startsAtMs])).digest('hex');
  return { eligible: true, deliveryKey, source: { businessId: business.id, appointmentId: appointment.id, clientId: client.id, startsAtMs: appointment.startsAtMs, consentVersion: consent.textVersion, senderId: sender.phoneNumberId, templateRevision: template.revision, templateName: template.name, templateLanguage: template.language } };
}
