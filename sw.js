/* Tracky service worker: instant start from cache, silent update in the background, push notifications */
const VER = 'tracky-v82', SHELL = ['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];
const ABS = u => new URL(u, self.registration.scope).href;

/* store index.html and the app script it points to (script first, so the page never references a missing file) */
async function storeApp(c, res){
  const txt = await res.clone().text(), m = txt.match(/<script[^>]+src="(app\.js[^"]*)"/);
  if (m){
    const url = ABS(m[1]);
    if (!(await c.match(url))){ const r = await fetch(url, {cache: 'reload'}); if (!r.ok) throw new Error('app.js'); await c.put(url, r); }
    (await c.keys()).forEach(k => { if (/\/app\.js/.test(k.url) && k.url !== url) c.delete(k); });
  }
  await c.put(ABS('index.html'), res.clone()); await c.put(ABS('./'), res.clone());
}

self.addEventListener('message', e => { if (e.data && e.data.askVer && e.source) e.source.postMessage({ver: VER}); });
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VER);
    try { await storeApp(c, await fetch(ABS('index.html'), {cache: 'reload'})); } catch (_) {}
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys(), old = ks.filter(k => k.startsWith('tracky-v') && k !== VER);
    await Promise.all(old.map(k => caches.delete(k))); await self.clients.claim();
    if (old.length) (await self.clients.matchAll({type: 'window', includeUncontrolled: true})).forEach(x => x.postMessage({update: true}));   // a new version just took over: tell open pages
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;           // Worker, Gemini, Open Food Facts: never cached
  if (r.mode === 'navigate' && !/\/(?:index\.html)?$/.test(u.pathname)) return;   // other pages and file downloads (download.html, privacy.html, Tracky.apk) go straight to the network
  if (r.mode === 'navigate') {                                              // open instantly from the cache, check for a new version quietly
    e.respondWith((async () => {
      const c = await caches.open(VER), hit = await c.match(ABS('index.html'));
      const keep = hit ? hit.clone() : null;                                // the page consumes `hit`, so compare against this copy
      const check = (async () => {
        try {
          const res = await fetch(ABS('index.html'), {cache: 'no-cache'}); if (!res.ok) return;
          const fresh = await res.clone().text(), old = keep ? await keep.text() : '';
          if (fresh !== old){ await storeApp(c, res); if (hit){ const cl = await self.clients.matchAll({type: 'window', includeUncontrolled: true}); cl.forEach(x => x.postMessage({update: true})); } }
        } catch (_) {}
      })();
      e.waitUntil(check);
      if (hit) return hit;
      try { return await fetch(r); } catch (_) { return (await c.match(ABS('./'))) || Response.error(); }
    })());
    return;
  }
  e.respondWith(caches.match(r).then(hit => {                               // versioned script: cached copy, never re-downloaded; other assets: cached now, refreshed behind
    if (hit && u.search.indexOf('v=') > -1) return hit;
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
