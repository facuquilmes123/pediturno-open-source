import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { initializeAdminApp } from '@/lib/firebase-admin';
import { sendTestPushNotification } from '@/services/push';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { isBusinessOperational } from '@/lib/server-membership';

const TEST_INTERVAL_MS = 60_000;

export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    initializeAdminApp();
    const decoded = await getAuth().verifyIdToken(token, true);
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(decoded.uid);
    const quotaRef = db.collection('pushTestRateLimits').doc(decoded.uid);
    await db.runTransaction(async transaction => {
      const [business, quota] = await Promise.all([transaction.get(businessRef), transaction.get(quotaRef)]);
      if (!business.exists || !isBusinessOperational(business.data())) throw new Error('MEMBERSHIP_REQUIRED');
      const lastSentAt = quota.get('lastSentAt');
      if (lastSentAt instanceof Timestamp && lastSentAt.toMillis() > Date.now() - TEST_INTERVAL_MS) throw new Error('RATE_LIMITED');
      transaction.set(quotaRef, { businessId: decoded.uid, lastSentAt: FieldValue.serverTimestamp() });
    });
    const delivery = await sendTestPushNotification(decoded.uid);
    if (delivery.unavailable) return NextResponse.json({ error: 'Push service unavailable' }, { status: 503 });
    if (delivery.attempted === 0) return NextResponse.json({ error: 'No push subscription is registered' }, { status: 409 });
    if (delivery.delivered === 0) return NextResponse.json({ error: 'Push notification could not be delivered' }, { status: 503 });
    return NextResponse.json({ success: true, delivered: delivery.delivered });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'MEMBERSHIP_REQUIRED') return NextResponse.json({ error: 'Active membership required' }, { status: 403 });
    if (cause instanceof Error && cause.message === 'RATE_LIMITED') return NextResponse.json({ error: 'Try again later' }, { status: 429 });
    return NextResponse.json({ error: 'Notification unavailable' }, { status: 503 });
  }
}
