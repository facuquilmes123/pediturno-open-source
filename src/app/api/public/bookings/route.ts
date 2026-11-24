import { getPediturnoPortalHost } from '@/lib/verticals';
import { markOwnerAgendaChanged } from '@/lib/owner-workspace-server';
import { matchesClientIdentity } from '@/lib/client-identity';
import { createHash } from 'node:crypto';
import { isBusinessOperational } from '@/lib/server-membership';
import { checkAndConsumeAppointmentQuota, AppointmentQuotaExceededError } from '@/lib/appointment-quota';
import { NextRequest, NextResponse } from 'next/server';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { BUSINESS_TIME_ZONE, bookingWeek, dateKeyInZone, isDateKey, isTime, localTimeToUtc, minutes, shiftDateKey } from '@/lib/booking-constraints';
import { createBookingCapability } from '@/lib/booking-capability';
import { createBookingConfirmationOutbox } from '@/lib/booking-outbox';
import { scheduleBookingDelivery } from '@/lib/booking-delivery';
import { bookingSlotIds } from '@/lib/booking-slots';
import { verifyPublicAppCheck } from '@/lib/app-check-server';
import { bookingRateLimits, sameBookingConfiguration } from '@/lib/booking-rate-limit';
import { findSpaceBookingWindow, intervalsOverlap, occupiedInterval } from '@/lib/space-availability';
import { prepareDeposit, ensureDepositCheckout, DEPOSIT_HOLD_MS, type DepositOrder } from '@/lib/payments/deposits';
import { randomUUID } from 'node:crypto';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const dynamic = 'force-dynamic';

type BookingBody = { businessId?: string; serviceId?: string; canchaId?: string; spaceId?: string; durationMinutes?: number; dateKey?: string; time?: string; client?: string; clientPhone?: string; clientEmail?: string; idempotencyKey?: string; };
type ResourceKind = 'service' | 'cancha' | 'space';
type SpacePackage = { durationMinutes?: unknown; price?: unknown };

const response = (message: string, status: number) => NextResponse.json({ error: message }, { status });
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);

