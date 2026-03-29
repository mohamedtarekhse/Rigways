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
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Rigways ACM';
  const options = {
    body: payload.body || 'You have a new update.',
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    tag: payload.tag || 'app-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: payload.url || '/notifications.html',
      event_type: payload.event_type || null
    },
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click — open relevant page ─────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  const targetUrl = event.notification?.data?.url || '/notifications.html';
  const fullDestUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    
    // 1. Search for a tab already on this exact page
    for (const client of clients) {
      if (client.url === fullDestUrl) {
        if ('focus' in client) {
          client.postMessage({ type: 'open-url', url: fullDestUrl });
          return client.focus();
        }
      }
    }

    // 2. Search for any tab from our app to reuse
    for (const client of clients) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin) {
        if ('navigate' in client && 'focus' in client) {
          await client.navigate(fullDestUrl);
          client.postMessage({ type: 'open-url', url: fullDestUrl });
          return client.focus();
        }
      }
    }

    // 3. Fallback: Open a new window
    if (self.clients.openWindow) return self.clients.openWindow(fullDestUrl);
    return null;
  })());
});

