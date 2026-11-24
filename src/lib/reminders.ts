import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { BUSINESS_TIME_ZONE, dateKeyInZone, isTime, localTimeToUtc } from '@/lib/booking-constraints';
import { sendReminderEmail } from '@/services/email';
import { sendPushNotification } from '@/services/push';
import { isBusinessOperational } from '@/lib/server-membership';

const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 5;

export function upcomingPushOccurrence(appointment: Record<string, any>, business: Record<string, any>, now: number): number | null {
  if (appointment.status !== 'Confirmado' || !(appointment.date instanceof Timestamp) || !isTime(appointment.time) || !isBusinessOperational(business)) return null;
  try {
    const zone = business.timeZone || BUSINESS_TIME_ZONE;
    const scheduled = localTimeToUtc(dateKeyInZone(appointment.date.toDate(), zone), appointment.time, zone).getTime();
    return scheduled > now && scheduled - now <= 30 * 60000 ? scheduled : null;
  } catch { return null; }
}

async function deliverUpcomingPush(db: Firestore, appointmentId: string, businessId: string, scheduled: number, now: number): Promise<boolean> {
  const identity = createHash('sha256').update(`${appointmentId}:${scheduled}`).digest('hex');
  const ref = db.collection('upcomingPushDeliveries').doc(identity);
  const claim = await db.runTransaction(async tx => {
    const [prior, appointment, business] = await Promise.all([tx.get(ref), tx.get(db.collection('appointments').doc(appointmentId)), tx.get(db.collection('businesses').doc(businessId))]);
    const state = prior.data();
    if (upcomingPushOccurrence(appointment.data() || {}, business.data() || {}, now) !== scheduled || state?.status === 'sent' || Number(state?.attempts || 0) >= MAX_ATTEMPTS ||
        state?.leaseUntil instanceof Timestamp && state.leaseUntil.toMillis() > now || state?.nextAttemptAt instanceof Timestamp && state.nextAttemptAt.toMillis() > now) return false;
    tx.set(ref, { businessId, appointmentId, scheduledAt: Timestamp.fromMillis(scheduled), status: 'sending', attempts: Number(state?.attempts || 0) + 1, leaseUntil: Timestamp.fromMillis(now + 4 * 60000) }, { merge: true });
    return true;
  });
  if (!claim) return false;
  const result = await sendPushNotification(businessId, {
    title: 'Una reserva está por empezar', body: 'Tenés una reserva en los próximos 30 minutos. Abrí tu calendario para ver los detalles.',
    icon: '/android-icon-192x192.png', url: '/dashboard/calendario', tag: `upcoming-${identity}`,
  });
  await ref.update({ status: result.delivered > 0 ? 'sent' : 'failed', leaseUntil: FieldValue.delete(), nextAttemptAt: Timestamp.fromMillis(now + 5 * 60000), updatedAt: Timestamp.now() });
  return result.delivered > 0;
}

/** A reminder belongs to a scheduled occurrence, not the lifetime of a booking. */
export function reminderOccurrence(appointment: Record<string, any>, business: Record<string, any>, now: number): number | null {
  const date = appointment.date instanceof Timestamp ? appointment.date.toDate() : null;
  if (appointment.status !== 'Confirmado' || !date || !isTime(appointment.time) || !appointment.clientEmail ||
      business.status !== 'active' || !business.bookingSettings?.remindersEnabled) return null;
  try {
    const zone = business.timeZone || BUSINESS_TIME_ZONE;
    const scheduled = localTimeToUtc(dateKeyInZone(date, zone), appointment.time, zone).getTime();
    const ahead = (scheduled - now) / 3600000;
    return ahead >= 23 && ahead <= 25 ? scheduled : null;
  } catch { return null; }
}

