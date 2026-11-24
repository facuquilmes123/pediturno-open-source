import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { acknowledgeGooglePlaySubscription, assertGooglePlayPackage, getGooglePlaySubscription, GooglePlayConfigurationError, GooglePlayProviderError, GooglePlayVerificationError, verifyGooglePlayPushOidc } from '@/lib/payments/google-play';
import { markGooglePlayAcknowledgement, persistGooglePlaySubscription, resolveGooglePlaySubscriptionOwner } from '@/lib/payments/google-play-membership';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
type Push = { message?: { messageId?: unknown; data?: unknown }; subscription?: unknown };
function tokenFromHeader(request: Request) { const value = request.headers.get('authorization'); return value?.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
function decodeNotification(data: unknown): { purchaseToken: string; packageName: string; notificationType: number | null } {
  if (typeof data !== 'string' || data.length > 32_768) throw new GooglePlayVerificationError('Invalid RTDN payload.');
  let parsed: unknown; try { parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8')); } catch { throw new GooglePlayVerificationError('Invalid RTDN payload.'); }
  const event = parsed as { packageName?: unknown; testNotification?: { version?: unknown }; subscriptionNotification?: { purchaseToken?: unknown; notificationType?: unknown } };
  if (typeof event.packageName !== 'string') throw new GooglePlayVerificationError('Unsupported RTDN payload.');
  if (event.testNotification && typeof event.testNotification.version === 'string') return { purchaseToken: '', packageName: event.packageName, notificationType: null };
  if (typeof event.subscriptionNotification?.purchaseToken !== 'string') throw new GooglePlayVerificationError('Unsupported RTDN payload.');
  return { purchaseToken: event.subscriptionNotification.purchaseToken, packageName: event.packageName, notificationType: typeof event.subscriptionNotification.notificationType === 'number' ? event.subscriptionNotification.notificationType : null };
}
export async function POST(request: Request) {
  try { await verifyGooglePlayPushOidc(tokenFromHeader(request)); }
  catch (error) { return NextResponse.json({ error: error instanceof GooglePlayConfigurationError ? 'Not configured' : 'Unauthorized' }, { status: error instanceof GooglePlayConfigurationError ? 503 : 401 }); }
  let push: Push; try { push = await readLimitedJson(request, 48_000) as Push; } catch (error) { return NextResponse.json({ error: 'Invalid push payload' }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 }); }
  const messageId = push.message?.messageId; if (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(messageId)) return NextResponse.json({ error: 'Invalid push message' }, { status: 400 });
  let notification: { purchaseToken: string; packageName: string; notificationType: number | null }; try { notification = decodeNotification(push.message?.data); } catch { return NextResponse.json({ error: 'Invalid push payload' }, { status: 400 }); }
  const db = getAdminFirestore(); const eventRef = db.collection('googlePlayRtdnEvents').doc(messageId); const processingClaimId = randomUUID();
  const claimed = await db.runTransaction(async tx => { const existing = await tx.get(eventRef); const lease = existing.exists ? existing.get('leaseUntil')?.toMillis?.() : null; if (existing.exists && (existing.get('status') === 'processed' || existing.get('status') === 'permanent_failure' || (['processing', 'replaying'].includes(existing.get('status')) && typeof lease === 'number' && lease > Date.now()))) return false; tx.set(eventRef, { status: 'processing', processingClaimId, messageId, receivedAt: existing.get('receivedAt') ?? FieldValue.serverTimestamp(), leaseUntil: new Date(Date.now() + 5 * 60_000), attempts: FieldValue.increment(1) }, { merge: true }); return true; });
  if (!claimed) return new NextResponse(null, { status: 204 });
  const complete = (value: Record<string, unknown>) => db.runTransaction(async tx => {
    const current = await tx.get(eventRef);
    if (current.get('status') !== 'processing' || current.get('processingClaimId') !== processingClaimId) return false;
    tx.set(eventRef, { ...value, processingClaimId: null, leaseUntil: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  try {
    const packageName = assertGooglePlayPackage(notification.packageName);
    if (!notification.purchaseToken) { await complete({ status: 'processed', testNotification: true }); return new NextResponse(null, { status: 204 }); }
    const subscription = await getGooglePlaySubscription(packageName, notification.purchaseToken);
    const uid = await resolveGooglePlaySubscriptionOwner({ packageName, subscription });
    if (typeof uid !== 'string' || !uid) { await complete({ status: 'awaiting_account_mapping', purchaseToken: notification.purchaseToken, packageName, notificationType: notification.notificationType, nextAttemptAt: new Date() }); return new NextResponse(null, { status: 204 }); }
    await persistGooglePlaySubscription({ uid, packageName, subscription });
    if (subscription.acknowledgement === 'pending') {
      try { await acknowledgeGooglePlaySubscription(packageName, subscription); await markGooglePlayAcknowledgement(subscription.purchaseToken, true); }
      catch { await markGooglePlayAcknowledgement(subscription.purchaseToken, false).catch(() => undefined); }
    }
    await complete({ status: 'processed' });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const retryable = !(error instanceof GooglePlayVerificationError) && (!(error instanceof GooglePlayProviderError) || error.retryable);
    await complete({ status: retryable ? 'retryable_failure' : 'permanent_failure', ...(retryable && notification.purchaseToken ? { purchaseToken: notification.purchaseToken, packageName: notification.packageName, notificationType: notification.notificationType, nextAttemptAt: new Date(Date.now() + 60_000) } : {}) }).catch(() => undefined);
    // Pub/Sub retries only non-2xx responses. Do not disclose provider evidence.
    if (!retryable) return new NextResponse(null, { status: 204 });
    return NextResponse.json({ error: error instanceof GooglePlayProviderError ? 'Provider unavailable' : 'Processing failed' }, { status: 503 });
  }
}
export async function GET() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
