import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { MARKETPLACE_CALLBACK, MARKETPLACE_ORIGIN, decryptOAuthSecret, encryptOAuthSecret, exchangeMarketplaceToken, mercadoPagoRequest } from '@/lib/payments/marketplace';
import { createOpaqueId } from '@/lib/payments/security';
import { isBusinessOperational } from '@/lib/server-membership';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const dynamic = 'force-dynamic';
const COOKIE = 'mp_oauth_state';
function redirect(status: string, success = false, origin = MARKETPLACE_ORIGIN) {
  const safeOrigin = ['https://pediturno.com', 'https://canchas.pediturno.com', 'https://espacios.pediturno.com'].includes(origin) ? origin : MARKETPLACE_ORIGIN;
  const destination = new URL('/dashboard/ajustes', safeOrigin);
  destination.searchParams.set(success ? 'mp_status' : 'mp_error', status);
  const response = NextResponse.redirect(destination);
  response.cookies.set(COOKIE, '', { path: '/', domain: '.pediturno.com', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0 });
  response.headers.append('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const cookie = request.cookies.get(COOKIE)?.value;
  const denied = request.nextUrl.searchParams.has('error');
  if ((!code && !denied) || code && code.length > 2048 || !state || !/^[A-Za-z0-9_-]{20,128}$/.test(state) || !cookie || cookie.length !== state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return redirect('invalid_state');
  let returnOrigin = MARKETPLACE_ORIGIN;
  try {
    const db = getAdminFirestore();
    const stateRef = db.collection('oauthStates').doc(state);
    const consumed = await db.runTransaction(async tx => {
      const attempt = (await tx.get(stateRef)).data();
      if (!attempt || attempt.usedAt || !(attempt.expiresAt instanceof Timestamp) || attempt.expiresAt.toMillis() <= Date.now() || typeof attempt.uid !== 'string' || !attempt.encryptedVerifier) throw new Error('Invalid attempt');
      const business = await tx.get(db.collection('businesses').doc(attempt.uid));
      if (!isBusinessOperational(business.data()) || !canUseOnlineDeposits(business.get('businessType'))) throw new Error('Business unavailable');
      tx.update(stateRef, { usedAt: FieldValue.serverTimestamp(), encryptedVerifier: FieldValue.delete() });
      return { uid: attempt.uid, verifier: decryptOAuthSecret(attempt.encryptedVerifier), returnOrigin: attempt.returnOrigin };
    });
    returnOrigin = consumed.returnOrigin;
    if (denied) return redirect('authorization_denied', false, returnOrigin);
    const token = await exchangeMarketplaceToken({ grant_type: 'authorization_code', code: code!, redirect_uri: MARKETPLACE_CALLBACK, code_verifier: consumed.verifier });
    const seller = await mercadoPagoRequest<{ id: number | string; site_id: string }>('/users/me', token.access_token as string);
    if (String(seller.id) !== String(token.user_id) || seller.site_id !== 'MLA') return redirect('invalid_seller', false, returnOrigin);
    const businessRef = db.collection('businesses').doc(consumed.uid);
    const connectionRef = db.collection('mercadoPagoConnections').doc(consumed.uid);
    await db.runTransaction(async tx => {
      const business = await tx.get(businessRef);
      const previous = await tx.get(connectionRef);
      const history = await tx.get(db.collection('depositOrders').where('businessId', '==', consumed.uid).limit(1));
      if (!isBusinessOperational(business.data()) || !canUseOnlineDeposits(business.get('businessType'))) throw new Error('Business unavailable');
      if (!history.empty && previous.exists && (previous.get('merchantUserId') !== String(seller.id) || previous.get('liveMode') !== token.live_mode)) throw new Error('Past deposits require the same seller account and mode');
      tx.set(connectionRef, {
        connectionId: createOpaqueId(), active: true, encryptedAccessToken: encryptOAuthSecret(token.access_token as string), encryptedRefreshToken: encryptOAuthSecret(token.refresh_token as string),
        merchantUserId: String(seller.id), liveMode: token.live_mode, tokenExpiresAt: Timestamp.fromMillis(Date.now() + Number(token.expires_in) * 1000), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(businessRef, { 'mercadopago.isConnected': true, 'mercadopago.connectedAt': FieldValue.serverTimestamp(),
        'mercadopago.accessToken': FieldValue.delete(), 'mercadopago.refreshToken': FieldValue.delete(), 'mercadopago.publicKey': FieldValue.delete(), 'mercadopago.userId': FieldValue.delete() });
    });
    return redirect('connected', true, returnOrigin);
  } catch {
    console.error('No se pudo completar una vinculación validada de Mercado Pago.');
    return redirect('connection_failed', false, returnOrigin);
  }
}
