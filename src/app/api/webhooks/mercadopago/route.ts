import { NextRequest, NextResponse } from 'next/server';
import { processWebhookNotificationAdmin } from '@/services/mercadopago';
import { verifyMercadoPagoWebhookSignature } from '@/lib/payments/security';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { processDepositPayment } from '@/lib/payments/deposits';

const MAX_WEBHOOK_BYTES = 64 * 1024;

type WebhookBody = {
  type?: unknown;
  topic?: unknown;
  action?: unknown;
  user_id?: unknown;
  data?: { id?: unknown; payment_id?: unknown };
};

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: WebhookBody;
  try {
    body = await readLimitedJson(request, MAX_WEBHOOK_BYTES) as WebhookBody;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('Invalid payload');
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Mercado Pago signs the raw data.id query parameter. This also preserves
  // large numeric case IDs that JSON.parse would round beyond MAX_SAFE_INTEGER.
  const queryResourceId = request.nextUrl.searchParams.get('data.id');
  const bodyResourceId = body?.data?.id;
  const signedResourceId = queryResourceId ?? (
    typeof bodyResourceId === 'string' || (typeof bodyResourceId === 'number' && Number.isSafeInteger(bodyResourceId))
      ? String(bodyResourceId)
      : ''
  );
  const signatureValid = verifyMercadoPagoWebhookSignature({
    secret: process.env.MP_WEBHOOK_SECRET,
    signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    dataId: signedResourceId.toLowerCase(),
  });
  const marketplaceSignatureValid = !!process.env.MP_MARKETPLACE_WEBHOOK_SECRET && verifyMercadoPagoWebhookSignature({
    secret: process.env.MP_MARKETPLACE_WEBHOOK_SECRET, signatureHeader: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'), dataId: signedResourceId.toLowerCase(),
  });
  if (!signatureValid && !marketplaceSignatureValid) {
    console.warn('[MP Webhook] Rejected notification with an invalid signature.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const paymentTopic = body.topic === 'payment' || body.type === 'payment' || body.action === 'payment.updated';
  // Checkout Pro via Preferences sends chargebacks as topic_chargebacks_wh:
  // data.id is the case ID used in the signature, while data.payment_id is
  // the payment to re-fetch and reconcile. Never trust the event's status.
  const chargebackTopic = body.type === 'topic_chargebacks_wh' || body.topic === 'topic_chargebacks_wh';
  const chargebackPaymentId = body?.data?.payment_id;
  const paymentId = chargebackTopic
    ? (typeof chargebackPaymentId === 'string' || (typeof chargebackPaymentId === 'number' && Number.isSafeInteger(chargebackPaymentId))
      ? String(chargebackPaymentId) : '')
    : signedResourceId;
  if ((!paymentTopic && !chargebackTopic) || !signedResourceId || !/^[A-Za-z0-9_-]{1,120}$/.test(paymentId)) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  try {
    const result = marketplaceSignatureValid
      ? await processDepositPayment(paymentId, undefined, typeof body.user_id === 'string' || typeof body.user_id === 'number' && Number.isSafeInteger(body.user_id) ? String(body.user_id) : undefined)
      : await processWebhookNotificationAdmin(paymentId);
    return NextResponse.json({ status: result.processed ? 'processed' : 'received', duplicate: !!result.duplicate }, { status: 200 });
  } catch {
    // A 5xx deliberately asks Mercado Pago to retry transient processing failures.
    // Provider and SDK error objects can contain request metadata; do not log
    // their raw payloads or credentials.
    console.error('[MP Webhook] Processing failed for a signed payment notification.');
    return NextResponse.json({ error: 'Processing failed' }, { status: 503 });
  }
}
