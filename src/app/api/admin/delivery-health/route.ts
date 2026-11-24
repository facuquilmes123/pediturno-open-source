import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getAdminFirestore } from '@/lib/firebase-admin';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const auth = await verifyAdminRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const failed = await getAdminFirestore().collection('bookingEmailOutbox').where('status', '==', 'failed').limit(101).get();
    return NextResponse.json({ failed: Math.min(100, failed.size), more: failed.size > 100 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Delivery health unavailable' }, { status: 503 }); }
}
