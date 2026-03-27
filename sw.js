// sw.js — Service Worker for Rigways ACM Push Notifications
// Must be at root for maximum scope

// ── Push Event — show notification ──────────────────
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  let data = { title: 'Rigways ACM', body: 'You have a new notification.', url: '/notifications.html' };

  if (event.data) {
    try {
      const json = event.data.json();
      console.log('[Service Worker] Push Data:', json);
      data = { ...data, ...json };
    } catch (e) {
      console.log('[Service Worker] Push Text:', event.data.text());
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'rigways-notification',
    data: { url: data.url || '/notifications.html' },
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification Click — open relevant page ─────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlPath = event.notification.data?.url || '/notifications.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing tab if open
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === urlPath || clientUrl.pathname.endsWith(urlPath)) {
          client.focus();
          return client.navigate(client.url);
        }
      }
      // Open new tab
      const fullUrl = new URL(urlPath, self.location.origin).href;
      return clients.openWindow(fullUrl);
    })
  );
});

// ── Activate — claim control immediately ────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Install — skip waiting ──────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
