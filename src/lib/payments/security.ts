import crypto from 'crypto';

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function createOpaqueId(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = createOpaqueId(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function parseMercadoPagoSignature(value: string | null): { timestamp: string; signature: string } | null {
  if (!value) return null;

  const fields = new Map<string, string>();
  for (const part of value.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    fields.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }

  const timestamp = fields.get('ts');
  const signature = fields.get('v1');
  return timestamp && signature ? { timestamp, signature } : null;
}

export function verifyMercadoPagoWebhookSignature(input: {
  secret: string | undefined;
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string;
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = input;
  if (!secret || !requestId || !dataId) return false;

  const parsed = parseMercadoPagoSignature(signatureHeader);
  if (!parsed || !/^\d{1,20}$/.test(parsed.timestamp) || !/^[a-fA-F0-9]{64}$/.test(parsed.signature)) {
    return false;
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${parsed.timestamp};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const received = parsed.signature.toLowerCase();
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}

export function isOpaqueOrderId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

export function paymentAmountMatches(actual: unknown, expected: number): boolean {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 0.000001;
}
