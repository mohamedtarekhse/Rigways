'use strict';

self.addEventListener('push', function(event) {
    let data = event.data ? event.data.json() : {};
    const title = data.title || 'Default Notification Title';
    const options = {
        body: data.body || 'Default notification body',
        icon: data.icon || 'icon.png',
        badge: data.badge || 'badge.png'
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(function(clientList) {
            for (const client of clientList) {
                if (client.url === event.notification.data.url && 'focus' in client)
                    return client.focus();
            }
            if (clients.openWindow)
                return clients.openWindow(event.notification.data.url);
        })
    );
});

self.addEventListener('notificationclose', function(event) {
    console.log('Notification closed', event);
});
