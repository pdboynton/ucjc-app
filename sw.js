/* ================================================================
   UCJC Holy Convocation — Service Worker  (sw.js)
   Place this file in the SAME folder as index.html
================================================================ */

/* ── OneSignal Web Push SDK v5 (merged into this custom SW) ───────
   OneSignal's recommended pattern for apps with their own service
   worker is to importScripts() their worker file at the top of your
   own file, rather than maintaining two separate SW files. This SW
   is referenced from the main app's OneSignal.init() call via:
     serviceWorkerPath: 'sw.js', serviceWorkerParam: { scope: '/' }
   OneSignal's imported script registers its OWN 'push' and
   'notificationclick' listeners internally — do not add a duplicate
   custom 'push' handler below, or notifications may render twice. */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js');

const CACHE_NAME = 'ucjc-convocation-v3';
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
        if (resp.ok && ['document', 'script', 'style', 'image'].includes(event.request.destination)) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Message: handle LOCAL reminder scheduling from the main thread ──
//   This is separate from OneSignal push delivery — these are
//   client-side timers for bookmarked-event reminders, set via
//   scheduleReminder() in index.html. The main app posts:
//   { type:'SCHEDULE_REMINDER', title, body, tag, delay }
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

// ── Push: capture into local history log (does NOT call showNotification) ──
//   OneSignal's own imported script (importScripts above) already displays
//   the notification — this listener must NOT call showNotification() again,
//   or the user would see the same push rendered twice. It only persists a
//   lightweight record to IndexedDB so the main app's Home "Latest Update"
//   and Updates screen "Recent Updates" sections can read a local history
//   without needing a server-side OneSignal REST API call (which would
//   require exposing a secret API key in client code — a security risk
//   this app deliberately avoids).
//
//   NOTE: OneSignal's raw web-push payload shape is not a fully stable
//   public contract and can vary by SDK version, so this parses several
//   known field-name variants defensively rather than assuming one exact
//   shape.
self.addEventListener('push', event => {
  if (!event.data) return;
  event.waitUntil(_logPushToHistory(event));
});

async function _logPushToHistory(event) {
  let payload = {};
  try { payload = event.data.json(); } catch (_) { return; }

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
  } catch (_) {
    // Non-fatal — OneSignal's own listener has already displayed the
    // notification regardless of whether this local log write succeeds.
  }
}

// ── Notification click: LOCAL REMINDERS ONLY ──────────────────────
//   OneSignal's imported script (above) already registers its own
//   'notificationclick' listener that handles clicks on OneSignal-
//   sourced push notifications. Multiple listeners on the same event
//   are allowed, so this handler only acts on notifications tagged by
//   our own local reminder system (tag starts with 'reminder-') and
//   ignores everything else, avoiding any double-handling.
self.addEventListener('notificationclick', event => {
  const tag = event.notification?.tag || '';
  if (!tag.startsWith('reminder-')) return; // not ours — let OneSignal handle it

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