function resourceKind(input: BookingBody): ResourceKind | null {
  const selected = [input.serviceId, input.canchaId, input.spaceId].filter(Boolean);
  return selected.length !== 1 ? null : input.spaceId ? 'space' : input.canchaId ? 'cancha' : 'service';
}
function resourceRefFor(db: FirebaseFirestore.Firestore, kind: ResourceKind, id: string) { return db.collection(kind === 'space' ? 'spaces' : kind === 'cancha' ? 'canchas' : 'services').doc(id); }
function resourceMatches(data: Record<string, unknown>, kind: ResourceKind, id: string, name: string): boolean {
  if (kind === 'space') return data.spaceId === id || (!data.spaceId && data.space === name);
  if (kind === 'cancha') return data.canchaId === id || (!data.canchaId && data.cancha === name);
  return !data.canchaId && !data.spaceId && !data.cancha && !data.space;
}
function activeMembership(business: Record<string, any>, now = Date.now()) {
  return isBusinessOperational(business, now);
}
function resourceBuffer(resource: Record<string, unknown>, business: Record<string, any>): number | null {
  const override = resource.bookingBufferMinutes;
  const raw = override === null || override === undefined ? business.bookingSettings?.appointmentBufferMinutes ?? 0 : override;
  return Number.isFinite(Number(raw)) ? Math.max(0, Math.min(240, Math.trunc(Number(raw)))) : null;
}
function spacePackage(resource: Record<string, unknown>, duration: unknown): { durationMinutes: number; price: unknown } | null {
  if (!Number.isInteger(duration)) return null;
  const found = Array.isArray(resource.packages) && resource.packages.find(candidate => candidate && typeof candidate === 'object' && Number((candidate as SpacePackage).durationMinutes) === duration) as SpacePackage | undefined;
  return found && [240, 480, 720, 1440].includes(Number(found.durationMinutes)) && storedBookingPrice(found.price) > 0
    ? { durationMinutes: Number(found.durationMinutes), price: found.price }
    : null;
}
function sameDayFits(resource: Record<string, any>, dateKey: string, time: string, duration: number, kind: ResourceKind): boolean {
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  if (kind === 'space') {
    const window = findSpaceBookingWindow(resource.workingHours, weekday, time, duration);
    return !!window && (!window.isAlternating || bookingWeek(shiftDateKey(dateKey, window.sourceDayOffset)) % 2 === 0);
  }
  const day = resource.workingHours?.[weekday];
  if (!day?.slots || !Array.isArray(day.slots) || day.isAlternating && bookingWeek(dateKey) % 2 !== 0) return false;
  const start = minutes(time);
  return day.slots.some((slot: { start?: unknown; end?: unknown }) => isTime(slot.start) && isTime(slot.end) && start >= minutes(slot.start) && start + duration <= minutes(slot.end));
}
function unavailable(resource: Record<string, any>, dateKey: string, zone: string): boolean {
  return Array.isArray(resource.unavailableDates) && resource.unavailableDates.some((value: Timestamp | Date) => {
    const date = value instanceof Timestamp ? value.toDate() : new Date(value);
    return !Number.isNaN(date.getTime()) && dateKeyInZone(date, zone) === dateKey;
  });
}
function appointmentInterval(data: Record<string, any>, zone: string) {
  const date = data.date instanceof Timestamp ? data.date.toDate() : data.date?.toDate?.();
  if (!(date instanceof Date) || !isTime(data.time)) return null;
  const duration = Number(data.durationMinutes);
  if (!Number.isInteger(duration) || duration < 10 || duration > 1440) return null;
  const start = localTimeToUtc(dateKeyInZone(date, zone), data.time, zone);
  const preparation = Math.max(0, Math.min(240, Number(data.preparationMinutesAtBooking || 0)) || 0);
  const cleanup = Math.max(0, Math.min(240, Number(data.cleanupMinutesAtBooking || 0)) || 0);
  const buffer = Math.max(0, Math.min(240, Number(data.bookingBufferMinutesAtBooking || 0)) || 0);
  return occupiedInterval(start, duration, preparation, cleanup + buffer);
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 4096) return response('Payload too large', 413);
  let input: BookingBody;
  try {
    const value = await readLimitedJson(request, 4096);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return response('Invalid request', 400);
    input = value as BookingBody;
  } catch (error) { return response(error instanceof RequestBodyTooLarge ? 'Payload too large' : 'Invalid request', error instanceof RequestBodyTooLarge ? 413 : 400); }
  const { businessId, serviceId, canchaId, spaceId, durationMinutes, dateKey, time, client, clientPhone, clientEmail, idempotencyKey } = input;
  const kind = resourceKind(input); const resourceId = spaceId || canchaId || serviceId;
  if (!validId(businessId) || !kind || !validId(resourceId) || (kind === 'space' ? !Number.isInteger(durationMinutes) : durationMinutes !== undefined) || !isDateKey(dateKey) || !isTime(time) || typeof client !== 'string' || client.trim().length < 2 || client.length > 120 || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'-]{1,119}$/u.test(client.trim()) || typeof clientPhone !== 'string' || !/^[+\d ()-]{6,40}$/.test(clientPhone.trim()) || clientPhone.replace(/\D/g, '').length < 6 || typeof clientEmail !== 'string' || clientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) || typeof idempotencyKey !== 'string' || !/^[\w-]{16,100}$/.test(idempotencyKey)) return response('Invalid booking details', 400);
  if (!await verifyPublicAppCheck(request, { consume: true })) return response('Request verification failed', 401);
  try {
    const normalizedPhone = normalizeClientPhone(clientPhone); const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(businessId); const resourceRef = resourceRefFor(db, kind, resourceId);
    const [businessSnap, resourceSnap] = await Promise.all([businessRef.get(), resourceRef.get()]);
    const business = businessSnap.data() as Record<string, any> | undefined; const resource = resourceSnap.data() as Record<string, any> | undefined;
    if (!business || !resource || business.status !== 'active' || resource.businessId !== businessId || resource.status !== 'Activo') return response('Booking resource unavailable', 404);
    const allowedMode = kind === 'space' ? business.businessType === 'spaces' : kind === 'cancha' ? ['sports_facility', 'hybrid'].includes(business.businessType) : business.businessType !== 'sports_facility' && business.businessType !== 'spaces';
    if (!allowedMode) return response('Booking resource unavailable', 404);
    if (!activeMembership(business)) return response('Online booking unavailable', 403);
    const now = new Date(); const zone = typeof business.timeZone === 'string' ? business.timeZone : BUSINESS_TIME_ZONE; const start = localTimeToUtc(dateKey, time, zone);
    const lead = Number(business.bookingSettings?.bookingLeadTimeHours ?? 0); const horizon = Number(business.bookingSettings?.bookingHorizonDays ?? 30);
    if (!Number.isFinite(lead) || !Number.isFinite(horizon)) return response('Invalid booking settings', 503);
    if (start.getTime() < now.getTime() + Math.max(0, lead) * 3600000 || start.getTime() > now.getTime() + Math.min(365, Math.max(1, horizon)) * 86400000) return response('Date outside booking window', 400);
    const selectedPackage = kind === 'space' ? spacePackage(resource, durationMinutes) : null;
    const duration = selectedPackage?.durationMinutes ?? (kind === 'cancha' ? Number(resource.duration) : parseInt(String(resource.duration), 10));
    const priceAtBooking = storedBookingPrice(selectedPackage?.price ?? resource.price);
    const deposit = canUseOnlineDeposits(business.businessType) && business.mercadopago?.requireDeposit ? await prepareDeposit(businessId, priceAtBooking, business.mercadopago) : null;
    if (!Number.isInteger(duration) || duration < 10 || duration > 1440) return response('Invalid duration', 400);
    const buffer = resourceBuffer(resource, business); if (buffer === null || kind === 'space' && buffer % 10 !== 0) return response('Invalid booking settings', 503);
    const preparation = kind === 'space' ? Number(resource.preparationMinutes ?? 0) : 0; const cleanup = kind === 'space' ? Number(resource.cleanupMinutes ?? 0) : 0;
    if (!Number.isInteger(preparation) || !Number.isInteger(cleanup) || preparation < 0 || cleanup < 0 || preparation > 240 || cleanup > 240 || kind === 'space' && (preparation % 10 !== 0 || cleanup % 10 !== 0)) return response('Invalid booking settings', 503);
    if (kind === 'space' && minutes(time) % 10 !== 0) return response('Invalid booking details', 400);
    if (!sameDayFits(resource, dateKey, time, duration, kind)) return response('Time outside opening hours', 400);
    const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
    const spaceWindow = kind === 'space' ? findSpaceBookingWindow(resource.workingHours, weekday, time, duration) : null;
    const scheduleDateKey = spaceWindow ? shiftDateKey(dateKey, spaceWindow.sourceDayOffset) : dateKey;
    if (unavailable(resource, dateKey, zone) || scheduleDateKey !== dateKey && unavailable(resource, scheduleDateKey, zone)) return response('Date unavailable', 409);
    const resourceKey = kind === 'space' ? `space_${resourceId}` : kind === 'cancha' ? `cancha_${resourceId}` : 'services';
    const slotIds = bookingSlotIds(businessId, resourceKey, start, duration, cleanup + buffer, preparation, kind === 'space' ? 10 : 5);
    const requestHash = createHash('sha256').update(`${businessId}:${idempotencyKey}`).digest('hex');
    const payloadHash = createHash('sha256').update(JSON.stringify({ businessId, serviceId, canchaId, spaceId, durationMinutes, dateKey, time, client: client.trim(), clientPhone: clientPhone.trim(), clientEmail: clientEmail.trim() })).digest('hex');
    const requestRef = db.collection('bookingRequests').doc(requestHash); const quotas = bookingRateLimits(businessId, clientEmail, clientPhone, now); const quotaRefs = quotas.map(quota => db.collection('bookingRateLimits').doc(quota.id));
    const appointmentRef = db.collection('appointments').doc(); const clientRef = db.collection('clients').doc(clientDocumentId(businessId, normalizedPhone));
    const fallbackClientRef = db.collection('clients').doc();
    const capability = createBookingCapability({ appointmentId: appointmentRef.id, businessId, now, ttlMs: start.getTime() - now.getTime() });
    const confirmationOutbox = createBookingConfirmationOutbox({ appointmentId: appointmentRef.id, businessId, token: capability.token, capabilityExpiresAt: capability.capability.expiresAt, notifyBusiness: true });
    const outboxRef = db.collection('bookingEmailOutbox').doc();
    const depositRef = deposit ? db.collection('depositOrders').doc(createHash('sha256').update(`deposit:${requestHash}`).digest('base64url')) : null;
    const paymentExpiresAt = new Date(Math.min(now.getTime() + DEPOSIT_HOLD_MS, start.getTime()));
    const midnight = localTimeToUtc(dateKey, '00:00', zone); const lower = Timestamp.fromDate(new Date(midnight.getTime() - 48 * 3600000)); const upper = Timestamp.fromDate(new Date(midnight.getTime() + 48 * 3600000));
    const legacyQuery = db.collection('appointments').where('businessId', '==', businessId).where('date', '>=', lower).where('date', '<', upper).limit(1000);
    const clientByNormalizedPhone = db.collection('clients').where('businessId', '==', businessId).where('phone', '==', normalizedPhone).limit(2);
    const clientBySubmittedPhone = clientPhone.trim() === normalizedPhone ? null : db.collection('clients').where('businessId', '==', businessId).where('phone', '==', clientPhone.trim()).limit(2);
    const targetInterval = occupiedInterval(start, duration, preparation, cleanup + buffer);
    const result = await db.runTransaction(async transaction => {
      const [requestSnap, oldAppointments, currentBusinessSnap, currentResourceSnap, deterministicClient, normalizedClients, submittedClients] = await Promise.all([transaction.get(requestRef), transaction.get(legacyQuery), transaction.get(businessRef), transaction.get(resourceRef), transaction.get(clientRef), transaction.get(clientByNormalizedPhone), clientBySubmittedPhone ? transaction.get(clientBySubmittedPhone) : Promise.resolve(null)]);
      if (requestSnap.exists) { if (requestSnap.get('payloadHash') !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT'); return { id: requestSnap.get('appointmentId') as string, outboxId: requestSnap.get('outboxId') as string | undefined, depositOrderId: requestSnap.get('depositOrderId') as string | undefined, repeated: true }; }
      const quotaSnapshots = await Promise.all(quotaRefs.map(ref => transaction.get(ref)));
      if (quotas.some((quota, index) => quotaSnapshots[index].get('window') === quota.window && Number(quotaSnapshots[index].get('count') || 0) >= quota.limit)) throw new Error('RATE_LIMITED');
      const currentBusiness = currentBusinessSnap.data() as Record<string, any> | undefined; const currentResource = currentResourceSnap.data() as Record<string, any> | undefined;
      if (!currentBusiness || !currentResource || !activeMembership(currentBusiness) || currentBusiness.status !== 'active' || currentResource.businessId !== businessId || currentResource.status !== 'Activo' || !sameBookingConfiguration(business, currentBusiness) || !sameBookingConfiguration(resource, currentResource)) throw new Error('RESOURCE_CHANGED');
      if (oldAppointments.size === 1000) throw new Error('TOO_MANY_APPOINTMENTS');
      for (const existing of oldAppointments.docs) { const data = existing.data(); if (data.status === 'Cancelado' || !resourceMatches(data, kind, resourceId, String(resource.name || ''))) continue; const interval = appointmentInterval(data, zone); if (interval && intervalsOverlap(targetInterval, interval)) throw new Error('SLOT_TAKEN'); }
      const candidates = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      if (matchesClientIdentity(deterministicClient.data(), businessId, normalizedPhone)) candidates.set(deterministicClient.id, deterministicClient);
      for (const candidate of normalizedClients.docs) if (candidate.get('businessId') === businessId && candidate.get('phone') === normalizedPhone) candidates.set(candidate.id, candidate);
      for (const candidate of submittedClients?.docs || []) if (candidate.get('businessId') === businessId && candidate.get('phone') === clientPhone.trim()) candidates.set(candidate.id, candidate);
      if (candidates.size > 1) throw new Error('DUPLICATE_CLIENTS');
      const existingClient = candidates.values().next().value as FirebaseFirestore.DocumentSnapshot | undefined;
      await checkAndConsumeAppointmentQuota(transaction, db, businessId, currentBusiness, dateKey, zone);
      const targetClientRef = existingClient?.ref || (deterministicClient.exists ? fallbackClientRef : clientRef); const clientId = targetClientRef.id;
      const clientUpdate: { name: string; phone: string; lastAppointment: Timestamp; email?: string } = { name: client.trim(), phone: normalizedPhone, lastAppointment: latestAppointment(existingClient, midnight) }; if (clientEmail.trim()) clientUpdate.email = clientEmail.trim(); if (existingClient) transaction.update(existingClient.ref, clientUpdate); else transaction.set(targetClientRef, { businessId, avatar: '', ...clientUpdate });
      const status = business.bookingSettings?.autoConfirm === false ? 'Pendiente' : 'Confirmado';
      markOwnerAgendaChanged(transaction, db, businessId); transaction.create(appointmentRef, { businessId,
        bookingPortalHost: getPediturnoPortalHost(request.headers.get('host') ?? new URL(request.url).hostname), client: client.trim(), clientPhone: clientPhone.trim(), clientEmail: clientEmail.trim(), clientId, ...(kind === 'service' ? { service: resource.name, serviceId } : {}), ...(kind === 'cancha' ? { cancha: resource.name, canchaId } : {}), ...(kind === 'space' ? { space: resource.name, spaceId, spaceCategory: resource.category } : {}), date: Timestamp.fromDate(midnight), time, durationMinutes: duration, priceAtBooking, bookingSlotIds: slotIds, status: deposit ? 'Pendiente' : status, ...(depositRef && deposit ? { paymentStatus: 'pending', depositOrderId: depositRef.id, depositAmount: deposit.amount, paymentExpiresAt: Timestamp.fromDate(paymentExpiresAt) } : {}), bookingBufferMinutesAtBooking: buffer, ...(kind === 'space' ? { preparationMinutesAtBooking: preparation, cleanupMinutesAtBooking: cleanup } : {}), occupiedStartAt: Timestamp.fromDate(targetInterval.start), occupiedEndAt: Timestamp.fromDate(targetInterval.end), avatar: '', createdAt: Timestamp.now() });
      transaction.update(resourceRef, { bookingRevision: FieldValue.increment(1) }); transaction.create(db.collection('bookingCapabilities').doc(capability.tokenHash), capability.capability); transaction.create(outboxRef, { ...confirmationOutbox, ...(deposit ? { status: 'awaiting_payment' } : {}) }); if (depositRef && deposit) transaction.create(depositRef, { kind: 'deposit', businessId, appointmentId: appointmentRef.id, ...deposit, currency: 'ARS', status: 'pending', createdAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromDate(paymentExpiresAt), preferenceCreateKey: randomUUID(), targetStatus: status, outboxId: outboxRef.id } satisfies DepositOrder); for (const slotId of slotIds) transaction.create(db.collection('bookingSlots').doc(slotId), { businessId, appointmentId: appointmentRef.id }); transaction.create(requestRef, { businessId, appointmentId: appointmentRef.id, outboxId: outboxRef.id, ...(depositRef ? { depositOrderId: depositRef.id } : {}), payloadHash, createdAt: Timestamp.now() }); quotas.forEach((quota, index) => transaction.set(quotaRefs[index], { businessId, window: quota.window, count: (quotaSnapshots[index].get('window') === quota.window ? Number(quotaSnapshots[index].get('count') || 0) : 0) + 1, updatedAt: Timestamp.now() })); return { id: appointmentRef.id, outboxId: outboxRef.id, depositOrderId: depositRef?.id, repeated: false };
    });
    if (!result.depositOrderId) scheduleBookingDelivery(result.outboxId);
    let checkoutUrl: string | null = null;
    if (result.depositOrderId) {
      try { checkoutUrl = await ensureDepositCheckout(result.depositOrderId); } catch { /* The recoverable order remains on the payment page. */ }
    }
    return NextResponse.json({ id: result.id, repeated: result.repeated, ...(result.depositOrderId ? { depositOrderId: result.depositOrderId, checkoutUrl, paymentUrl: `https://pediturno.com/pago/${result.depositOrderId}` } : {}) }, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof AppointmentQuotaExceededError) return response('El negocio no tiene turnos disponibles para este mes en su plan actual.', 409);
    if ((cause as { code?: number })?.code === 5 || cause instanceof Error && cause.message === 'RESOURCE_CHANGED') return response('La disponibilidad cambió. Actualizá los horarios.', 409);
    if (cause instanceof Error && cause.message === 'RATE_LIMITED') return response('Demasiadas reservas. Intentá más tarde o contactá al negocio.', 429);
    if (cause instanceof Error && cause.message === 'SLOT_TAKEN') return response('Slot already booked', 409);
    if ((cause as { code?: number | string })?.code === 6 || (cause as { code?: number | string })?.code === 'already-exists') return response('Slot already booked', 409);
    if (cause instanceof Error && cause.message === 'IDEMPOTENCY_CONFLICT') return response('Idempotency key reused for different details', 409);
    if (cause instanceof Error && cause.message === 'DUPLICATE_CLIENTS') return response('Hay clientes duplicados con ese teléfono. Revisá el directorio antes de reservar.', 409);
    return response('Booking unavailable', 503);
  }
}

function storedBookingPrice(value: unknown): number { const amount = Number(String(value ?? '').trim().replace(',', '.')); return Number.isFinite(amount) && amount >= 0 ? amount : 0; }
function normalizeClientPhone(value: string): string { return value.replace(/\D/g, ''); }
function clientDocumentId(businessId: string, normalizedPhone: string) { return createHash('sha256').update(`${businessId}\0client\0${normalizedPhone}`).digest('hex'); }
function latestAppointment(client: { get?: (field: string) => unknown } | undefined, candidate: Date) { const stored = client?.get?.('lastAppointment'); const previous = stored instanceof Timestamp ? stored.toDate() : stored instanceof Date ? stored : stored && typeof (stored as { toDate?: unknown }).toDate === 'function' ? (stored as { toDate: () => Date }).toDate() : null; return Timestamp.fromDate(previous instanceof Date && Number.isFinite(previous.getTime()) && previous > candidate ? previous : candidate); }
