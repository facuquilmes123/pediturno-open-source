import 'server-only';
import crypto from 'node:crypto';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

export const GOOGLE_PLAY_PRODUCT_ID = 'pediturno_servicios_pro_monthly';
const PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const PUBLISHER_ORIGIN = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

export type GooglePlayEntitlementStatus = 'active' | 'grace_period' | 'pending' | 'on_hold' | 'paused' | 'expired' | 'revoked';
export type GooglePlaySubscription = { productId: string; basePlanId: string; purchaseToken: string; accountHash: string; status: GooglePlayEntitlementStatus; expiresAt: Date | null; autoRenewing: boolean; acknowledgement: 'acknowledged' | 'pending'; orderId: string | null; linkedPurchaseToken: string | null; expiredPurchaseToken: string | null; rawState: string };
type PublisherLineItem = { productId?: unknown; expiryTime?: unknown; autoRenewingPlan?: { autoRenewEnabled?: unknown } | null; offerDetails?: { basePlanId?: unknown } | null };
type PublisherResponse = { subscriptionState?: unknown; acknowledgementState?: unknown; latestOrderId?: unknown; linkedPurchaseToken?: unknown; externalAccountIdentifiers?: { obfuscatedExternalAccountId?: unknown } | null; outOfAppPurchaseContext?: { expiredExternalAccountIdentifiers?: { obfuscatedExternalAccountId?: unknown } | null; expiredPurchaseToken?: unknown } | null; lineItems?: PublisherLineItem[] };
export class GooglePlayConfigurationError extends Error {}
export class GooglePlayProviderError extends Error { constructor(message: string, public readonly retryable: boolean, public readonly statusCode?: number) { super(message); } }
export class GooglePlayVerificationError extends Error {}

