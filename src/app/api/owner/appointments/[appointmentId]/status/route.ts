import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { isBusinessOperational } from '@/lib/server-membership';
import { canTransitionAppointmentStatus, isAppointmentLifecycleStatus } from '@/lib/appointment-state';
import { releaseAppointmentQuota } from '@/lib/appointment-quota';
import { BUSINESS_TIME_ZONE, dateKeyInZone } from '@/lib/booking-constraints';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function response(error: string, status: number) { return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }); }

async function authenticatedUid(request: NextRequest): Promise<string | null> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  initializeAdminApp();
  return (await getAuth().verifyIdToken(token, true)).uid;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params;
  if (!idPattern.test(appointmentId)) return response('Invalid request', 400);
  let input: { status?: unknown };
  try { input = await request.json(); } catch { return response('Invalid request', 400); }
  if (!isAppointmentLifecycleStatus(input.status)) return response('Invalid request', 400);
  let uid: string | null;
  try { uid = await authenticatedUid(request); } catch { return response('Authentication required', 401); }
  if (!uid) return response('Authentication required', 401);
  try {
    const db = getAdminFirestore();
    const appointmentRef = db.collection('appointments').doc(appointmentId);
    const businessRef = db.collection('businesses').doc(uid);
    const result = await db.runTransaction(async transaction => {
      const [appointmentSnap, businessSnap] = await Promise.all([
        transaction.get(appointmentRef),
        transaction.get(businessRef),
      ]);
      const appointment = appointmentSnap.data();
      if (!appointment || appointment.businessId !== uid) throw new Error('NOT_FOUND');
      const business = businessSnap.data();
      if (!isBusinessOperational(business)) throw new Error('MEMBERSHIP_REQUIRED');
       if (!canTransitionAppointmentStatus(appointment.status, input.status)) throw new Error('INVALID_TRANSITION');
      if (appointment.paymentStatus === 'pending' && input.status !== 'Cancelado' && input.status !== 'Pendiente') throw new Error('INVALID_TRANSITION');
      if (appointment.status === input.status) return { repeated: true };
      if (input.status === 'Cancelado') {
        const zone = typeof business?.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE;
        const apptDate = appointment.date instanceof Timestamp ? appointment.date.toDate() : (appointment.date ? new Date(appointment.date) : null);
        if (apptDate) {
          const apptDateKey = dateKeyInZone(apptDate, zone);
          await releaseAppointmentQuota(transaction, db, uid, apptDateKey, zone);
        }
      }
      markOwnerAgendaChanged(transaction, db, appointment.businessId); transaction.update(appointmentRef, { status: input.status, lastModified: FieldValue.serverTimestamp(), ...(input.status === 'Cancelado' && appointment.paymentStatus === 'paid' ? { paymentReviewRequired: true } : {}) });
      if (input.status === 'Cancelado') {
        const slots = Array.isArray(appointment.bookingSlotIds) ? appointment.bookingSlotIds : [];
        for (const slotId of slots) if (typeof slotId === 'string' && /^[a-f0-9]{64}$/.test(slotId)) transaction.delete(db.collection('bookingSlots').doc(slotId));
      }
      return { repeated: false };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'NOT_FOUND') return response('Appointment not found', 404);
    if (cause instanceof Error && cause.message === 'MEMBERSHIP_REQUIRED') return response('Active membership required', 403);
    if (cause instanceof Error && cause.message === 'INVALID_TRANSITION') return response('Invalid appointment status transition', 409);
    return response('Appointment update unavailable', 503);
  }
}
