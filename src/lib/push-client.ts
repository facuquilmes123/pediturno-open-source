

'use client';

import { auth } from '@/lib/firebase';
import { isIosDevice, isInstalled } from '@/lib/pwa-install';

export function pushReadiness(): 'ready' | 'install-ios' | 'unsupported' | 'unconfigured' {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIosDevice() && !isInstalled()) return 'install-ios';
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? 'ready' : 'unconfigured';
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  if (registration.active) return registration;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Service worker not ready')), 10_000);
    navigator.serviceWorker.ready.then(ready => { window.clearTimeout(timeout); resolve(ready); }, reject);
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function associateSubscription(userId: string, subscription: PushSubscription): Promise<boolean> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.uid !== userId) return false;
  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ subscription }),
  });
  return response.ok;
}

function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

async function removeServerAssociation(userId: string, endpoint: string): Promise<void> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.uid !== userId) return;
  const token = await currentUser.getIdToken();
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

// Re-associate an existing browser endpoint with the current account without prompting.
export async function initializePushNotifications(userId: string): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported in this browser.');
    return;
  }

  try {
    const swRegistration = await activeRegistration();
    let subscription = await swRegistration.pushManager.getSubscription();
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (subscription && vapidPublicKey) {
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      if (!sameApplicationServerKey(subscription, applicationServerKey)) {
        await removeServerAssociation(userId, subscription.endpoint);
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
        if (window.Notification.permission === 'granted') {
          subscription = await swRegistration.pushManager.subscribe({ applicationServerKey, userVisibleOnly: true });
        }
      }
    }
    if (!subscription && vapidPublicKey && 'Notification' in window && window.Notification.permission === 'granted') {
      subscription = await swRegistration.pushManager.subscribe({ applicationServerKey: urlBase64ToUint8Array(vapidPublicKey), userVisibleOnly: true });
    }
    if (subscription && !await associateSubscription(userId, subscription)) await subscription.unsubscribe().catch(() => false);
  } catch {
    console.error('No se pudo sincronizar la suscripción push.');
  }
}

// This new function handles the full subscription flow and is called by the UI banner.
export async function requestPermissionAndSubscribe(userId: string): Promise<boolean> {
     if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push notifications are not supported.');
        return false;
    }

    try {
        if (!('Notification' in window) || !auth?.currentUser || auth.currentUser.uid !== userId || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false;
        // Call synchronously from the user's tap, before registration/network awaits (iOS).
        const permission = await window.Notification.requestPermission();

        if (permission !== 'granted') {
            console.warn('Permission for notifications was not granted.');
            return false;
        }

        const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
            console.error('VAPID public key is not defined.');
            return false;
        }
        const swRegistration = await activeRegistration();

        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        const options = {
            applicationServerKey,
            userVisibleOnly: true,
        };

        let subscription = await swRegistration.pushManager.getSubscription();
        if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
            await removeServerAssociation(userId, subscription.endpoint);
            await subscription.unsubscribe().catch(() => false);
            subscription = null;
        }
        subscription ??= await swRegistration.pushManager.subscribe(options);
        if (!auth?.currentUser || auth.currentUser.uid !== userId) {
            console.error('La sesión de usuario cambió antes de registrar las notificaciones.');
            await subscription.unsubscribe().catch(() => false);
            return false;
        }
        if (!await associateSubscription(userId, subscription)) {
            console.error('No se pudo asociar la suscripción push a esta cuenta.');
            await subscription.unsubscribe().catch(() => false);
            return false;
        }
        return true;

    } catch(error) {
        console.error('Error requesting permission or subscribing:', error);
        return false;
    }
}

export async function unsubscribePushNotifications(userId: string): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/service-worker.js').catch(() => undefined);
  const subscription = registration ? await registration.pushManager.getSubscription().catch(() => null) : null;
  if (!subscription) return;
  try {
    const currentUser = auth?.currentUser;
    if (currentUser?.uid === userId) {
      await removeServerAssociation(userId, subscription.endpoint);
    }
  } catch {
    // A revoked/expired identity must never prevent local logout.
  } finally {
    // Invalidating the browser endpoint prevents stale server state from
    // delivering data after this account leaves the device.
    await subscription.unsubscribe().catch(() => false);
  }
}