export async function runReminderBatch(db: Firestore, now = Date.now(), budgetMs = 40000) {
  const result = { processed: 0, sent: 0, pushesSent: 0, skipped: 0, failed: 0, busy: false };
  const jobRef = db.collection('maintenanceJobs').doc('reminders');
  const runId = randomUUID();
  const job = await db.runTransaction(async tx => {
    const prior = (await tx.get(jobRef)).data();
    if (prior?.leaseUntil instanceof Timestamp && prior.leaseUntil.toMillis() > now) return null;
    tx.set(jobRef, { runId, leaseUntil: Timestamp.fromMillis(now + 4 * 60000) }, { merge: true });
    return prior || {};
  });
  if (!job) return { ...result, busy: true };
  const deadline = Date.now() + budgetMs;
  let cursorDate = job.cursorDate instanceof Timestamp ? job.cursorDate : null;
  let cursorId = typeof job.cursorId === 'string' ? job.cursorId : null;
  try {
    // Scan bounded pages and resume next run; volume must never disable the whole job.
    const lower = Timestamp.fromMillis(now - 86400000);
    const upper = Timestamp.fromMillis(now + 3 * 86400000);
    for (let page = 0; page < 5 && Date.now() < deadline; page++) {
      let query = db.collection('appointments').where('status', '==', 'Confirmado')
        .where('date', '>=', lower).where('date', '<', upper)
        .orderBy('date').orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursorDate && cursorId) query = query.startAfter(cursorDate, cursorId);
      const appointments = await query.get();
      for (const snapshot of appointments.docs) {
        if (Date.now() >= deadline) break;
        const appointment = snapshot.data();
        cursorDate = appointment.date;
        cursorId = snapshot.id;
        result.processed++;
        try {
          const businessRef = typeof appointment.businessId === 'string' ? db.collection('businesses').doc(appointment.businessId) : null;
          if (!businessRef) { result.skipped++; continue; }
          const business = (await businessRef.get()).data();
          const upcoming = business ? upcomingPushOccurrence(appointment, business, now) : null;
          if (upcoming !== null && await deliverUpcomingPush(db, snapshot.id, appointment.businessId, upcoming, now)) result.pushesSent++;
          const occurrence = business ? reminderOccurrence(appointment, business, now) : null;
          if (!business || occurrence === null) { result.skipped++; continue; }
          const identity = createHash('sha256').update(`${snapshot.id}:${occurrence}`).digest('hex');
          const deliveryRef = db.collection('reminderDeliveries').doc(identity);
          const claim = await db.runTransaction(async tx => {
            const [current, currentBusiness, prior] = await Promise.all([tx.get(snapshot.ref), tx.get(businessRef), tx.get(deliveryRef)]);
            const state = prior.data();
            const fresh = current.data();
            const owner = currentBusiness.data();
            if (!fresh || !owner || reminderOccurrence(fresh, owner, now) !== occurrence || state?.status === 'sent' ||
                Number(state?.attempts || 0) >= MAX_ATTEMPTS ||
                (state?.nextAttemptAt instanceof Timestamp && state.nextAttemptAt.toMillis() > now) ||
                (state?.leaseUntil instanceof Timestamp && state.leaseUntil.toMillis() > now)) return null;
            const attempts = Number(state?.attempts || 0) + 1;
            tx.set(deliveryRef, { appointmentId: snapshot.id, businessId: appointment.businessId,
              scheduledAt: Timestamp.fromMillis(occurrence), status: 'sending', attempts,
              leaseUntil: Timestamp.fromMillis(now + 4 * 60000), updatedAt: Timestamp.now() });
            return { appointment: fresh, business: owner, attempts };
          });
          if (!claim) { result.skipped++; continue; }
          try {
            const accepted = await sendReminderEmail({
              appointment: { ...claim.appointment, id: snapshot.id, date: claim.appointment.date.toDate().toISOString() },
              business: { ...claim.business, id: appointment.businessId },
            } as Parameters<typeof sendReminderEmail>[0]);
            if (!accepted.success) throw new Error('Delivery not accepted');
            await deliveryRef.update({ status: 'sent', sentAt: Timestamp.now(), leaseUntil: FieldValue.delete() });
            result.sent++;
          } catch {
            await deliveryRef.update({ status: 'failed', leaseUntil: FieldValue.delete(),
              nextAttemptAt: Timestamp.fromMillis(now + Math.min(60, 5 * 2 ** (claim.attempts - 1)) * 60000) });
            result.failed++;
          }
        } catch { result.failed++; }
      }
      if (appointments.size < PAGE_SIZE && (appointments.empty || cursorId === appointments.docs.at(-1)?.id)) {
        cursorDate = null; cursorId = null; break;
      }
    }
    return result;
  } finally {
    await db.runTransaction(async tx => {
      if ((await tx.get(jobRef)).get('runId') !== runId) return;
      tx.set(jobRef, { cursorDate, cursorId, leaseUntil: FieldValue.delete(), updatedAt: Timestamp.now(), ...result }, { merge: true });
    });
  }
}
