// Push Notifications (Firebase + Manual Fallback)
self.addEventListener("push", function (event) {
  const data = event.data?.json();

  if (data) {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/icons/notification-icon.png"
      })
    );

    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: "firebase-notification", data });
      });
    });
  }
});

// Offline Caching (PWA Core Assets)
const CACHE_NAME = "ucjc-cache-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/viewer.js",
  "/pdf.worker.umd.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/program-book.pdf",
  "/manifest.json"
];

// Cache core assets on install
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Serve cached assets on fetch
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

// Firebase Setup for Background Messaging
importScripts("https://www.gstatic.com/firebasejs/10.5.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.5.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDV34G66jQ58MBPBJq3MfmhZF8mOdifVqg",
  authDomain: "ucjcconvocation.firebaseapp.com",
  projectId: "ucjcconvocation",
  storageBucket: "ucjcconvocation.firebasestorage.app",
  messagingSenderId: "698752970791",
  appId: "1:698752970791:web:0ae1b0094858609579de02",
  measurementId: "G-0M5WBTR83N"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: "/icons/notification-icon.png"
  });

  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type: "firebase-notification", data: payload.notification });
    });
  });
});
