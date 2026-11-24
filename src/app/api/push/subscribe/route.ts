
import { NextResponse, NextRequest } from 'next/server';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { isBusinessOperational } from '@/lib/server-membership';
import {
    MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS,
    isAllowedPushEndpoint,
    normalizePushSubscription,
    pushSubscriptionId,
} from '@/lib/push-security';

const MAX_BODY_BYTES = 8192;

function response(body: Record<string, unknown>, status: number) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authenticatedUser(request: NextRequest): Promise<string | null> {
    const authHeader = request.headers.get('authorization');
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!idToken) return null;
    initializeAdminApp();
    return (await getAuth().verifyIdToken(idToken, true)).uid;
}

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
    try {
        const raw = await request.text();
        if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export async function POST(request: NextRequest) {
    try {
        const uid = await authenticatedUser(request);
        if (!uid) return response({ error: 'Unauthorized' }, 401);
        const input = await body(request);
        const subscription = normalizePushSubscription(input?.subscription);
        if (!subscription) return response({ error: 'Invalid subscription' }, 400);
        const db = getAdminFirestore();
        const subscriptions = db.collection('pushSubscriptions');
        const subscriptionRef = subscriptions.doc(pushSubscriptionId(subscription.endpoint));
        await db.runTransaction(async transaction => {
            const [business, sameEndpoint, owned] = await Promise.all([
                transaction.get(db.collection('businesses').doc(uid)),
                transaction.get(subscriptions.where('subscription.endpoint', '==', subscription.endpoint).limit(10)),
                transaction.get(subscriptions.where('userId', '==', uid).limit(MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS + 1)),
            ]);
            if (!business.exists || !isBusinessOperational(business.data())) throw new Error('MEMBERSHIP_REQUIRED');
            const ownedOtherEndpoints = owned.docs.filter(document => document.get('subscription.endpoint') !== subscription.endpoint);
            if (ownedOtherEndpoints.length >= MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS) throw new Error('SUBSCRIPTION_LIMIT');
            sameEndpoint.docs.forEach(document => {
                if (document.ref.path !== subscriptionRef.path) transaction.delete(document.ref);
            });
            transaction.set(subscriptionRef, {
                userId: uid,
                subscription,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });
        return response({ success: true }, 200);
    } catch (error) {
        if (error instanceof Error && error.message === 'MEMBERSHIP_REQUIRED') return response({ error: 'Active membership required' }, 403);
        if (error instanceof Error && error.message === 'SUBSCRIPTION_LIMIT') return response({ error: 'Subscription limit reached' }, 409);
        console.error('Push subscription rejected or failed');
        return response({ error: 'Invalid session or subscription.' }, 401);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const uid = await authenticatedUser(request);
        if (!uid) return response({ error: 'Unauthorized' }, 401);
        const input = await body(request);
        const endpoint = input?.endpoint;
        if (!isAllowedPushEndpoint(endpoint)) return response({ error: 'Invalid subscription' }, 400);
        const db = getAdminFirestore();
        const subscriptions = db.collection('pushSubscriptions');
        await db.runTransaction(async transaction => {
            const matches = await transaction.get(subscriptions.where('subscription.endpoint', '==', endpoint).limit(10));
            matches.docs.forEach(document => {
                if (document.get('userId') === uid) transaction.delete(document.ref);
            });
        });
        return response({ success: true }, 200);
    } catch {
        return response({ error: 'Unable to remove subscription' }, 503);
    }
}
