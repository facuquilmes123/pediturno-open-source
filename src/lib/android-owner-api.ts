import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { BUSINESS_TIME_ZONE, dateKeyInZone, isDateKey, localTimeToUtc } from '@/lib/booking-constraints';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { getEffectiveMembership, getBusinessPlan } from '@/lib/membership-entitlement';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const ANDROID_OWNER_API_VERSION = '2026-10-26';
export const ANDROID_OWNER_MAX_BODY_BYTES = 16 * 1024;

export type AndroidOwner = {
  uid: string;
  db: FirebaseFirestore.Firestore;
  business: Record<string, unknown>;
  authTime: number | null;
};

export class AndroidOwnerApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function androidError(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function readAndroidOwnerJson(request: Request, maxBytes = ANDROID_OWNER_MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) {
    throw new AndroidOwnerApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
  }
  let parsed: unknown;
  try {
    parsed = await readLimitedJson(request, maxBytes);
  } catch (cause) {
    if (cause instanceof RequestBodyTooLarge) {
      throw new AndroidOwnerApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
    }
    throw new AndroidOwnerApiError(400, 'INVALID_REQUEST', 'Invalid request');
  }
  try {
    const record = asRecord(parsed);
    if (!record) throw new Error('not object');
    return record;
  } catch {
    throw new AndroidOwnerApiError(400, 'INVALID_REQUEST', 'Invalid request');
  }
}

/**
 * Authentication and scope are derived solely from a recently valid Firebase
 * session. No Android route accepts a businessId as authority.
 */
