import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileGooglePlaySubscriptions } from '@/lib/payments/google-play-membership';
import { reportGooglePlayOperationalIncident } from '@/lib/payments/google-play-alerts';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
function authorized(header: string | null) { const expected = process.env.GOOGLE_PLAY_RECONCILE_SECRET; if (!expected || expected.length < 24 || !header?.startsWith('Bearer ')) return false; const received = Buffer.from(header.slice(7).trim()); const configured = Buffer.from(expected); return received.length === configured.length && timingSafeEqual(received, configured); }
export async function POST(request: Request) { if (!authorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); try { const result = await reconcileGooglePlaySubscriptions(); if (result.failed) await reportGooglePlayOperationalIncident({ kind: 'reconciliation_failed', ...result }); return NextResponse.json(result, { status: result.failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }); } catch { await reportGooglePlayOperationalIncident({ kind: 'reconciliation_unavailable' }); return NextResponse.json({ error: 'Google Play reconciliation unavailable' }, { status: 503 }); } }
export async function GET() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
