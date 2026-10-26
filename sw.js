/* Tracky service worker: works offline, always prefers the newest version, and shows phone notifications. */
const CACHE = 'tracky-v3';
const ASSETS = ['./', 'index.html', 'manifest.json', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tracky-v') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Network first (so updates show immediately), cache as the offline fallback.
   Page loads are always stored under ONE key (index.html), so offline always opens the newest version
   that was loaded online, whichever address (/, /index.html, ?x) opened the app. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => { if (res && res.ok) { const a = res.clone(), b = res.clone(); caches.open(CACHE).then(c => { c.put('index.html', a); c.put('./', b); }); } return res; })
        .catch(() => caches.match('index.html').then(m => m || caches.match('./')))
    );
    return;
  }
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req))
  );
});

/* Push: the server sends an empty push, then we fetch the message text for this device. */
async function sha24(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let n = { title: 'Tracky', body: 'Open Tracky to see your updates.', tag: 'tracky' };
    try {
      const cfg = await (await caches.open('tracky-cfg')).match('cfg');
      const base = cfg ? (await cfg.json()).url : '';
      const sub = await self.registration.pushManager.getSubscription();
      if (base && sub) {
        const r = await fetch(base + '/push/msg?id=' + (await sha24(sub.endpoint)));
        if (r.ok) n = Object.assign(n, await r.json());
      }
    } catch (err) { /* show the generic message */ }
    await self.registration.showNotification(n.title || 'Tracky', {
      body: n.body, tag: n.tag || 'tracky', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(self.registration.scope);
  })());
});
