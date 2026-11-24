import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const enabled = process.env.MP_PAYMENTS_ENABLED === 'true'
    && Boolean(process.env.MP_ACCESS_TOKEN?.trim())
    && Boolean(process.env.MP_WEBHOOK_SECRET?.trim())
    && /^\d{1,32}$/.test(process.env.MP_PLATFORM_APPLICATION_ID?.trim() ?? '');

  return NextResponse.json({ enabled }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
