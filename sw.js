// sw.js — Rigways ACM Service Worker (Push Notifications)
// Place this file at the ROOT of your project (same level as index.html)
// It must be served from / for full scope coverage.

const CACHE_NAME = 'rigways-acm-v1';
const NOTIFICATION_ICON = '/favicon.ico';
const APP_ORIGIN = self.registration.scope.replace(/\/$/, '');

// ── Install & activate ──────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// ── Push event — show notification ──────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data = { title: 'Rigways ACM', body: event.data ? event.data.text() : 'New notification' };
  }

  const title   = data.title   || 'Rigways ACM';
  const options = {
    body:    data.body    || data.message || 'You have a new notification.',
    icon:    data.icon    || NOTIFICATION_ICON,
    badge:   data.badge   || NOTIFICATION_ICON,
    tag:     data.tag     || 'rigways-default',
    data:    { url: data.url || '/notifications.html' },
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [
      { action: 'view',    title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click — navigate to the target URL ─────────────────
self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = notification.data?.url || '/notifications.html';
  const fullUrl   = targetUrl.startsWith('http') ? targetUrl : APP_ORIGIN + targetUrl;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (new URL(client.url).pathname === new URL(fullUrl).pathname && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});

// ── Push subscription change ─────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  // The subscription expired — try to re-subscribe
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(newSub => {
        // Notify the app to save the new subscription
        return clients.matchAll().then(clientList => {
          clientList.forEach(client => {
            client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: newSub.toJSON() });
          });
        });
      })
      .catch(err => console.warn('pushsubscriptionchange resubscribe failed:', err))
  );
});