export async function requireAndroidOwner(request: Request, options: { allowDeletionRequested?: boolean; allowOtherBusinessTypes?: boolean } = {}): Promise<AndroidOwner> {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  let uid: string;
  let authTime: number | null;
  try {
    initializeAdminApp();
    const decoded = await getAuth().verifyIdToken(match[1], true);
    uid = decoded.uid;
    authTime = typeof decoded.auth_time === 'number' && Number.isFinite(decoded.auth_time) ? decoded.auth_time : null;
  } catch {
    throw new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
  const db = getAdminFirestore();
  const snapshot = await db.collection('businesses').doc(uid).get();
  const business = snapshot.data() as Record<string, unknown> | undefined;
  if (!business) throw new AndroidOwnerApiError(404, 'BUSINESS_PROFILE_REQUIRED', 'Business profile required');
  if (business.status !== undefined && business.status !== 'active' && !(options.allowDeletionRequested && business.status === 'deletion_requested')) {
    throw new AndroidOwnerApiError(403, 'BUSINESS_UNAVAILABLE', 'Business unavailable');
  }
  if (!options.allowOtherBusinessTypes && business.businessType !== undefined && business.businessType !== 'services') {
    throw new AndroidOwnerApiError(403, 'WRONG_BUSINESS_TYPE', 'This Android API is available for Servicios only');
  }
  return { uid, db, business, authTime };
}

export function ownerTimeZone(business: Record<string, unknown>): string {
  return typeof business.timeZone === 'string' && business.timeZone.length <= 64 ? business.timeZone : BUSINESS_TIME_ZONE;
}

export function androidDate(value: unknown): string | null {
  const date = value instanceof Timestamp ? value.toDate()
    : value instanceof Date ? value
      : value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeString(value: unknown, max = 2048): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeArray(value: unknown, mapper: (item: unknown) => unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length <= 366 ? value.map(mapper) : undefined;
}

/** Deliberately excludes membership payment internals and every Mercado Pago credential. */
export function androidBusinessDto(uid: string, business: Record<string, unknown>) {
  const address = asRecord(business.address) || {};
  const bookingSettings = asRecord(business.bookingSettings) || {};
  const membership = getEffectiveMembership(business);
  const planEntitlement = getBusinessPlan(business);
  const location = asRecord(business.location);
  const customTheme = asRecord(business.customTheme);
  const mercadoPago = asRecord(business.mercadopago);
  return {
    id: uid,
    name: safeString(business.name, 120) || '',
    email: safeString(business.email, 254) || '',
    slug: safeString(business.slug, 80) || null,
    businessType: safeString(business.businessType, 30) || 'services',
    timeZone: ownerTimeZone(business),
    description: safeString(business.description, 2000) || '',
    logo: safeString(business.logo) || null,
    status: safeString(business.status, 20) || 'active',
    address: {
      street: safeString(address.street, 120) || '', number: safeString(address.number, 120) || '',
      city: safeString(address.city, 120) || '', province: safeString(address.province, 120) || '',
      postalCode: safeString(address.postalCode, 120) || '', country: safeString(address.country, 120) || 'Argentina',
    },
    whatsappButtonEnabled: business.whatsappButtonEnabled === true,
    whatsappNumber: business.whatsappButtonEnabled === true ? safeString(business.whatsappNumber, 40) || '' : '',
    socialLinks: Array.isArray(business.socialLinks) ? business.socialLinks.slice(0, 5).map(link => {
      const item = asRecord(link) || {};
      return { id: safeString(item.id, 80) || '', type: safeString(item.type, 20) || 'custom', url: safeString(item.url) || '', title: safeString(item.title, 120) || null };
    }).filter(link => link.id && link.url) : [],
    theme: safeString(business.theme, 20) || 'menta',
    customTheme: customTheme && ['primary', 'background', 'accent'].every(key => typeof customTheme[key] === 'string') ? { primary: customTheme.primary, background: customTheme.background, accent: customTheme.accent } : null,
    location: location && typeof location.lat === 'number' && typeof location.lng === 'number' ? { lat: location.lat, lng: location.lng } : null,
    bookingSettings: {
      autoConfirm: bookingSettings.autoConfirm !== false,
      bookingLeadTimeHours: Number.isInteger(bookingSettings.bookingLeadTimeHours) ? bookingSettings.bookingLeadTimeHours : 2,
      bookingHorizonDays: Number.isInteger(bookingSettings.bookingHorizonDays) ? bookingSettings.bookingHorizonDays : 30,
      appointmentBufferMinutes: Number.isInteger(bookingSettings.appointmentBufferMinutes) ? bookingSettings.appointmentBufferMinutes : 15,
      remindersEnabled: bookingSettings.remindersEnabled === true,
      newAppointmentNotificationsEnabled: bookingSettings.newAppointmentNotificationsEnabled === true,
      notificationEmail: safeString(bookingSettings.notificationEmail, 254) || '',
    },
    membership: {
      type: membership?.type || (planEntitlement.isPro ? 'pro' : 'free'),
      plan: planEntitlement.plan,
      status: planEntitlement.status,
      source: planEntitlement.source,
      monthlyQuota: planEntitlement.monthlyQuota,
      currentMonthUsage: safeNumber(business.currentMonthUsage) ?? 0,
      currentMonthKey: safeString(business.currentMonthKey) ?? null,
      expiresAt: planEntitlement.expiresAt,
      // Only surface a renewal control for the entitlement actually selected
      // by the server. A stale Play record must not make a lifetime/legacy
      // account look as though Play is its billing authority.
      autoRenew: planEntitlement.autoRenew,
    },
    mercadopago: { connected: mercadoPago?.isConnected === true, requireDeposit: canUseOnlineDeposits(business.businessType) && mercadoPago?.requireDeposit === true, depositType: mercadoPago?.depositType === 'percentage' ? 'percentage' : mercadoPago?.depositType === 'fixed' ? 'fixed' : null, depositValue: safeNumber(mercadoPago?.depositValue) || null },
    lastModified: androidDate(business.lastModified),
  };
}

export function androidServiceDto(id: string, service: Record<string, unknown>, zone = BUSINESS_TIME_ZONE) {
  return {
    id,
    name: safeString(service.name, 80) || '',
    duration: Number(service.duration),
    price: Number(service.price),
    status: service.status === 'Activo' ? 'Activo' : 'Pausado',
    photo: safeString(service.photo) || null,
    workingHours: asRecord(service.workingHours) || {},
    unavailableDates: safeArray(service.unavailableDates, value => {
      const instant = androidDate(value);
      return instant ? dateKeyInZone(new Date(instant), zone) : null;
    })?.filter((value): value is string => typeof value === 'string') || [],
    bookingBufferMinutes: service.bookingBufferMinutes === null || Number.isInteger(service.bookingBufferMinutes) ? service.bookingBufferMinutes ?? null : null,
    updatedAt: androidDate(service.updatedAt),
  };
}

export function androidClientDto(id: string, client: Record<string, unknown>) {
  return {
    id,
    name: safeString(client.name, 120) || '',
    phone: safeString(client.phone, 40) || '',
    email: safeString(client.email, 254) || null,
    avatar: safeString(client.avatar) || null,
    lastAppointment: androidDate(client.lastAppointment),
  };
}

export function androidAppointmentDto(id: string, appointment: Record<string, unknown>, zone: string) {
  const date = appointment.date instanceof Timestamp ? appointment.date.toDate()
    : appointment.date && typeof appointment.date === 'object' && typeof (appointment.date as { toDate?: unknown }).toDate === 'function'
      ? (appointment.date as { toDate: () => Date }).toDate() : null;
  return {
    id,
    client: safeString(appointment.client, 120) || '',
    clientId: safeString(appointment.clientId, 128) || null,
    clientPhone: safeString(appointment.clientPhone, 40) || '',
    clientEmail: safeString(appointment.clientEmail, 254) || null,
    service: safeString(appointment.service, 120) || null,
    serviceId: safeString(appointment.serviceId, 128) || null,
    dateKey: date instanceof Date && Number.isFinite(date.getTime()) ? dateKeyInZone(date, zone) : null,
    date: date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    time: safeString(appointment.time, 5) || '',
    durationMinutes: safeNumber(appointment.durationMinutes) || null,
    priceAtBooking: safeNumber(appointment.priceAtBooking) || null,
    status: safeString(appointment.status, 20) || 'Pendiente',
    paymentStatus: safeString(appointment.paymentStatus, 30) || null,
    depositAmount: safeNumber(appointment.depositAmount) || null,
    depositPaid: safeNumber(appointment.depositPaid) || 0,
    paymentReviewRequired: appointment.paymentReviewRequired === true,
    createdAt: androidDate(appointment.createdAt),
    lastModified: androidDate(appointment.lastModified),
  };
}

export function ownerDayBounds(dateKey: string, zone: string) {
  if (!isDateKey(dateKey)) throw new AndroidOwnerApiError(400, 'INVALID_DATE', 'Invalid date');
  const start = localTimeToUtc(dateKey, '00:00', zone);
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(localTimeToUtc(next.toISOString().slice(0, 10), '00:00', zone)) };
}

export function deterministicAndroidRequestId(uid: string, operation: string, key: string) {
  return createHash('sha256').update(`${uid}\0${operation}\0${key}`).digest('hex');
}

export function safeIdempotencyKey(request: Request): string | null {
  const xKey = request.headers.get('x-idempotency-key');
  const standardKey = request.headers.get('idempotency-key');
  if (xKey && standardKey && xKey !== standardKey) {
    throw new AndroidOwnerApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Conflicting idempotency keys');
  }
  const key = xKey || standardKey;
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new AndroidOwnerApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid idempotency key');
  }
  return key;
}
