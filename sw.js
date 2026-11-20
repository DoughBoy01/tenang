// Tenang service worker. Source file: scripts/build-worker.mjs swaps the placeholder below for a content hash
// so every release gets a fresh cache and old ones are cleaned up.
const VERSION = '__VERSION__';
const SHELL = 'tenang-shell-' + VERSION;
const RUNTIME = 'tenang-runtime-v1'; // Google Fonts: survives app updates
const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/vendor/three.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tenang-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps Refresh on the update banner.
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

// Web Push: the server sends {title, body, url, k}. Browsers (iOS especially) require a visible notification for every push.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Tenang', {
    body: d.body || 'A calm moment is waiting.',
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: d.k || 'tenang',
    actions: d.k ? [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'In 1 hour' }] : [], // shown on Android/desktop; iOS ignores them
    data: { k: d.k || '', url: /^\/#[a-z0-9-]{0,20}$/.test(d.url || '') ? d.url : '/#home' }
  }));
});

const dayStr = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// Notification buttons. "Done" tells the server to skip it for today and leaves a note for the app (which owns the data);
// "In 1 hour" asks the server for a one-off repeat.
async function reminderAction(act, k) {
  const sub = await self.registration.pushManager.getSubscription();
  const end = new Date(); end.setHours(24, 0, 0, 0);
  if (act === 'done') {
    await (await caches.open('tenang-pending')).put('/__pending/done/' + k + '/' + Date.now(), new Response(JSON.stringify({ k, day: dayStr() })));
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'rem-done' });
  }
  if (!sub) return;
  const body = act === 'done' ? { endpoint: sub.endpoint, k, until: end.getTime() } : { endpoint: sub.endpoint, k, minutes: 60 };
  try { await fetch('/api/push/' + act, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (err) {}
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const k = e.notification.data && e.notification.data.k;
  if ((e.action === 'done' || e.action === 'snooze') && k && /^[a-zA-Z0-9]{1,12}$/.test(k)) { e.waitUntil(reminderAction(e.action, k)); return; }
  const url = (e.notification.data && e.notification.data.url) || '/#home';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === location.origin) { await c.focus(); if ('navigate' in c) { try { await c.navigate(url); } catch (err) {} } return; }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: stale-while-revalidate so type works offline after the first visit.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // Page navigations: network first (so updates arrive fast). If the network fails or takes over 4s
  // (weak signal), open the cached app instead.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('/');
      try {
        const net = fetch(req).then(async r => { if (r.ok) (await caches.open(SHELL)).put('/', r.clone()); return r; });
        if (!cached) return await net;
        net.catch(() => {});
        return await Promise.race([net, new Promise((_, no) => setTimeout(no, 4000))]);
      } catch (err) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Everything else on our origin: cache first.
  e.respondWith((async () => (await caches.match(req)) || fetch(req))());
});
