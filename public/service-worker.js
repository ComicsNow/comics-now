// service-worker.js
// PWA service worker that respects subpath deployment (e.g., /comics-home)

const SCOPE_URL = new URL(self.registration.scope);
const BASE_PATH = SCOPE_URL.pathname;
const CACHE_VERSION = 'v4.8';
const CACHE_NAME = `comics-now-${CACHE_VERSION}-${BASE_PATH}`;

// Assets relative to the scope. DO NOT start with "/" (root) here.
const ASSET_PATHS = [
  'index.html',
  'app.js',
  'style.css',
  'tailwind.css',
  'jszip.min.js',
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'js/globals.js',
  'js/offline/db.js',
  'js/offline/status.js',
  'js/offline/downloads.js',
  'js/offline.js',
  'js/library/data.js',
  'js/library/smartlists.js',
  'js/library/render.js',
  'js/library.js',
  'js/metadata.js',
  'js/viewer/fullscreen.js',
  'js/viewer/navigation.js',
  'js/viewer/ui.js',
  'js/viewer.js',
  'js/settings.js',
  'js/comictagger.js',
  'js/events.js',
  'js/comicvine.js',
  'js/progress.js',
  'js/sync.js'
];

// Build absolute URLs for caching within this scope
const ASSET_URLS = ASSET_PATHS.map(p => new URL(p, self.registration.scope).toString());

// Helper: is this request for our own origin & inside our scope?
function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(BASE_PATH);
}

// Helper: is this an API request? (network-first)
function isApi(url) {
  return isInScope(url) && url.pathname.includes('/api/');
}

// INSTALL: pre-cache core assets with better error handling
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return Promise.allSettled(
          ASSET_URLS.map(url => cache.add(url).catch(() => {}))
        );
      })
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ACTIVATE: clean old caches for other base paths/versions
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('comics-now-') && n !== CACHE_NAME)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// FETCH: cache-first for static assets; network-first for API; fallback to cached index.html for navigations
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GETs inside our own scope
  if (req.method !== 'GET') return;
  if (!isInScope(url)) return;

  // DOWNLOAD BYPASS: Let browser handle downloads directly
  if (url.pathname.includes('/download')) {
    return;
  }

  // API: network-first with offline JSON fallback
  if (isApi(url)) {
    event.respondWith((async () => {
      try {
        return await fetch(req, { cache: 'no-store' });
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(req);
        return match || new Response('{"offline":true}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // Navigations (HTML): network-first, fallback to cached app shell
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        return await fetch(req, { cache: 'no-store' });
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(new URL('index.html', self.registration.scope).toString());
        if (shell) return shell;
        return new Response('Offline - No cached app available', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Static assets inside scope: network-first for JS (to get updates), cache-first for other assets
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // For JavaScript files, always try network first to get updates
    if (url.pathname.endsWith('.js')) {
      try {
        const net = await fetch(req, { cache: 'no-store' });
        if (net.ok) {
          cache.put(req, net.clone());
        }
        return net;
      } catch (err) {
        // Fallback to cache when offline
        const hit = await cache.match(req);
        if (hit) return hit;
        return new Response('Offline - Asset not cached', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/javascript' }
        });
      }
    }

    // For other static assets (CSS, images): cache-first
    const hit = await cache.match(req);
    if (hit) return hit;

    try {
      const net = await fetch(req);
      if (net.ok && url.origin === self.location.origin) {
        cache.put(req, net.clone());
      }
      return net;
    } catch (err) {
      // For critical assets, try alternative cache keys
      if (url.pathname.endsWith('.css')) {
        const cacheKeys = await cache.keys();
        for (const key of cacheKeys) {
          const keyUrl = new URL(key.url);
          if (keyUrl.pathname === url.pathname) {
            const cachedResponse = await cache.match(key);
            if (cachedResponse) return cachedResponse;
          }
        }
      }

      return new Response('Offline - Asset not cached', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});
