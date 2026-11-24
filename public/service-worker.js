'use strict';

self.resolvePediturnoUrl = function (url) {
    try {
        const resolvedUrl = new URL(url || '/', self.location.origin);
        return resolvedUrl.origin === self.location.origin ? resolvedUrl.href : new URL('/', self.location.origin).href;
    } catch (error) {
        return new URL('/', self.location.origin).href;
    }
};

self.addEventListener('push', function (event) {
    let data = {};
    if (event.data) {
        try {
            data = JSON.parse(event.data.text());
        } catch (e) {
            data = {
                title: 'Notificación',
                body: event.data.text(),
            };
        }
    }

    const title = data.title || 'Pediturno Online';
    const options = {
        tag: typeof data.tag === 'string' ? data.tag : undefined,
        body: data.body || 'Tienes una nueva notificación.',
        icon: data.icon || '/logo.webp',
        badge: '/badge.png',
        vibrate: [200, 100, 200],
        data: {
            url: self.resolvePediturnoUrl(data.url),
        },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
    console.log('[Service Worker] Notification click Received.');

    event.notification.close();

    const urlToOpen = self.resolvePediturnoUrl(event.notification && event.notification.data && event.notification.data.url);

    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        }).then(function (clientList) {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
