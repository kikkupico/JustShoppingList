const CACHE_NAME = 'jsl-v5';
const VENDOR_CACHE = 'jsl-vendor'; // cross-origin modules (esm.sh); never purged on version bump
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './db.js',
  './ocr.js',
  './parser.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      // Keep the current app-shell cache and the vendor cache; drop old shells.
      keys.filter(k => k !== CACHE_NAME && k !== VENDOR_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isVendor = url.origin !== self.location.origin;
  const cacheName = isVendor ? VENDOR_CACHE : CACHE_NAME;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request).then((response) => {
        // Only cache successful, cacheable responses.
        if (response && (response.ok || response.type === 'opaque')) {
          const cacheCopy = response.clone();
          caches.open(cacheName).then((cache) => cache.put(event.request, cacheCopy));
        }
        return response;
      }).catch(() => cached);
      // Cache-first: serve cached immediately, fall back to network.
      return cached || networked;
    })
  );
});
