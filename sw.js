// sw.js — Rigways ACM Service Worker
// Bodyless push strategy:
//   1. Worker sends a zero-byte push (VAPID JWT only — no ECDH).
//   2. This SW wakes up, reads the auth token from IndexedDB,
//      calls /api/notifications to get the latest unread item,
//      then shows it as a browser notification.
//
// Place this file at the repo ROOT (same level as index.html).

const DB_NAME    = 'rigways-sw';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';
const APP_SCOPE  = self.registration.scope.replace(/\/$/, ''); // e.g. https://rigways.pages.dev

// ── IndexedDB helpers ────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE_NAME);
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── Message from page: store the JWT token so SW can use it ─────────
// The page calls: navigator.serviceWorker.controller.postMessage({ type:'SET_TOKEN', token })

self.addEventListener('message', async event => {
  const { type, token } = event.data || {};
  if (type === 'SET_TOKEN' && token) {
    await dbSet('jwt_token', token);
  }
  if (type === 'CLEAR_TOKEN') {
    await dbSet('jwt_token', null);
  }
});

// ── Push received — fetch latest unread notification & display ───────

self.addEventListener('push', event => {
  event.waitUntil(handlePush());
});

async function handlePush() {
  let token;
  try { token = await dbGet('jwt_token'); } catch (e) { token = null; }

  if (!token) {
    // No token — show a generic "you have new alerts" notification
    return self.registration.showNotification('Rigways ACM', {
      body:  'You have new notifications. Open the app to view them.',
      icon:  '/favicon.ico',
      badge: '/favicon.ico',
      tag:   'rigways-generic',
      data:  { url: '/notifications.html' },
    });
  }

  // Fetch the latest unread notification from the API
  let notif = null;
  try {
    const res = await fetch(`${APP_SCOPE}/api/notifications?limit=5&unread=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json   = await res.json();
      const list   = (json.data?.notifications || json.data || []).filter(n => !n.is_read);
      notif        = list[0] || null;
    }
  } catch (e) { /* network error — fall through to generic */ }

  if (notif) {
    const title = notif.title || 'Rigways ACM';
    const body  = notif.body  || 'You have a new notification.';
    const refUrl = notif.ref_type === 'certificate'
      ? `/certificates.html?open=${encodeURIComponent(notif.ref_id || '')}`
      : notif.ref_type === 'asset'
        ? `/assets.html?open=${encodeURIComponent(notif.ref_id || '')}`
        : '/notifications.html';

    return self.registration.showNotification(title, {
      body,
      icon:  '/favicon.ico',
      badge: '/favicon.ico',
      tag:   `rigways-${notif.id}`,
      data:  { url: refUrl, notifId: notif.id },
      requireInteraction: notif.type === 'cert_expiry',
      actions: [
        { action: 'view',    title: 'View' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
      vibrate: [200, 100, 200],
    });
  }

  // Fallback — no unread items found (already read on another device)
  return self.registration.showNotification('Rigways ACM', {
    body:  'You have new activity. Open the app to view it.',
    icon:  '/favicon.ico',
    tag:   'rigways-fallback',
    data:  { url: '/notifications.html' },
  });
}

// ── Notification click ───────────────────────────────────────────────

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetPath = event.notification.data?.url || '/notifications.html';
  const fullUrl    = targetPath.startsWith('http') ? targetPath : `${APP_SCOPE}${targetPath}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (new URL(c.url).pathname === new URL(fullUrl).pathname && 'focus' in c) {
          return c.focus();
        }
      }
      return clients.openWindow(fullUrl);
    })
  );
});

// ── Push subscription change (token refresh / browser rotation) ──────

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(async newSub => {
        const token = await dbGet('jwt_token');
        if (!token) return;
        await fetch(`${APP_SCOPE}/api/push/subscribe`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ endpoint: newSub.endpoint }),
        });
      })
      .catch(err => console.warn('[SW] pushsubscriptionchange resubscribe failed:', err))
  );
});
