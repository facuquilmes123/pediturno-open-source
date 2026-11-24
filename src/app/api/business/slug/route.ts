import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { normalizeSlug } from '@/lib/business-profile';

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const slug = normalizeSlug(request.nextUrl.searchParams.get('slug'));
  if (!token) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 });
  try {
    initializeAdminApp();
    const { uid } = await getAuth().verifyIdToken(token, true);
    const snapshot = await getAdminFirestore().collection('publicBusinesses').doc(slug).get();
    return NextResponse.json({ available: !snapshot.exists || snapshot.get('businessId') === uid }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to check slug' }, { status: 401 });
  }
}
