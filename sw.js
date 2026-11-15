/* Tracky service worker: offline cache + phone push notifications */
const VER = 'tracky-v30', SHELL = ['./', 'index.html', 'manifest.json', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tracky-v') && k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;           // Worker, Gemini, Open Food Facts: never cached
  if (r.mode === 'navigate') {                                              // page: network first, fall back to the cached copy offline
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(VER).then(c => c.put('index.html', cp)); return res; }).catch(() => caches.match('index.html').then(m => m || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(r).then(hit => {                               // assets: cached copy now, refresh in the background
    const net = fetch(r).then(res => { if (res && res.ok) { const cp = res.clone(); caches.open(VER).then(c => c.put(r, cp)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { try { d = {body: e.data.text()}; } catch (__) {} }
  e.waitUntil(self.registration.showNotification(d.title || 'Tracky', {body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag || 'tracky', renotify: false, data: {go: d.go || 'home'}}));
});

self.addEventListener('notificationclick', e => {
  e.notification.close(); const go = (e.notification.data && e.notification.data.go) || 'home';
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if ('focus' in c) { c.postMessage({go}); return c.focus(); }
    return self.clients.openWindow('./?go=' + encodeURIComponent(go));
  }));
});

/* the browser rotated the push subscription: register the new one with the server */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const cfg = await (await (await caches.open('tracky-cfg')).match('cfg')).json(); if (!cfg || !cfg.url) return;
      const key = (await (await fetch(cfg.url + '/vapid')).json()).publicKey, pad = '='.repeat((4 - key.length % 4) % 4);
      const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/')), app = Uint8Array.from(raw, c => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: app});
      await fetch(cfg.url + '/push/subscribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sub: sub.toJSON(), id: cfg.id, state: {}})});
    } catch (_) {}
  })());
});
