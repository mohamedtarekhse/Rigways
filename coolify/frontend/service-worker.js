// service-worker.js — Service Worker for push notifications

const CACHE_NAME = 'rigways-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  self.clients.claim();
});

// Push event — handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('Push received:', event);

  let title = 'Rigways Notification';
  let options = {
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'rigways-push',
    requireInteraction: true,
  };

  // Parse push event data
  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      options = {
        ...options,
        body: payload.body || 'New notification',
        icon: payload.icon || options.icon,
        data: payload.data || {},
      };
    } catch (error) {
      console.error('Failed to parse push payload:', error);
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.notification);
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/notifications.html';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // Check if app is already open
      for (let i = 0; i < clientList.length; i++) {
        if (clientList[i].url === urlToOpen && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      // Open new window if not already open
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification);
});
