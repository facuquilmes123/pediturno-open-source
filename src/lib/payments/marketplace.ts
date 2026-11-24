import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';

export const MARKETPLACE_ORIGIN = 'https://pediturno.com';
export const MARKETPLACE_CALLBACK = `${MARKETPLACE_ORIGIN}/api/auth/mercadopago/callback`;

const MARKETPLACE_QA_ORIGIN = 'https://essential-mediumvioletred-lark-44.hostingersite.com';
const MARKETPLACE_WEBHOOK_PATH = '/api/webhooks/mercadopago/marketplace';

function marketplaceDepositDestination() {
  const qaKey = process.env.PEDITURNO_QA_MARKETPLACE_WRITE;
  if (qaKey === undefined) return { origin: MARKETPLACE_ORIGIN, webhook: `${MARKETPLACE_ORIGIN}${MARKETPLACE_WEBHOOK_PATH}` };
  if (!/^[A-Za-z0-9_-]{43}$/.test(qaKey) || process.env.NODE_ENV !== 'test' ||
      process.env.FIREBASE_PROJECT_ID !== 'demo-pediturno-mp-qa' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.MP_MARKETPLACE_APP_ID !== '387052224556910') {
    throw new Error('Marketplace QA destination unavailable');
  }
  return { origin: MARKETPLACE_QA_ORIGIN, webhook: `${MARKETPLACE_QA_ORIGIN}/qa/${qaKey}${MARKETPLACE_WEBHOOK_PATH}` };
}

export function marketplaceDepositUrls(orderId: string) {
  const { origin, webhook } = marketplaceDepositDestination();
  return { notification: `${webhook}?order=${encodeURIComponent(orderId)}`, returnTo: `${origin}/pago/${encodeURIComponent(orderId)}` };
}

export function marketplaceConfiguration() {
  const clientId = process.env.MP_MARKETPLACE_APP_ID;
  const clientSecret = process.env.MP_MARKETPLACE_CLIENT_SECRET;
  const redirectUri = process.env.MP_MARKETPLACE_REDIRECT_URI || MARKETPLACE_CALLBACK;
  if (!clientId || !/^\d{1,32}$/.test(clientId) || !clientSecret || redirectUri !== MARKETPLACE_CALLBACK) throw new Error('Marketplace configuration unavailable');
  marketplaceDepositDestination();
  return { clientId, clientSecret, redirectUri };
}

function encryptionKey(): Buffer {
  const source = Buffer.from(process.env.MP_TOKEN_ENCRYPTION_KEY || process.env.BOOKING_CAPABILITY_OUTBOX_KEY || '', 'base64');
  if (source.length !== 32) throw new Error('Token encryption unavailable');
  // Domain separation keeps OAuth credentials independent of booking capability ciphertexts.
  return Buffer.from(hkdfSync('sha256', source, 'pediturno', 'mercadopago-oauth-v1', 32));
}
export type EncryptedOAuthSecret = { iv: string; tag: string; ciphertext: string };
export function encryptOAuthSecret(value: string): EncryptedOAuthSecret {
  if (!value || value.length > 8192) throw new Error('Invalid OAuth secret');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function decryptOAuthSecret(value: EncryptedOAuthSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export async function mercadoPagoRequest<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid provider path');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Mercado Pago request unavailable');
  return response.json() as Promise<T>;
}

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; user_id?: unknown; expires_in?: unknown; live_mode?: unknown };
export async function exchangeMarketplaceToken(params: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = marketplaceConfiguration();
  const response = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }), cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result.access_token !== 'string' || typeof result.refresh_token !== 'string' || !/^\d{1,32}$/.test(String(result.user_id)) ||
      typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || typeof result.live_mode !== 'boolean') throw new Error('OAuth exchange unavailable');
  return result;
}

export async function getSellerConnection(businessId: string, settlement = false): Promise<{ accessToken: string; merchantUserId: string; liveMode: boolean }> {
  const db = getAdminFirestore();
  const ref = db.collection('mercadoPagoConnections').doc(businessId);
  const snapshot = await ref.get();
  const connection = snapshot.data();
  if (!connection?.encryptedAccessToken || !/^\d{1,32}$/.test(connection.merchantUserId) || typeof connection.liveMode !== 'boolean' || !settlement && connection.active === false) throw new Error('Seller must reconnect');
  if (connection.tokenExpiresAt instanceof Timestamp && connection.tokenExpiresAt.toMillis() > Date.now() + 60000) {
    return { accessToken: decryptOAuthSecret(connection.encryptedAccessToken), merchantUserId: connection.merchantUserId, liveMode: connection.liveMode };
  }
  const generation = connection.connectionId;
  const claimed = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || current.connectionId !== generation || current.refreshLeaseUntil instanceof Timestamp && current.refreshLeaseUntil.toMillis() > Date.now()) return false;
    tx.update(ref, { refreshLeaseUntil: Timestamp.fromMillis(Date.now() + 60000) });
    return true;
  });
  if (!claimed) throw new Error('Connection refresh in progress');
  try {
    const token = await exchangeMarketplaceToken({ grant_type: 'refresh_token', refresh_token: decryptOAuthSecret(connection.encryptedRefreshToken) });
    if (String(token.user_id) !== connection.merchantUserId || token.live_mode !== connection.liveMode) throw new Error('Seller identity changed');
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.get('connectionId') !== generation) throw new Error('Connection changed');
      tx.update(ref, { encryptedAccessToken: encryptOAuthSecret(token.access_token as string), encryptedRefreshToken: encryptOAuthSecret(token.refresh_token as string),
        tokenExpiresAt: Timestamp.fromMillis(Date.now() + Number(token.expires_in) * 1000), refreshLeaseUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    });
    return { accessToken: token.access_token as string, merchantUserId: connection.merchantUserId, liveMode: connection.liveMode };
  } catch {
    await db.runTransaction(async tx => {
      if ((await tx.get(ref)).get('connectionId') === generation) tx.update(ref, { refreshLeaseUntil: FieldValue.delete() });
    }).catch(() => undefined);
    throw new Error('Seller connection unavailable');
  }
}
