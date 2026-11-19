// BC Dads WAG service worker: opens the app instantly from the phone's copy, and moves phones onto new versions quickly.
importScripts('version.js', 'config.js');
const VERSION = 'bcd-v' + self.APP_VERSION;
const SHELL = ['./', 'index.html', 'version.js', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

// Push notifications: Firebase shows a notification sent with a "notification" payload, even when the app is closed.
if (self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey) {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp(self.FIREBASE_CONFIG);
  firebase.messaging();
}

// cache: 'reload' skips the browser's own HTTP cache (GitHub Pages keeps files ~10 minutes), so a new version never saves an old page.
// skipWaiting + clients.claim: the new version takes over at once instead of waiting for every copy of the app to be closed.
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
// Old versions' saved copies are deleted, so nothing stale is left to load.
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

// The app page itself: try the network first (fresh from GitHub, not the browser cache) so updates show on the next open.
// If the network is slow (over 2.5 s) or offline, the saved copy opens instead and the fresh one is saved for next time.
const isPage = (req, u) => req.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // the Apps Script tracker is never touched
  if (isPage(e.request, u)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = (await c.match('./')) || (await c.match('index.html'));
      const fresh = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put('./', r.clone()); return r; });
      if (!hit) return fresh;
      const slow = new Promise(res => setTimeout(() => res(null), 2500));
      try { const r = await Promise.race([fresh, slow]); if (r && r.ok) return r; } catch (err) {}
      e.waitUntil(fresh.catch(() => {}));
      return hit;
    }));
    return;
  }
  // version.js always comes from the network when it can, so the page and the version number never disagree.
  if (u.pathname.endsWith('/version.js')) {
    e.respondWith(caches.open(VERSION).then(c => fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put('version.js', r.clone()); return r; }).catch(() => c.match('version.js'))));
    return;
  }
  // Everything else (icons, manifest): show the saved copy right away, then fetch a fresh one for next time.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(fresh); return hit; }
    return fresh;
  }));
});

// Tapping a notification opens the app (or brings it to the front).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && (e.notification.data.link || (e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.fcmOptions && e.notification.data.FCM_MSG.fcmOptions.link))) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const w = cs[0]; return w ? w.focus() : self.clients.openWindow(link); }));
});
