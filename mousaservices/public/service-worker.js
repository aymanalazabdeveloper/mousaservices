const CACHE_NAME = 'mousa-citizen-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/pwa.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title : 'إشعار جديد';
  const body = typeof data.body === 'string' && data.body ? data.body : 'لديك تحديث جديد في منظومة خدمة المواطنين.';
  let target = '/admin.html';
  if (typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) {
    try {
      const parsed = new URL(data.url, self.location.origin);
      if (parsed.origin === self.location.origin) target = parsed.pathname + parsed.search + parsed.hash;
    } catch {}
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: target }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin.html', self.location.origin);
  const safeUrl = target.origin === self.location.origin ? target.href : new URL('/admin.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      if ('navigate' in existing) await existing.navigate(safeUrl);
      return existing.focus();
    }
    return self.clients.openWindow(safeUrl);
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never cache APIs or private/admin pages.
  if (url.pathname.startsWith('/api/') || ['/admin.html', '/users.html', '/setup.html'].includes(url.pathname)) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return Response.error();
    })
  );
});
