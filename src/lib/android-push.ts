import 'server-only';

import { getMessaging } from 'firebase-admin/messaging';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { isBusinessOperational } from '@/lib/server-membership';

export type AndroidPushDeliveryResult = { attempted: number; delivered: number; unavailable?: boolean };
const MAX_ANDROID_DEVICES_PER_BUSINESS = 5;

function invalidToken(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}

/** Sends a generic owner notification only; appointment/customer details remain in the authenticated API. */
export async function sendAndroidNewBookingPushNotification(businessId: string): Promise<AndroidPushDeliveryResult> {
  try {
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(businessId);
    const [business, tokens] = await Promise.all([
      businessRef.get(),
      businessRef.collection('deviceTokens').limit(MAX_ANDROID_DEVICES_PER_BUSINESS + 1).get(),
    ]);
    if (!business.exists || !isBusinessOperational(business.data())) return { attempted: 0, delivered: 0 };
    if (tokens.size > MAX_ANDROID_DEVICES_PER_BUSINESS) return { attempted: 0, delivered: 0, unavailable: true };
    const rows = tokens.docs.filter(row => row.get('platform') === 'android' && typeof row.get('token') === 'string' && row.get('token').length <= 4096);
    let delivered = 0;
    await Promise.all(rows.map(async row => {
      try {
        // The client checks the active Firebase owner before displaying. An OS
        // notification payload would bypass that check while the app is backgrounded.
        await getMessaging().send({ token: row.get('token'), data: { destination: 'agenda', ownerId: businessId }, android: { priority: 'high', ttl: 15 * 60 * 1000 } });
        delivered += 1;
      } catch (cause) {
        if (invalidToken(cause)) await row.ref.delete().catch(() => undefined);
      }
    }));
    return { attempted: rows.length, delivered };
  } catch {
    return { attempted: 0, delivered: 0, unavailable: true };
  }
}
