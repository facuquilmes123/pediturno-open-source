import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { decryptCapabilityToken, encryptCapabilityToken, hashBookingCapability, isBookingCapabilityUsable, type EncryptedCapabilityToken } from '@/lib/booking-capability';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { sendConfirmationEmail, sendNewAppointmentNotificationEmail, type EmailData } from '@/services/email';

export const MAX_CONFIRMATION_ATTEMPTS = 5;
// This is at-least-once delivery: a provider can accept SMTP immediately before
// a process crash. The durable outbox prevents duplicate records, not a false
// exactly-once guarantee from an external mail provider.

export type BookingConfirmationOutbox = {
  type: 'booking-confirmation';
  appointmentId: string;
  businessId: string;
  encryptedToken: EncryptedCapabilityToken;
  capabilityExpiresAt: Date;
  status: 'pending';
  attempts: number;
  createdAt: Date;
  availableAt: Date;
  notifyBusiness?: boolean;
  isReschedule?: boolean;
};

export function createBookingConfirmationOutbox({
  appointmentId, businessId, token, capabilityExpiresAt, now = new Date(), notifyBusiness = false, isReschedule = false,
}: {
  appointmentId: string;
  businessId: string;
  token: string;
  capabilityExpiresAt: Date;
  now?: Date;
  notifyBusiness?: boolean;
  isReschedule?: boolean;
}): BookingConfirmationOutbox {
  if (!isDocumentId(appointmentId) || !isDocumentId(businessId)) throw new Error('Invalid booking outbox subject');
  if (!(capabilityExpiresAt instanceof Date) || !Number.isFinite(capabilityExpiresAt.getTime()) || capabilityExpiresAt <= now) throw new Error('Invalid booking capability expiry');
  return {
    type: 'booking-confirmation', appointmentId, businessId,
    encryptedToken: encryptCapabilityToken(token),
    capabilityExpiresAt, status: 'pending', attempts: 0, createdAt: now, availableAt: now, notifyBusiness, isReschedule,
  };
}

