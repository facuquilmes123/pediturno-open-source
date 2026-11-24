import 'server-only';

import { getAdminFirestore } from '@/lib/firebase-admin';
import webpush from 'web-push';
import { PushPayload } from '@/lib/types';
import { hasActiveBusinessMembership } from '@/lib/server-membership';
import { isCanonicalPushSubscriptionDocument, MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS, normalizePushSubscription } from '@/lib/push-security';

export type PushDeliveryResult = { attempted: number; delivered: number; unavailable?: boolean };

// Configure web-push with VAPID details
if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

export async function sendPushNotification(businessId: string, payload: PushPayload): Promise<PushDeliveryResult> {
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
        console.warn('VAPID keys are not configured. Skipping push notification.');
        return { attempted: 0, delivered: 0, unavailable: true };
    }

    try {
        const db = getAdminFirestore();
        const [business, snapshot] = await Promise.all([
            db.collection('businesses').doc(businessId).get(),
            db.collection('pushSubscriptions').where('userId', '==', businessId).limit(MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS + 1).get(),
        ]);
        if (!business.exists || !hasActiveBusinessMembership(business.data())) return { attempted: 0, delivered: 0 };

        if (snapshot.empty) {
            return { attempted: 0, delivered: 0 };
        }
        let attempted = 0;
        let delivered = 0;
        // The server caps this list at five devices. Send in parallel so one
        // expired/slow device cannot consume the entire upcoming-reminder budget.
        await Promise.all(snapshot.docs.slice(0, MAX_PUSH_SUBSCRIPTIONS_PER_BUSINESS).map(async subDoc => {
            const subscription = normalizePushSubscription(subDoc.get('subscription'));
            if (!subscription) {
                await subDoc.ref.delete().catch(() => undefined);
                return;
            }
            // Legacy random-id rows can still point at a browser endpoint that
            // has since moved to another account. Only the globally unique,
            // endpoint-derived document is eligible for delivery.
            if (!isCanonicalPushSubscriptionDocument(subDoc.id, subscription.endpoint)) {
                await subDoc.ref.delete().catch(() => undefined);
                return;
            }
            attempted += 1;
            try {
                await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 300, timeout: 10_000 });
                delivered += 1;
            } catch (error) {
                const statusCode = (error as { statusCode?: number })?.statusCode;
                if (statusCode === 410 || statusCode === 404) await subDoc.ref.delete().catch(() => undefined);
                console.error('A push notification delivery failed.', { statusCode: statusCode || null });
            }
        }));
        return { attempted, delivered };
    } catch {
        console.error('Push notification delivery failed.');
        return { attempted: 0, delivered: 0, unavailable: true };
    }
}


export async function sendTestPushNotification(businessId: string): Promise<PushDeliveryResult> {
    const payload: PushPayload = {
        title: '¡Notificación de Prueba! 🔔',
        body: 'Si recibiste esto, las notificaciones push están funcionando correctamente.',
        icon: '/logo.webp',
        url: '/dashboard'
    };
    return sendPushNotification(businessId, payload);
}

/** Best-effort owner notification. Keep customer PII out of browser push payloads. */
export async function sendNewBookingPushNotification(businessId: string) {
    return sendPushNotification(businessId, {
        title: 'Nueva reserva en Pediturno',
        body: 'Tenés una nueva reserva. Abrí el panel para ver los detalles.',
        icon: '/logo.webp',
        url: '/dashboard',
    });
}
