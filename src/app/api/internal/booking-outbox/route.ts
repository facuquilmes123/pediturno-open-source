import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { deliverBookingOutbox } from '@/lib/booking-outbox';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.BOOKING_OUTBOX_SECRET;
  if (!hasValidOutboxAuthorization(request.headers.get('authorization'), secret)) return new NextResponse(null, { status: 404 });
  let outboxId: unknown;
  try { outboxId = (await request.json()).outboxId; } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (typeof outboxId !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  try {
    const result = await deliverBookingOutbox(outboxId);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

function hasValidOutboxAuthorization(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
