import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { getAdminFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function iso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

export async function GET(request: NextRequest) {
  const auth = await verifyAdminRequest(request);
  if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const snapshot = await getAdminFirestore().collection('businesses').limit(1001).get();
    if (snapshot.size > 1000) return NextResponse.json({ error: 'Too many businesses' }, { status: 503 });
    const businesses = snapshot.docs.map(doc => {
      const data = doc.data();
      const membership = data.membership;
      return {
        id: doc.id,
        email: data.email || '',
        name: data.name || '',
        slug: data.slug || '',
        status: data.status,
        address: data.address || { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' },
        createdAt: iso(data.createdAt),
        lastModified: iso(data.lastModified),
        membership: membership ? {
          type: membership.type,
          startsAt: iso(membership.startsAt),
          expiresAt: iso(membership.expiresAt),
        } : null,
      };
    });
    return NextResponse.json({ businesses }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Business list unavailable' }, { status: 503 });
  }
}
