import 'server-only';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { BUSINESS_TIME_ZONE, dateKeyInZone, localTimeToUtc } from '@/lib/booking-constraints';
import { getEffectiveMembership, isServicesBusiness } from '@/lib/membership-entitlement';

export const MONTHLY_FREE_QUOTA = 40;

export class AppointmentQuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';
  readonly status = 409;
  constructor(message = 'Alcanzaste el límite de 40 turnos de este mes en el plan Gratis. Pasate a Pro para turnos ilimitados.') {
    super(message);
    this.name = 'AppointmentQuotaExceededError';
  }
}

/** Returns the calendar month key 'YYYY-MM' for a given date in the business timezone. */
export function getMonthKey(dateOrDateKey: string | Date | Timestamp, timeZone = BUSINESS_TIME_ZONE): string {
  if (typeof dateOrDateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrDateKey)) {
    return dateOrDateKey.slice(0, 7);
  }
  const date = dateOrDateKey instanceof Timestamp ? dateOrDateKey.toDate()
    : dateOrDateKey instanceof Date ? dateOrDateKey
    : new Date(dateOrDateKey);
  const key = dateKeyInZone(date, timeZone);
  return key.slice(0, 7);
}

/** Check if business has active Pro or is subject to monthly Free quota */
export function isBusinessPro(business: Record<string, unknown>, now = Date.now()): boolean {
  if (!isServicesBusiness(business)) return true; // Non-services follow separate membership checks
  return getEffectiveMembership(business, now) !== null;
}

/**
 * Counts existing active (non-cancelled, non-rejected) appointments for a business in a given calendar month.
 */
export async function countActiveAppointmentsInMonth(
  db: Firestore,
  businessId: string,
  monthKey: string,
  timeZone = BUSINESS_TIME_ZONE,
  transaction?: Transaction
): Promise<number> {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const startTimestamp = Timestamp.fromDate(localTimeToUtc(`${monthKey}-01`, '00:00', timeZone));
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const endTimestamp = Timestamp.fromDate(localTimeToUtc(next, '00:00', timeZone));

  const query = db.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '>=', startTimestamp)
    .where('date', '<', endTimestamp);

  const snapshot = transaction ? await transaction.get(query) : await query.get();

  let activeCount = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const status = data.status;
    if (status !== 'Cancelado' && status !== 'Rechazado') {
      activeCount++;
    }
  }
  return activeCount;
}

/**
 * Reads the shared admission lock and derives usage from the authoritative appointment ledger.
 */
export async function getMonthUsage(
  transaction: Transaction,
  db: Firestore,
  businessId: string,
  monthKey: string,
  timeZone = BUSINESS_TIME_ZONE
): Promise<{ count: number; docRef: FirebaseFirestore.DocumentReference; exists: boolean }> {
  const usageDocRef = db.collection('businesses').doc(businessId).collection('monthlyUsage').doc(monthKey);
  const usageSnap = await transaction.get(usageDocRef);

  // The ledger is authoritative, including legacy counters, Pro periods and
  // automated cancellations. Reading the shared usage document serializes admission.
  const realCount = await countActiveAppointmentsInMonth(db, businessId, monthKey, timeZone, transaction);
  return { count: realCount, docRef: usageDocRef, exists: usageSnap.exists };
}

/**
 * Atomic quota verification & consumption within a Firestore transaction when creating a new appointment.
 */
export async function checkAndConsumeAppointmentQuota(
  transaction: Transaction,
  db: Firestore,
  businessId: string,
  business: Record<string, unknown>,
  scheduledDateKey: string,
  timeZone = BUSINESS_TIME_ZONE,
  now = Date.now()
): Promise<{ plan: 'free' | 'pro'; monthKey: string; usage: number; quota: number | null }> {
  const isPro = isBusinessPro(business, now);
  const monthKey = getMonthKey(scheduledDateKey, timeZone);
  if (isPro) {
    return { plan: 'pro', monthKey, usage: 0, quota: null };
  }

  const { count, docRef: usageDocRef, exists } = await getMonthUsage(transaction, db, businessId, monthKey, timeZone);

  if (count >= MONTHLY_FREE_QUOTA) {
    throw new AppointmentQuotaExceededError();
  }

  const nextCount = count + 1;
  const usage = { count: nextCount, monthKey, businessId, updatedAt: FieldValue.serverTimestamp() };
  // Missing admission documents require a create precondition; two first writers
  // must not both overwrite a count derived from the same empty-document snapshot.
  if (exists) transaction.set(usageDocRef, usage, { merge: true });
  else transaction.create(usageDocRef, usage);

  return { plan: 'free', monthKey, usage: nextCount, quota: MONTHLY_FREE_QUOTA };
}

/**
 * Releases appointment quota when an appointment is cancelled.
 */
export async function releaseAppointmentQuota(
  transaction: Transaction,
  db: Firestore,
  businessId: string,
  scheduledDateKey: string,
  timeZone = BUSINESS_TIME_ZONE
): Promise<void> {
  const monthKey = getMonthKey(scheduledDateKey, timeZone);
  const usageDocRef = db.collection('businesses').doc(businessId).collection('monthlyUsage').doc(monthKey);
  const usageSnap = await transaction.get(usageDocRef);

  if (usageSnap.exists) {
    const current = Number(usageSnap.get('count') ?? 1);
    const nextCount = Math.max(0, current - 1);
    transaction.set(usageDocRef, {
      count: nextCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

/**
 * Adjusts appointment quota when rescheduling an appointment.
 * If moving within the same month, 0 delta.
 * If moving to another month, verifies destination month quota (if Free), decrements source month, increments destination.
 */
export async function adjustAppointmentQuotaForReschedule(
  transaction: Transaction,
  db: Firestore,
  businessId: string,
  business: Record<string, unknown>,
  oldDateKey: string,
  newDateKey: string,
  timeZone = BUSINESS_TIME_ZONE,
  now = Date.now()
): Promise<void> {
  const oldMonth = getMonthKey(oldDateKey, timeZone);
  const newMonth = getMonthKey(newDateKey, timeZone);

  if (oldMonth === newMonth) {
    return;
  }

  const isPro = isBusinessPro(business, now);
  const oldRef = db.collection('businesses').doc(businessId).collection('monthlyUsage').doc(oldMonth);
  const newRef = db.collection('businesses').doc(businessId).collection('monthlyUsage').doc(newMonth);

  const oldSnap = await transaction.get(oldRef);
  if (!isPro) {
    const { count: newCount, exists: destinationExists } = await getMonthUsage(transaction, db, businessId, newMonth, timeZone);
    if (newCount >= MONTHLY_FREE_QUOTA) {
      throw new AppointmentQuotaExceededError('El mes destino alcanzó el límite de 40 turnos del plan Gratis. Pasate a Pro para turnos ilimitados.');
    }
    const usage = { count: newCount + 1, monthKey: newMonth, businessId, updatedAt: FieldValue.serverTimestamp() };
    if (destinationExists) transaction.set(newRef, usage, { merge: true });
    else transaction.create(newRef, usage);
  }

  if (oldSnap.exists) {
    const oldCount = Number(oldSnap.get('count') ?? 1);
    transaction.set(oldRef, { count: Math.max(0, oldCount - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}