export function hashGooglePlayAccount(uid: string): string { return crypto.createHash('sha256').update(`pediturno:google-play:v1:${uid}`, 'utf8').digest('base64url'); }
export function hashGooglePlayPurchaseToken(token: string): string { return crypto.createHash('sha256').update(`pediturno:google-play:token:v1:${token}`, 'utf8').digest('hex'); }
function configuredPackages(): string[] {
  const primary = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim();
  if (!primary) throw new GooglePlayConfigurationError('Google Play package is not configured.');
  const packages = [primary];
  if (process.env.GOOGLE_PLAY_ALLOW_TEST_PACKAGES === 'true') for (const value of (process.env.GOOGLE_PLAY_TEST_PACKAGE_NAMES ?? '').split(',')) { const name = value.trim(); if (name) packages.push(name); }
  return [...new Set(packages)];
}
function configuredBasePlanId(): string {
  const value = process.env.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID?.trim();
  if (!value || !/^[A-Za-z0-9_-]{1,63}$/.test(value)) throw new GooglePlayConfigurationError('Google Play monthly base plan is not configured.');
  return value;
}
export function assertGooglePlayPackage(packageName: unknown): string {
  if (typeof packageName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) throw new GooglePlayVerificationError('Invalid Android package name.');
  if (!configuredPackages().includes(packageName)) throw new GooglePlayVerificationError('Android package is not allowed.');
  return packageName;
}
function serviceAccountCredentials(): Record<string, unknown> {
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (encoded) {
    try { const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>; if (parsed.type !== 'service_account' || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') throw new Error(); return parsed; } catch { throw new GooglePlayConfigurationError('Google Play service account credentials are invalid.'); }
  }
  // Reuse the server-only Firebase Admin identity when no dedicated Play
  // identity is configured. It still fails closed unless that identity was
  // explicitly granted Android Publisher access in Play Console.
  const clientEmail = process.env.GCLOUD_CLIENT_EMAIL?.trim(); const projectId = process.env.FIREBASE_PROJECT_ID?.trim(); const privateKeyBase64 = process.env.GCLOUD_PRIVATE_KEY_BASE64?.trim();
  if (!clientEmail || !projectId || !privateKeyBase64) throw new GooglePlayConfigurationError('Google Play service account is not configured.');
  try { const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8'); if (!privateKey.includes('BEGIN PRIVATE KEY')) throw new Error(); return { type: 'service_account', project_id: projectId, client_email: clientEmail, private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }; } catch { throw new GooglePlayConfigurationError('Google Play service account credentials are invalid.'); }
}
async function publisherAccessToken(): Promise<string> { const auth = new GoogleAuth({ credentials: serviceAccountCredentials(), scopes: [PUBLISHER_SCOPE] }); const token = await (await auth.getClient()).getAccessToken(); if (!token.token) throw new GooglePlayConfigurationError('Google Play service account could not obtain an access token.'); return token.token; }
function parseDate(value: unknown): Date | null { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function statusFromGoogle(state: unknown, expiry: Date | null, now: number): GooglePlayEntitlementStatus { switch (state) { case 'SUBSCRIPTION_STATE_ACTIVE': return 'active'; case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD': return 'grace_period'; case 'SUBSCRIPTION_STATE_CANCELED': return expiry && expiry.getTime() > now ? 'active' : 'expired'; case 'SUBSCRIPTION_STATE_PENDING': return 'pending'; case 'SUBSCRIPTION_STATE_ON_HOLD': return 'on_hold'; case 'SUBSCRIPTION_STATE_PAUSED': return 'paused'; case 'SUBSCRIPTION_STATE_EXPIRED': return 'expired'; case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED': return 'revoked'; default: return 'revoked'; } }
export function subscriptionIsEntitled(subscription: Pick<GooglePlaySubscription, 'status' | 'expiresAt'>, now = Date.now()): boolean { return (subscription.status === 'active' || subscription.status === 'grace_period') && !!subscription.expiresAt && subscription.expiresAt.getTime() > now; }
export function parseGooglePlaySubscription(input: unknown, purchaseToken: string, now = Date.now()): GooglePlaySubscription {
  if (!input || typeof input !== 'object') throw new GooglePlayProviderError('Google Play returned an invalid subscription response.', true);
  const result = input as PublisherResponse; const currentAccountHash = result.externalAccountIdentifiers?.obfuscatedExternalAccountId; const expiredAccountHash = result.outOfAppPurchaseContext?.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId; if (typeof currentAccountHash === 'string' && typeof expiredAccountHash === 'string' && currentAccountHash !== expiredAccountHash) throw new GooglePlayVerificationError('Subscription account bindings conflict.'); const accountHash = typeof currentAccountHash === 'string' ? currentAccountHash : expiredAccountHash;
  const expiredPurchaseToken = typeof result.outOfAppPurchaseContext?.expiredPurchaseToken === 'string' ? result.outOfAppPurchaseContext.expiredPurchaseToken : null;
  const hasAccountHash = typeof accountHash === 'string' && accountHash.length >= 20 && accountHash.length <= 256;
  if ((currentAccountHash != null && typeof currentAccountHash !== 'string') || (expiredAccountHash != null && typeof expiredAccountHash !== 'string') || (typeof accountHash === 'string' && accountHash.length > 0 && !hasAccountHash)) throw new GooglePlayVerificationError('Subscription account binding is invalid.');
  // Google removes outOfAppPurchaseContext after acknowledgement. Missing
  // metadata can only be recovered later from an already verified private ledger.
  if (!hasAccountHash && !expiredPurchaseToken && result.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') throw new GooglePlayVerificationError('Subscription is not bound to a Pediturno account.');
  const item = result.lineItems?.find(line => line?.productId === GOOGLE_PLAY_PRODUCT_ID); if (!item) throw new GooglePlayVerificationError('Subscription product does not match Pediturno Servicios.');
  const basePlanId = item.offerDetails?.basePlanId; if (basePlanId !== configuredBasePlanId()) throw new GooglePlayVerificationError('Subscription base plan does not match the monthly plan.');
  const expiresAt = parseDate(item.expiryTime); if (!expiresAt) throw new GooglePlayProviderError('Google Play subscription has no valid expiry.', true);
  const rawState = typeof result.subscriptionState === 'string' ? result.subscriptionState : ''; const acknowledgement = result.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' ? 'acknowledged' : 'pending';
  return { productId: GOOGLE_PLAY_PRODUCT_ID, basePlanId, purchaseToken, accountHash: typeof accountHash === 'string' ? accountHash : '', status: statusFromGoogle(rawState, expiresAt, now), expiresAt, autoRenewing: item.autoRenewingPlan?.autoRenewEnabled === true, acknowledgement, orderId: typeof result.latestOrderId === 'string' ? result.latestOrderId : null, linkedPurchaseToken: typeof result.linkedPurchaseToken === 'string' ? result.linkedPurchaseToken : null, expiredPurchaseToken, rawState };
}
async function publisherRequest(path: string, init?: RequestInit): Promise<Response> { const token = await publisherAccessToken(); let response: Response; try { response = await fetch(`${PUBLISHER_ORIGIN}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' }); } catch { throw new GooglePlayProviderError('Google Play Publisher API is unavailable.', true); } if (!response.ok) throw new GooglePlayProviderError('Google Play Publisher API rejected the request.', response.status >= 500 || response.status === 429, response.status); return response; }
export async function getGooglePlaySubscription(packageName: string, purchaseToken: string): Promise<GooglePlaySubscription> { const response = await publisherRequest(`/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`); return parseGooglePlaySubscription(await response.json(), purchaseToken); }
export async function acknowledgeGooglePlaySubscription(packageName: string, subscription: GooglePlaySubscription): Promise<void> { if (subscription.acknowledgement === 'acknowledged') return; await publisherRequest(`/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(subscription.productId)}/tokens/${encodeURIComponent(subscription.purchaseToken)}:acknowledge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); }
export async function verifyGooglePlayPushOidc(idToken: string): Promise<void> { const audience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim(); const expectedEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim(); if (!audience || !expectedEmail) throw new GooglePlayConfigurationError('Google Play RTDN OIDC is not configured.'); try { const payload = (await new OAuth2Client().verifyIdToken({ idToken, audience })).getPayload(); const issuer = payload?.iss; if ((issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') || payload?.email !== expectedEmail || payload.email_verified !== true) throw new Error(); } catch { throw new GooglePlayVerificationError('Invalid Pub/Sub push identity.'); } }
