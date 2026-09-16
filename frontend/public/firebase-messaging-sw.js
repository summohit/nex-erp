/*
 * The background half of web push.
 *
 * A notification that arrives while the tab is closed — or backgrounded, or on
 * another tab — is delivered to this worker, not to the app. Without it "your
 * shift starts in 10 minutes" only ever reaches someone already looking at the
 * page, which is the one person who does not need it.
 *
 * CONFIG COMES FROM THE QUERY STRING
 *
 * A service worker cannot read Angular's environment. The usual workaround is
 * to paste the Firebase config in here too, which leaves two copies to drift
 * apart — and a mismatched sender id fails silently, with notifications simply
 * never arriving. Instead PushNotificationsService registers this file with the
 * config appended to the URL, so environment.ts stays the single source.
 *
 * compat builds are used deliberately: importScripts cannot load ES modules in
 * a classic worker, and this file has to remain plain JS served from the web
 * root, outside the Angular build.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

if (config.projectId && config.messagingSenderId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'NEX ERP';
    self.registration.showNotification(title, {
      body: payload.notification?.body || '',
      icon: '/icon.png',
      badge: '/icon.png',
      // Collapse repeats of the same thing. Three shift reminders in ten
      // minutes should replace each other in the tray, not stack up.
      tag: payload.data?.type || 'nex-erp',
      renotify: true,
      data: { linkUrl: payload.data?.linkUrl || '/' },
    });
  });
}

/*
 * Focus the tab that is already open rather than launching a second one — the
 * app holds a websocket and in-memory state, and a duplicate tab throws both
 * away for no reason.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.linkUrl || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
