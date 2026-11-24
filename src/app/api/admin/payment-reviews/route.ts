import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getAdminFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getAdminFirestore();
    const [orders, payments, reconciliationFailures] = await Promise.all([
      db.collection('paymentOrders').where('status', 'in', ['reversal_pending_review', 'payment_conflict_review']).limit(101).get(),
      db.collection('processedPayments').where('status', '==', 'approval_pending_review').limit(101).get(),
      db.collection('paymentReconciliationFailures').where('status', '==', 'open').limit(101).get(),
    ]);
    const orderReviews = orders.docs.map(doc => {
      const order = doc.data();
      return {
        orderId: doc.id,
        businessId: String(order.businessId || ''),
        paymentId: String(order.paymentId || ''),
        status: String(order.status || ''),
        reason: String(order.reviewReason || order.reversalStatus || ''),
      };
    });
    const paymentReviews = payments.docs.map(doc => {
      const payment = doc.data();
      return {
        orderId: String(payment.orderId || ''),
        businessId: String(payment.businessId || ''),
        paymentId: doc.id,
        status: String(payment.status || ''),
        reason: String(payment.reviewReason || ''),
      };
    });
    const failureReviews = reconciliationFailures.docs.map(doc => {
      const failure = doc.data();
      const subjectId = String(failure.subjectId || '');
      const isOrder = failure.stream === 'orders';
      return {
        orderId: isOrder ? subjectId : '',
        businessId: '',
        paymentId: isOrder ? '' : subjectId,
        status: 'reconciliation_error',
        reason: String(failure.reason || 'provider_or_ledger_error'),
        source: 'reconciliation',
      };
    });
    const combined = [...orderReviews, ...paymentReviews, ...failureReviews];
    const reviews = combined.filter((review, index) => combined.findIndex(other => other.orderId === review.orderId && other.paymentId === review.paymentId && other.status === review.status) === index).slice(0, 100);
    return NextResponse.json({ reviews, more: orders.size > 100 || payments.size > 100 || reconciliationFailures.size > 100 || combined.length > 100 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Payment reviews unavailable' }, { status: 503 });
  }
}
