import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { isOpaqueOrderId } from '@/lib/payments/security';
import { getBusinessBookingUrl } from '@/lib/verticals';
import { verifyPublicAppCheck } from '@/lib/app-check-server';
import { ensureDepositCheckout } from '@/lib/payments/deposits';
import { Timestamp } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!isOpaqueOrderId(orderId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!await verifyPublicAppCheck(request, { consume: true })) return NextResponse.json({ error: 'Request verification failed' }, { status: 401 });
  try {
    const db = getAdminFirestore();
    const ref = db.collection('depositOrders').doc(orderId);
    await db.runTransaction(async tx => {
      const order = await tx.get(ref);
      if (!order.exists || order.get('expiresAt').toMillis() <= Date.now()) throw new Error('EXPIRED');
      if (order.get('nextCheckoutAttemptAt') instanceof Timestamp && order.get('nextCheckoutAttemptAt').toMillis() > Date.now()) throw new Error('BUSY');
      tx.update(ref, { nextCheckoutAttemptAt: Timestamp.fromMillis(Date.now() + 10_000) });
    });
    const checkoutUrl = await ensureDepositCheckout(orderId);
    if (!checkoutUrl) throw new Error('UNAVAILABLE');
    return NextResponse.json({ checkoutUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'No se pudo abrir el pago. Revisá el estado de tu reserva antes de volver a intentar.' }, { status: 409 }); }
}
export async function GET(_request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!isOpaqueOrderId(orderId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const db = getAdminFirestore();
    const order = (await db.collection('depositOrders').doc(orderId).get()).data();
    if (!order || order.kind !== 'deposit') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [businessSnapshot, appointment] = await Promise.all([
      db.collection('businesses').doc(order.businessId).get(),
      db.collection('appointments').doc(order.appointmentId).get(),
    ]);
    const business = businessSnapshot.data();
    const pending = ['pending', 'creating', 'checkout_ready'].includes(order.status);
    const bookable = appointment.get('businessId') === order.businessId && appointment.get('status') === 'Pendiente' && appointment.get('paymentStatus') === 'pending';
    const status = order.paymentReviewRequired || order.status === 'reversal_review' ? 'review'
      : pending && !bookable ? 'cancelled'
      : pending && order.expiresAt.toMillis() <= Date.now() ? 'expired' : order.status;
    return NextResponse.json({
      status,
      amount: order.amount, expiresAt: order.expiresAt.toDate().toISOString(),
      checkoutUrl: status === 'checkout_ready' && bookable ? order.checkoutUrl : null,
      businessUrl: business?.slug ? getBusinessBookingUrl(business.businessType, business.slug) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Service unavailable' }, { status: 503 }); }
}
