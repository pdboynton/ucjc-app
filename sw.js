/* ================================================================
   UCJC Holy Convocation — Service Worker  (sw.js)
   Place this file in the SAME folder as index.html
================================================================ */

const CACHE_NAME = 'ucjc-convocation-v2';
const PRECACHE   = ['/', '/index.html', '/logo.png', '/map.jpg', '/icon-192.png', '/icon-512.png'];

// NOTE: Venue map images are stored in IndexedDB (not the SW cache) by the
// MapDB module in index.html. They are automatically available offline
// because IndexedDB persists across page loads and browser restarts.
// The SW therefore does not need to intercept or cache OSM tile requests —
// map generation runs once, the result is saved to IDB, and subsequent loads
// read from IDB instantly without any network request.

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
  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(resp => {
        // Cache successful HTML/JS/CSS/image responses
        if (resp.ok && ['document','script','style','image'].includes(event.request.destination)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Message: handle reminder scheduling from the main thread ─────
//   The main app posts: { type:'SCHEDULE_REMINDER', title, body, tag, delay }
//   We show the notification after `delay` ms (default 0 = immediately).
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

// ── Push: receive server-sent push notifications (FCM/WebPush) ───
//   Payload format (JSON string in push.data):
//   { title: string, body: string, type: string, url?: string }
self.addEventListener('push', event => {
  let payload = { title: '📢 UCJC', body: 'New announcement', tag: 'push-notif' };
  try { payload = { ...payload, ...event.data.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:  payload.body,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   payload.tag || 'push-notif',
      data:  { url: payload.url || '/' },
      requireInteraction: payload.type === 'urgent'
    })
  );
});

// ── Notification click: focus or open the app ────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
