import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const BOOKING_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type BookingCapability = {
  appointmentId: string;
  businessId: string;
  purpose: 'appointment-change';
  createdAt: Date;
  expiresAt: Date;
  usedAt: null;
};

export type CreatedBookingCapability = {
  token: string;
  tokenHash: string;
  capability: BookingCapability;
};

export type EncryptedCapabilityToken = { ciphertext: string; iv: string; tag: string };

/**
 * Creates an opaque, single-use capability for a booking. Store only
 * `tokenHash` as the document id; the plaintext token belongs only in the
 * customer's action URL or a server-side delivery outbox.
 */
export function createBookingCapability({
  appointmentId,
  businessId,
  ttlMs = BOOKING_CAPABILITY_TTL_MS,
  now = new Date(),
}: {
  appointmentId: string;
  businessId: string;
  ttlMs?: number;
  now?: Date;
}): CreatedBookingCapability {
  if (!isOpaqueBookingCapabilityTokenId(appointmentId) || !isOpaqueBookingCapabilityTokenId(businessId)) {
    throw new Error('Invalid capability subject');
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 366 * 24 * 60 * 60 * 1000) {
    throw new Error('Invalid capability expiry');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid capability timestamp');

  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashBookingCapability(token),
    capability: {
      appointmentId,
      businessId,
      purpose: 'appointment-change',
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      usedAt: null,
    },
  };
}

export function hashBookingCapability(token: string): string {
  if (!isValidBookingCapabilityToken(token)) throw new Error('Invalid capability token');
  return createHash('sha256').update(token).digest('hex');
}

/** Encrypt a bearer token for a server-only delivery outbox. */
export function encryptCapabilityToken(token: string, encodedKey = process.env.BOOKING_CAPABILITY_OUTBOX_KEY): EncryptedCapabilityToken {
  if (!isValidBookingCapabilityToken(token)) throw new Error('Invalid capability token');
  const key = getOutboxKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}

export function decryptCapabilityToken(value: EncryptedCapabilityToken, encodedKey = process.env.BOOKING_CAPABILITY_OUTBOX_KEY): string {
  const key = getOutboxKey(encodedKey);
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value.ciphertext) || !/^[A-Za-z0-9_-]{16}$/.test(value.iv) || !/^[A-Za-z0-9_-]{22}$/.test(value.tag)) {
    throw new Error('Invalid encrypted capability token');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
    const token = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    if (!isValidBookingCapabilityToken(token)) throw new Error('Invalid encrypted capability token');
    return token;
  } catch {
    throw new Error('Invalid encrypted capability token');
  }
}

export function isValidBookingCapabilityToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function isBookingCapabilityUsable(capability: {
  purpose?: unknown;
  usedAt?: unknown;
  expiresAt?: unknown;
}, now = new Date()): boolean {
  const expiry = toDate(capability.expiresAt);
  return capability.purpose === 'appointment-change' &&
    capability.usedAt == null &&
    expiry !== null &&
    expiry.getTime() > now.getTime();
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const result = value.toDate();
    return result instanceof Date && Number.isFinite(result.getTime()) ? result : null;
  }
  return null;
}

function isOpaqueBookingCapabilityTokenId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function getOutboxKey(encodedKey: string | undefined): Buffer {
  if (typeof encodedKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) throw new Error('Booking capability outbox key is not configured');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('Booking capability outbox key is not configured');
  return key;
}
