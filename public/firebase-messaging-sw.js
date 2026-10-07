// Handle notification clicks before loading Firebase's click handler.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || data.FCM_MSG?.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(target.href); return client.focus();
      }
    }
    return clients.openWindow?.(target.href);
  }));
});
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');
const params = new URL(self.location.href).searchParams;
const firebaseConfig = Object.fromEntries(['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'].map(key => [key, params.get(key) || '']));
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  // FCM already displays notification messages. Only data-only messages need manual display.
  if (payload.notification) return;
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'Sarıçam GM', {
    body: data.body || 'Yeni bildiriminiz var.', tag: data.tag || `sgm-${data.logId || 'notification'}`,
    requireInteraction: String(data.type || '').includes('İHBAR'), data: { url: data.url || '/' }
  });
});
