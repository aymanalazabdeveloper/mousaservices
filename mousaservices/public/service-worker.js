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
