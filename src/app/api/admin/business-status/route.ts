import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getAdminFirestore } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  const auth = await verifyAdminRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { businessId?: unknown; status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (typeof body.businessId !== 'string' || !/^[\w-]{1,128}$/.test(body.businessId) ||
      (body.status !== 'active' && body.status !== 'blocked')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    const ref = getAdminFirestore().collection('businesses').doc(body.businessId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ error: 'Business unavailable' }, { status: 404 });
    await ref.update({ status: body.status });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Update unavailable' }, { status: 503 });
  }
}
