/* ================================================================
   UCJC Holy Convocation — Service Worker  (sw.js)
================================================================ */

/* ── OneSignal Web Push SDK (optional import) ────────────────────
   Wrapped in try/catch so a CDN failure or CSP block never crashes
   the entire service worker. If importScripts throws, the SW still
   installs and registers successfully — push notification DISPLAY
   falls back to this file's own 'push' listener below, which shows
   the notification directly and logs it to IndexedDB as before.
   When OneSignal loads successfully it registers its own 'push' and
   'notificationclick' listeners and handles display itself. */
let oneSignalLoaded = false;
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js');
  oneSignalLoaded = true;
} catch (e) {
  console.warn('[SW] OneSignal importScripts failed — using built-in push handler:', e.message);
}

const CACHE_NAME = 'ucjc-convocation-v4';
const PRECACHE   = ['/', '/index.html', '/logo.png', '/map.jpg', '/icon-192.png', '/icon-512.png'];

// ── Install: pre-cache shell assets ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(PRECACHE.map(url => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache ─────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(resp => {
        if (resp.ok && ['document', 'script', 'style', 'image'].includes(event.request.destination)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Message: local reminder scheduling ───────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SCHEDULE_REMINDER') {
    const { title, body, tag, delay = 0, icon = '/icon-192.png' } = event.data;
    const show = () =>
      self.registration.showNotification(title, {
        body, tag, icon, badge: icon,
        requireInteraction: false,
        vibrate: [200, 100, 200]
      });
    delay > 0 ? setTimeout(show, delay) : show();
  }
});

// ── Push: display + log to IndexedDB ─────────────────────────────
//   When OneSignal loaded successfully it handles display itself —
//   this listener only logs to IndexedDB (no showNotification call).
//   When OneSignal failed to load, this listener ALSO shows the
//   notification so pushes still appear even without the CDN script.
self.addEventListener('push', event => {
  if (!event.data) return;
  event.waitUntil(_handlePush(event));
});

async function _handlePush(event) {
  let payload = {};
  try { payload = event.data.json(); } catch (_) {
    // Try parsing as text if JSON fails
    try {
      const text = event.data.text();
      payload = { title: text, body: '' };
    } catch (_) { return; }
  }

  const title =
    payload.title ||
    payload.headings?.en ||
    payload.notification?.title ||
    'UCJC Holy Convocation';
  const body =
    payload.alert ||
    payload.body ||
    payload.contents?.en ||
    payload.notification?.body ||
    payload.message ||
    '';
  const data = payload.custom?.a || payload.data || payload.additionalData || null;
  const type = data?.type || 'announcement';

  // Show the notification ourselves ONLY when OneSignal didn't load
  // (if OneSignal is loaded, its own push listener already handles display)
  if (!oneSignalLoaded) {
    try {
      await self.registration.showNotification(title, {
        body,
        icon:  '/icon-192.png',
        badge: '/icon-192.png',
        data:  { url: data?.url || '/' }
      });
    } catch (_) {}
  }

  // Always log to IndexedDB for the Updates screen history list
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ucjc-onesignal-log', 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('notifications')) {
          const store = d.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true });
          store.createIndex('receivedAt', 'receivedAt');
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('notifications', 'readwrite');
      tx.objectStore('notifications').add({ title, body, type, data, receivedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  } catch (_) {}
}

// ── Notification click ────────────────────────────────────────────
//   When OneSignal loaded, its own listener handles OneSignal pushes.
//   This handler catches local reminders (tag starts with 'reminder-')
//   and, when OneSignal is absent, any push notification click.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const tag    = event.notification?.tag || '';
  const target = event.notification?.data?.url || '/';

  // If OneSignal is loaded, only handle our local reminders here
  if (oneSignalLoaded && !tag.startsWith('reminder-')) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
