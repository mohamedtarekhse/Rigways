// sw.js – Service Worker for Rigways ACM
// Handles PWA caching, push notifications, and background sync

const CACHE_NAME = 'rigways-acm-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/assets.html',
  '/certificates.html',
  '/notifications.html',
  '/clients.html',
  '/inspectors.html',
  '/functional-locations.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// ── Install Event — cache core assets ───────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// ── Activate Event — cleanup old caches ─────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch Event — cache-first for static, network-first for others ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip API calls & non-GET
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((networkResponse) => {
        // Cache successful static responses
        if (networkResponse.ok && event.request.destination !== 'document') {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cacheCopy));
        }
        return networkResponse;
      });
    })
  );
});

// ── Push Event — show notification ──────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Rigways Notification', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/notifications.html' },
    tag: data.tag || 'rigways-push',
    renotify: true,
    actions: [
      { action: 'open', title: 'View Details' },
      { action: 'dismiss', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification Click — open relevant page ─────────
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const urlToOpen = notification.data?.url || '/dashboard.html';

  notification.close();

  if (action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      let matchingClient = null;

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        const targetUrl = new URL(urlToOpen, self.location.origin);
        
        if (client.url === targetUrl.href) {
          matchingClient = client;
          break;
        }
        if (clientUrl.origin === targetUrl.origin) {
          matchingClient = client;
        }
      }

      if (matchingClient) {
        return matchingClient.focus().then(c => {
          if (c.url !== new URL(urlToOpen, self.location.origin).href) {
            return c.navigate(urlToOpen);
          }
        });
      }

      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
