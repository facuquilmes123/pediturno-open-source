import { describe, expect, it } from 'vitest';
import { planWhatsAppReminder, type WhatsAppReminderSource } from '@/lib/whatsapp-reminder-policy';

function source(): WhatsAppReminderSource {
  const nowMs = Date.parse('2026-11-06T15:00:00Z');
  return {
    nowMs, business: { id: 'owner-a', status: 'active', remindersEnabled: true },
    appointment: { id: 'appointment-a', businessId: 'owner-a', clientId: 'client-a', status: 'Confirmado', startsAtMs: nowMs + 3600000, reminderDueAtMs: nowMs - 1 },
    client: { id: 'client-a', businessId: 'owner-a', phoneE164: '+5491100000000' },
    consent: { businessId: 'owner-a', clientId: 'client-a', phoneE164: '+5491100000000', category: 'appointment_reminder', textVersion: 'consent-v1', grantedAtMs: nowMs - 86400000 },
    sender: { businessId: 'owner-a', phoneNumberId: '123456', active: true },
    template: { businessId: 'owner-a', name: 'appointment_reminder', language: 'es_AR', category: 'UTILITY', status: 'APPROVED', revision: 'v1' },
  };
}

describe('V2 WhatsApp reminder admission', () => {
  it('rejects coercible non-string sender and template fields', () => {
    const sender = source(); sender.sender!.phoneNumberId = 123456 as unknown as string;
    expect(planWhatsAppReminder(sender)).toEqual({ eligible: false, reason: 'sender_unavailable' });
    const template = source(); template.template!.name = false as unknown as string;
    expect(planWhatsAppReminder(template)).toEqual({ eligible: false, reason: 'template_unavailable' });
  });
  it('plans a confirmed Services booking without requiring a payment or exposing phone/consent timestamps', () => {
    const input = source(); const before = structuredClone(input); const plan = planWhatsAppReminder(input);
    expect(plan.eligible).toBe(true); expect(input).toEqual(before);
    expect(JSON.stringify(plan)).not.toContain(input.client.phoneE164);
    expect(JSON.stringify(plan)).not.toContain(String(input.consent!.grantedAtMs));
  });
  it('keeps one occurrence key across retries, template updates, re-consent and sender reconnection', () => {
    const input = source(); const first = planWhatsAppReminder(input);
    input.nowMs += 1000; input.appointment.reminderDueAtMs -= 5000;
    input.template!.revision = 'v2'; input.consent!.textVersion = 'consent-v2'; input.sender!.phoneNumberId = '654321';
    expect(planWhatsAppReminder(input)).toMatchObject({ eligible: true, deliveryKey: first.eligible && first.deliveryKey });
  });
  it('invalidates an old occurrence after rescheduling and uses a new key when the new reminder is due', () => {
    const input = source(); const first = planWhatsAppReminder(input);
    input.appointment.startsAtMs += 86400000; input.appointment.reminderDueAtMs += 86400000;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'not_due' });
    input.nowMs += 86400000; const next = planWhatsAppReminder(input);
    expect(next.eligible).toBe(true);
    if (next.eligible && first.eligible) expect(next.deliveryKey).not.toBe(first.deliveryKey);
  });
  it.each(['appointment', 'client', 'consent', 'sender', 'template'] as const)('rejects records borrowed from another business: %s', subject => {
    const input = source(); input[subject]!.businessId = 'owner-b';
    expect(planWhatsAppReminder(input).eligible).toBe(false);
  });
  it('does not inherit consent from a saved phone, another client, changed number or another category', () => {
    for (const change of [null, { clientId: 'client-b' }, { phoneE164: '+5491199999999' }, { category: 'marketing' }]) {
      const input = source(); input.consent = change === null ? null : { ...input.consent!, ...change };
      expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'consent_required' });
    }
  });
  it('honors opt-out at dispatch time and requires a newer explicit consent to opt in again', () => {
    const input = source(); expect(planWhatsAppReminder(input).eligible).toBe(true);
    input.consent!.revokedAtMs = input.nowMs;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'consent_required' });
    input.nowMs += 1; input.consent!.grantedAtMs = input.nowMs;
    expect(planWhatsAppReminder(input).eligible).toBe(true);
  });
  it.each(['Cancelado', 'Pendiente', 'Completado'])('does not remind a booking that changed to %s after being queued', status => {
    const input = source(); input.appointment.status = status;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'appointment_ineligible' });
  });
  it.each(['pending', 'expired', 'reversal_review', 'unrecognized'])('does not remind an unpaid or disputed booking: %s', paymentStatus => {
    const input = source(); input.appointment.paymentStatus = paymentStatus;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'appointment_ineligible' });
  });
  it('stops queued work when the business disables reminders or disconnects its sender', () => {
    const input = source(); input.business.remindersEnabled = false;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'disabled' });
    input.business.remindersEnabled = true; input.sender!.active = false;
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'sender_unavailable' });
  });
  it('requires an approved Utility template even if a customer-service window could be open', () => {
    const input = source(); input.template!.category = 'MARKETING';
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'template_unavailable' });
    input.template!.category = 'UTILITY'; input.template!.status = 'PAUSED';
    expect(planWhatsAppReminder(input)).toEqual({ eligible: false, reason: 'template_unavailable' });
  });
  it('fails closed for invalid scheduling, future consent or an ambiguous phone', () => {
    const invalid: Array<(input: WhatsAppReminderSource) => void> = [
      input => { input.nowMs = Number.NaN; }, input => { input.appointment.startsAtMs = Number.POSITIVE_INFINITY; },
      input => { input.appointment.startsAtMs = input.nowMs; }, input => { input.appointment.reminderDueAtMs = input.appointment.startsAtMs; },
      input => { input.consent!.grantedAtMs = input.nowMs + 1; }, input => { input.client.phoneE164 = '011 0000 0000'; },
      input => { input.consent!.revokedAtMs = Number.NaN; },
    ];
    for (const mutate of invalid) { const input = source(); mutate(input); expect(planWhatsAppReminder(input).eligible).toBe(false); }
  });
});
