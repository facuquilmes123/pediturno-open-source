import { NextRequest, NextResponse } from 'next/server';
import { verifyMercadoPagoWebhookSignature, isOpaqueOrderId } from '@/lib/payments/security';
import { processDepositPayment } from '@/lib/payments/deposits';
import { deferClosedSellerEvent, reconcileDeletedSellerAfterPayment } from '@/lib/payments/marketplace-financial-closure';
import { readLimitedJson } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  let body: { type?: unknown; topic?: unknown; data?: { id?: unknown; payment_id?: unknown }; user_id?: unknown };
  try { body = await readLimitedJson(request, 64 * 1024) as typeof body; if (!body || typeof body !== 'object') throw new Error('Invalid body'); }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }
  const signedId = request.nextUrl.searchParams.get('data.id') || (typeof body.data?.id === 'string' || typeof body.data?.id === 'number' && Number.isSafeInteger(body.data.id) ? String(body.data.id) : '');
  if (!verifyMercadoPagoWebhookSignature({ secret: process.env.MP_MARKETPLACE_WEBHOOK_SECRET, signatureHeader: request.headers.get('x-signature'), requestId: request.headers.get('x-request-id'), dataId: signedId.toLowerCase() })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const chargeback = body.type === 'topic_chargebacks_wh' || body.topic === 'topic_chargebacks_wh';
  if (!chargeback && body.type !== 'payment' && body.topic !== 'payment') return NextResponse.json({ status: 'ignored' });
  const paymentId = chargeback ? (typeof body.data?.payment_id === 'string' || typeof body.data?.payment_id === 'number' && Number.isSafeInteger(body.data.payment_id) ? String(body.data.payment_id) : '') : signedId;
  const order = request.nextUrl.searchParams.get('order');
  if (!/^\d{1,32}$/.test(paymentId) || order && !isOpaqueOrderId(order)) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });
  try {
    if (await deferClosedSellerEvent(paymentId, signedId, chargeback ? 'chargeback' : 'payment')) return NextResponse.json({ status: 'financial_review_required', eventRetained: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    const result = await processDepositPayment(paymentId, order || undefined, typeof body.user_id === 'number' || typeof body.user_id === 'string' ? String(body.user_id) : undefined);
    await reconcileDeletedSellerAfterPayment(paymentId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Processing unavailable' }, { status: 503 }); }
}
