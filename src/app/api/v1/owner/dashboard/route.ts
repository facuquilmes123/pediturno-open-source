import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { parseStoredPrice } from '@/lib/dashboard-stats';
import { androidAppointmentDto, androidError, isDocumentId, ownerTimeZone, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';
import { dateKeyInZone, localTimeToUtc } from '@/lib/booking-constraints';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PAGE = 500;
type Fallback = { serviceId: string | null; serviceName: string | null; count: number };

function asDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const result = (value as { toDate: () => Date }).toDate();
    return result instanceof Date && Number.isFinite(result.getTime()) ? result : null;
  }
  return null;
}

function monthBounds(zone: string, now: Date) {
  const monthKey = dateKeyInZone(now, zone).slice(0, 7);
  const [year, month] = monthKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { monthKey, start: Timestamp.fromDate(localTimeToUtc(`${monthKey}-01`, '00:00', zone)), end: Timestamp.fromDate(localTimeToUtc(nextKey, '00:00', zone)) };
}

async function fallbackPrices(owner: Awaited<ReturnType<typeof requireAndroidOwner>>, fallbacks: Fallback[]) {
  const ids = new Set(fallbacks.map(item => item.serviceId).filter((value): value is string => !!value && isDocumentId(value)));
  const names = new Set(fallbacks.map(item => item.serviceName).filter((value): value is string => !!value));
  const byId = new Map<string, number>(); const byName = new Map<string, number>();
  await Promise.all([...ids].map(async id => {
    const row = await owner.db.collection('services').doc(id).get();
    if (row.exists && row.get('businessId') === owner.uid) {
      const price = parseStoredPrice(row.get('price')); byId.set(id, price);
      if (typeof row.get('name') === 'string' && !byName.has(row.get('name'))) byName.set(row.get('name'), price);
    }
  }));
  // Legacy appointments can lack a service id. Read only service metadata and
  // paginate it; client/contact data never leaves Firestore for this summary.
  if (names.size) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      let query = owner.db.collection('services').where('businessId', '==', owner.uid).orderBy(FieldPath.documentId()).limit(PAGE);
      if (cursor) query = query.startAfter(cursor) as typeof query;
      const rows = await query.get();
      for (const row of rows.docs) if (typeof row.get('name') === 'string' && names.has(row.get('name')) && !byName.has(row.get('name'))) byName.set(row.get('name'), parseStoredPrice(row.get('price')));
      if (rows.size < PAGE) break;
      cursor = rows.docs.at(-1);
    }
  }
  return { byId, byName };
}

async function monthlyRevenue(owner: Awaited<ReturnType<typeof requireAndroidOwner>>, zone: string, now: Date) {
  const { monthKey, start, end } = monthBounds(zone, now);
  let monthlyRevenue = 0;
  // Do not retain an appointment list merely to add it up. Legacy fallback
  // references are coalesced so a long month remains bounded by services, not
  // by appointment volume.
  const fallbackCounts = new Map<string, Fallback>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = owner.db.collection('appointments').where('businessId', '==', owner.uid).where('status', '==', 'Completado')
      .where('date', '>=', start).where('date', '<', end).orderBy('date', 'asc').orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const rows = await query.get();
    for (const row of rows.docs) {
      const price = row.get('priceAtBooking');
      if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
        monthlyRevenue += price;
      } else {
        const serviceId = typeof row.get('serviceId') === 'string' ? row.get('serviceId') : null;
        const serviceName = typeof row.get('service') === 'string' ? row.get('service') : null;
        const key = `${serviceId || ''}\u0000${serviceName || ''}`;
        const existing = fallbackCounts.get(key);
        if (existing) existing.count += 1;
        else fallbackCounts.set(key, { serviceId, serviceName, count: 1 });
      }
    }
    if (rows.size < PAGE) break;
    cursor = rows.docs.at(-1);
  }
  const fallbacks = [...fallbackCounts.values()];
  const prices = await fallbackPrices(owner, fallbacks);
  for (const fallback of fallbacks) {
    const price = fallback.serviceId && prices.byId.has(fallback.serviceId)
      ? prices.byId.get(fallback.serviceId)!
      : fallback.serviceName ? prices.byName.get(fallback.serviceName) || 0 : 0;
    monthlyRevenue += price * fallback.count;
  }
  return { monthKey, monthlyRevenue };
}

async function earliestUpcoming(owner: Awaited<ReturnType<typeof requireAndroidOwner>>, zone: string, todayStart: Timestamp) {
  const base = owner.db.collection('appointments').where('businessId', '==', owner.uid)
    .where('status', 'in', ['Confirmado', 'Pendiente']).where('date', '>=', todayStart);
  const upcomingAppointmentsCount = (await base.count().get()).data().count;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let earliestDateKey: string | null = null; const sameDay: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  while (true) {
    let query = base.orderBy('date', 'asc').orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const rows = await query.get();
    if (rows.empty) break;
    for (const row of rows.docs) {
      const date = asDate(row.get('date'));
      if (!date) continue;
      const key = dateKeyInZone(date, zone);
      if (earliestDateKey === null) earliestDateKey = key;
      if (key === earliestDateKey) sameDay.push(row);
    }
    const lastDate = asDate(rows.docs.at(-1)?.get('date'));
    if (!lastDate || earliestDateKey === null || dateKeyInZone(lastDate, zone) !== earliestDateKey || rows.size < PAGE) break;
    cursor = rows.docs.at(-1);
  }
  return {
    upcomingAppointmentsCount,
    upcomingAppointments: sameDay
      .map(row => androidAppointmentDto(row.id, row.data(), zone))
      .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
      .slice(0, 5),
  };
}

export async function GET(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request);
    const decision = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!decision.allowed) return ownerReadRateLimitResponse(decision);
    const zone = ownerTimeZone(owner.business); const now = new Date();
    const todayStart = Timestamp.fromDate(localTimeToUtc(dateKeyInZone(now, zone), '00:00', zone));
    const [clients, revenue, upcoming] = await Promise.all([
      owner.db.collection('clients').where('businessId', '==', owner.uid).count().get(),
      monthlyRevenue(owner, zone, now),
      earliestUpcoming(owner, zone, todayStart),
    ]);
    return NextResponse.json({
      monthKey: revenue.monthKey, timeZone: zone, totalClients: clients.data().count,
      monthlyRevenue: revenue.monthlyRevenue, ...upcoming,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Dashboard unavailable', 503, 'DASHBOARD_UNAVAILABLE');
  }
}