export async function deliverBookingOutbox(outboxId: string, now = new Date()): Promise<'sent' | 'skipped' | 'retry'> {
  if (!isDocumentId(outboxId)) throw new Error('Invalid outbox id');
  const db = getAdminFirestore();
  const outboxRef = db.collection('bookingEmailOutbox').doc(outboxId);
  const leaseUntil = new Date(now.getTime() + 5 * 60 * 1000);
  const claimed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(outboxRef);
    const record = snapshot.data();
    if (record && ['pending', 'processing'].includes(record.status) &&
        (!asDate(record.capabilityExpiresAt) || asDate(record.capabilityExpiresAt)! <= now || Number(record.attempts || 0) >= MAX_CONFIRMATION_ATTEMPTS) &&
        (!asDate(record.leaseUntil) || asDate(record.leaseUntil)! <= now)) {
      transaction.update(outboxRef, { status: 'failed', encryptedToken: FieldValue.delete(), leaseUntil: FieldValue.delete() });
      return null;
    }
    if (!record || !isDeliverableOutbox(record, now)) return null;
    transaction.update(outboxRef, {
      status: 'processing', attempts: Number(record.attempts || 0) + 1,
      leaseUntil: Timestamp.fromDate(leaseUntil), availableAt: Timestamp.fromDate(leaseUntil), lastAttemptAt: FieldValue.serverTimestamp(),
    });
    return record;
  });
  if (!claimed) return 'skipped';

  try {
    const token = decryptCapabilityToken(claimed.encryptedToken as EncryptedCapabilityToken);
    const [appointmentSnap, businessSnap, capabilitySnap] = await Promise.all([
      db.collection('appointments').doc(claimed.appointmentId).get(),
      db.collection('businesses').doc(claimed.businessId).get(),
      db.collection('bookingCapabilities').doc(hashBookingCapability(token)).get(),
    ]);
    const appointment = appointmentSnap.data();
    const business = businessSnap.data();
    if (!appointment || !business || appointment.businessId !== claimed.businessId) throw new Error('Outbox source unavailable');
    if (!isConfirmationSource(appointment, business)) throw new Error('Outbox source unavailable');
    if (business.status !== 'active' || !['Confirmado', 'Pendiente'].includes(appointment.status) || !isBookingCapabilityUsable(capabilitySnap.data() || {}, now)) {
      await outboxRef.update({ status: 'cancelled', encryptedToken: FieldValue.delete(), leaseUntil: FieldValue.delete() });
      return 'skipped';
    }
    const data = {
      appointment: { ...appointment, id: appointmentSnap.id, date: appointment.date?.toDate?.() || appointment.date },
      business,
      capabilityUrl: `https://pediturno.com/cancel/${token}`,
      isReschedule: claimed.isReschedule === true,
    } as EmailData;
    let incomplete = false;
    if (!claimed.clientSentAt) {
      try {
        const result = await sendConfirmationEmail(data);
        if (!result.success) throw new Error('Confirmation email was not accepted');
        await outboxRef.update({ clientSentAt: FieldValue.serverTimestamp() });
      } catch { incomplete = true; }
    }
    if (claimed.notifyBusiness === true && !claimed.businessSentAt && business.bookingSettings?.newAppointmentNotificationsEnabled && business.bookingSettings?.notificationEmail) {
      try {
        const result = await sendNewAppointmentNotificationEmail(data);
        if (!result.success) throw new Error('Business notification was not accepted');
        await outboxRef.update({ businessSentAt: FieldValue.serverTimestamp() });
      } catch { incomplete = true; }
    }
    if (claimed.notifyBusiness === true && !claimed.pushAttemptedAt) {
      // Retry transient push failures without repeating already accepted email.
      const { sendNewBookingPushNotification } = await import('@/services/push');
      const result = await sendNewBookingPushNotification(claimed.businessId);
      if (result.unavailable || result.attempted > 0 && result.delivered === 0) incomplete = true;
      else await outboxRef.update({ pushAttemptedAt: FieldValue.serverTimestamp() });
    }
    if (claimed.notifyBusiness === true && !claimed.androidPushAttemptedAt) {
      // Android tokens live beneath the owning business and only receive a generic
      // event. The owner fetches appointment data again through authenticated APIs.
      const { sendAndroidNewBookingPushNotification } = await import('@/lib/android-push');
      const result = await sendAndroidNewBookingPushNotification(claimed.businessId);
      if (result.unavailable || result.attempted > 0 && result.delivered === 0) incomplete = true;
      else await outboxRef.update({ androidPushAttemptedAt: FieldValue.serverTimestamp() });
    }
    if (incomplete) throw new Error('Notification incomplete');
    await outboxRef.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete(), encryptedToken: FieldValue.delete() });
    return 'sent';
  } catch {
    const attempts = Number(claimed.attempts || 0) + 1;
    await outboxRef.update({ status: attempts >= MAX_CONFIRMATION_ATTEMPTS ? 'failed' : 'pending',
      ...(attempts >= MAX_CONFIRMATION_ATTEMPTS ? { encryptedToken: FieldValue.delete() } : {}),
      availableAt: Timestamp.fromDate(new Date(now.getTime() + Math.min(60, 5 * 2 ** (attempts - 1)) * 60 * 1000)), leaseUntil: FieldValue.delete() });
    return 'retry';
  }
}

export function isDeliverableOutbox(value: Record<string, unknown>, now = new Date()): boolean {
  const expiry = asDate(value.capabilityExpiresAt);
  const availableAt = asDate(value.availableAt);
  const leaseUntil = asDate(value.leaseUntil);
  const isPending = value.status === 'pending';
  const abandonedLease = value.status === 'processing' && leaseUntil !== null && leaseUntil <= now;
  return value.type === 'booking-confirmation' && (isPending || abandonedLease) &&
    Number(value.attempts || 0) < MAX_CONFIRMATION_ATTEMPTS &&
    typeof value.appointmentId === 'string' && isDocumentId(value.appointmentId) &&
    typeof value.businessId === 'string' && isDocumentId(value.businessId) &&
    expiry !== null && expiry > now && availableAt !== null && availableAt <= now &&
    (leaseUntil === null || leaseUntil <= now) && isEncryptedToken(value.encryptedToken);
}

function isDocumentId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}
function isEncryptedToken(value: unknown): value is EncryptedCapabilityToken {
  return !!value && typeof value === 'object' &&
    typeof (value as EncryptedCapabilityToken).ciphertext === 'string' &&
    typeof (value as EncryptedCapabilityToken).iv === 'string' &&
    typeof (value as EncryptedCapabilityToken).tag === 'string';
}
function isConfirmationSource(appointment: Record<string, unknown>, business: Record<string, unknown>): boolean {
  return typeof appointment.businessId === 'string' && typeof appointment.client === 'string' &&
    typeof appointment.time === 'string' && typeof appointment.clientEmail === 'string' &&
    typeof business.name === 'string' && typeof business.slug === 'string';
}
