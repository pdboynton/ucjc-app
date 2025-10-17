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
    icon: "/icons/notification-icon.png" // optional
  });
});

