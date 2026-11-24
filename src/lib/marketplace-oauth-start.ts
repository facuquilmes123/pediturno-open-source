import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { createOpaqueId, createPkcePair, OAUTH_STATE_TTL_SECONDS } from '@/lib/payments/security';
import { encryptOAuthSecret, marketplaceConfiguration } from '@/lib/payments/marketplace';
import { getVerticalFromBusinessType, getVerticalOrigin } from '@/lib/verticals';
import { isBusinessOperational } from '@/lib/server-membership';
import { canUseOnlineDeposits, SERVICES_DEPOSITS_UNAVAILABLE } from '@/lib/release-features';

export type MarketplaceAuthorizationStart = { url: string; state: string; expiresAt: Date };

/** Creates the server-side PKCE state used by both browser and Android handoff flows. */
export async function createMarketplaceAuthorizationStart(uid: string): Promise<MarketplaceAuthorizationStart> {
  const { clientId, redirectUri } = marketplaceConfiguration();
  const db = getAdminFirestore();
  const businessRef = db.collection('businesses').doc(uid);
  const state = createOpaqueId();
  const pkce = createPkcePair();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000);
  const attemptRef = db.collection('oauthStates').doc(state);
  await db.runTransaction(async tx => {
    const [business, previous] = await Promise.all([
      tx.get(businessRef), tx.get(db.collection('oauthAttemptLocks').doc(uid)),
    ]);
    if (!isBusinessOperational(business.data())) throw new Error('MEMBERSHIP_REQUIRED');
    if (!canUseOnlineDeposits(business.get('businessType'))) throw new Error(SERVICES_DEPOSITS_UNAVAILABLE);
    if (previous.get('nextAttemptAt') instanceof Timestamp && previous.get('nextAttemptAt').toMillis() > Date.now()) throw new Error('RATE_LIMIT');
    tx.set(db.collection('oauthAttemptLocks').doc(uid), { nextAttemptAt: Timestamp.fromMillis(Date.now() + 10_000) });
    tx.create(attemptRef, {
      uid, encryptedVerifier: encryptOAuthSecret(pkce.verifier),
      returnOrigin: getVerticalOrigin(getVerticalFromBusinessType(business.get('businessType'))),
      expiresAt: Timestamp.fromDate(expiresAt),
    });
  });
  const url = new URL('https://auth.mercadopago.com.ar/authorization');
  url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', platform_id: 'mp', state, redirect_uri: redirectUri, code_challenge: pkce.challenge, code_challenge_method: 'S256' }).toString();
  return { url: url.toString(), state, expiresAt };
}

export function marketplaceStateCookie(state: string, host: string) {
  return {
    name: 'mp_oauth_state', value: state,
    options: {
      httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: OAUTH_STATE_TTL_SECONDS,
      domain: host.endsWith('.pediturno.com') || host === 'pediturno.com' ? '.pediturno.com' : undefined,
    },
  };
}
