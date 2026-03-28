// sw.js — Service Worker for Rigways ACM (Optimized)
// Must be at root for maximum scope

const CACHE_NAME = 'rigways-static-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/favicon.ico',
  '/manifest.json'
];

// ── Install — cache core assets ──────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static environment...');
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// ── Activate — cleanup old caches ───────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        );
      })
    ])
  );
});

// ── Fetch — serve cached static assets ──────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Cache-first for core static icons/css/js
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(res => res || fetch(event.request))
    );
  }
});

// ── Push Event — show notification ──────────────────
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Received.');
  let data = { title: 'Rigways ACM', body: 'You have a new notification.', url: '/notifications.html' };

    if (event.data) {
      const rawData = event.data.text();
      console.log('[Service Worker] Push Received. Raw Data:', rawData);
      
      try {
        // Trim whitespace or non-printable chars that might break JSON.parse
        data = JSON.parse(rawData.trim());
      } catch (e) {
        console.warn('[Service Worker] Push data is not valid JSON, using fallback.');
        data = { title: 'Rigways ACM Update', body: rawData };
      }
    }
 else {
    console.error('[Service Worker] Push event contains NO data (this usually means decryption failed at the browser level).');
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
  const fullDestUrl = new URL(urlPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. Search for a tab already on this exact page
      for (const client of clientList) {
        if (client.url === fullDestUrl) {
          if ('focus' in client) return client.focus();
        }
      }

      // 2. Search for a tab from our app (same origin) to reuse
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          if ('navigate' in client && 'focus' in client) {
            client.navigate(fullDestUrl);
            return client.focus();
          }
        }
      }

      // 3. Last fallback: Open a new window
      if (clients.openWindow) {
        return clients.openWindow(fullDestUrl);
      }
    })
  );
});
