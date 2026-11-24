import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { requireFirebaseUser } from '@/lib/payments/auth';
import { GOOGLE_PLAY_PRODUCT_ID, assertGooglePlayPackage, acknowledgeGooglePlaySubscription, getGooglePlaySubscription, GooglePlayConfigurationError, GooglePlayProviderError, GooglePlayVerificationError, hashGooglePlayAccount } from '@/lib/payments/google-play';
import { claimGooglePlayVerificationAttempt, markGooglePlayAcknowledgement, persistGooglePlaySubscription, resolveGooglePlaySubscriptionOwner } from '@/lib/payments/google-play-membership';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const schema = z.object({ productId: z.literal(GOOGLE_PLAY_PRODUCT_ID), purchaseToken: z.string().min(20).max(8192), packageName: z.string().min(3).max(255) }).strict();
function bearer(request: Request) { const value = request.headers.get('authorization'); return value?.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
export async function POST(request: Request) {
  let user: { uid: string };
  try { user = await requireFirebaseUser(bearer(request)); } catch { return NextResponse.json({ verified: false, message: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }); }
  let body: z.infer<typeof schema>;
  try { body = schema.parse(await readLimitedJson(request, 12_288)); } catch (error) { return NextResponse.json({ verified: false, message: 'Invalid purchase request' }, { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }); }
  try { if (!await claimGooglePlayVerificationAttempt(user.uid, body.purchaseToken)) return NextResponse.json({ verified: false, message: 'Too many verification attempts' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }); } catch { return NextResponse.json({ verified: false, message: 'Google Play verification unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  try {
    const packageName = assertGooglePlayPackage(body.packageName); const subscription = await getGooglePlaySubscription(packageName, body.purchaseToken);
    const ownerMatches = subscription.accountHash
      ? subscription.accountHash === hashGooglePlayAccount(user.uid)
      : await resolveGooglePlaySubscriptionOwner({ packageName, subscription }) === user.uid;
    if (!ownerMatches) throw new GooglePlayVerificationError('Purchase account mismatch.');
    const entitlement = await persistGooglePlaySubscription({ uid: user.uid, packageName, subscription });
    if (subscription.acknowledgement === 'pending') {
      try { await acknowledgeGooglePlaySubscription(packageName, subscription); await markGooglePlayAcknowledgement(body.purchaseToken, true); entitlement.acknowledgement = 'acknowledged'; }
      catch { await markGooglePlayAcknowledgement(body.purchaseToken, false).catch(() => undefined); }
    }
    return NextResponse.json({ verified: true, entitlement }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof GooglePlayConfigurationError) return NextResponse.json({ verified: false, message: 'Google Play verification unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof GooglePlayProviderError) return NextResponse.json({ verified: false, message: error.retryable ? 'Google Play verification unavailable' : 'Purchase could not be verified' }, { status: error.retryable ? 503 : 403, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof GooglePlayVerificationError) return NextResponse.json({ verified: false, message: 'Purchase could not be verified' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    const message = error instanceof Error ? error.message : '';
    if (message.includes('already bound')) return NextResponse.json({ verified: false, message: 'Purchase is already associated with another account' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ verified: false, message: 'Purchase could not be recorded' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export async function GET() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
