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
  'js/utils/device-detection.js',
  'js/offline/db.js',
  'js/jwt-capture.js',
  'js/offline/status.js',
  'js/offline/downloads.js',
  'js/offline.js',
  'js/library/data.js',
  'js/library/smartlists.js',
  'js/library/render.js',
  'js/library.js',
  'js/context-menu/menu-builder.js',
  'js/context-menu/menu-actions.js',
  'js/manga.js',
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
  'js/sync.js',
  'js/auth.js'
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

// ==============================================================================
// BACKGROUND SYNC - DOWNLOAD QUEUE
// ==============================================================================

/**
 * Encode path to base64 (same as encodePath in globals.js)
 * Server expects paths to be base64 encoded
 */
function encodePath(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Open IndexedDB from Service Worker context
 */
async function openDownloadDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('comics-now-offline', 12);

    request.onsuccess = () => {
      console.log('[SW] IndexedDB opened successfully');
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[SW] IndexedDB open error:', request.error);
      reject(request.error);
    };

    request.onupgradeneeded = (event) => {
      console.log('[SW] IndexedDB upgrade not expected in Service Worker');
    };
  });
}

/**
 * Get stored JWT token from IndexedDB
 * @param {IDBDatabase} db - Database instance
 * @returns {Promise<string|null>} JWT token or null
 */
async function getStoredJWT(db) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['settings'], 'readonly');
      const store = tx.objectStore('settings');
      const request = store.get('cf-jwt-token');

      request.onsuccess = () => {
        const result = request.result;
        if (result && result.value) {
          console.log('[SW] JWT token retrieved from IndexedDB');
          resolve(result.value);
        } else {
          console.log('[SW] No JWT token found in IndexedDB');
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('[SW] Error getting JWT token:', request.error);
        resolve(null);
      };
    } catch (error) {
      console.error('[SW] Exception in getStoredJWT:', error);
      resolve(null);
    }
  });
}

/**
 * Get all queue items from IndexedDB
 */
async function getQueueItems(db) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['downloadQueue'], 'readonly');
      const store = tx.objectStore('downloadQueue');
      const index = store.index('priority');
      const request = index.getAll();

      request.onsuccess = () => {
        const items = request.result || [];
        console.log('[SW] Loaded', items.length, 'queue items');
        resolve(items);
      };

      request.onerror = () => {
        console.error('[SW] Error loading queue:', request.error);
        reject(request.error);
      };
    } catch (error) {
      console.error('[SW] Exception in getQueueItems:', error);
      reject(error);
    }
  });
}

/**
 * Update a queue item in IndexedDB
 */
async function updateQueueItem(db, id, updates) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (!item) {
          console.warn('[SW] Queue item not found:', id);
          return resolve();
        }

        Object.assign(item, updates);
        const putRequest = store.put(item);

        putRequest.onsuccess = () => {
          console.log('[SW] Updated queue item:', id);
          resolve();
        };

        putRequest.onerror = () => {
          console.error('[SW] Error updating queue item:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('[SW] Error getting queue item:', getRequest.error);
        reject(getRequest.error);
      };
    } catch (error) {
      console.error('[SW] Exception in updateQueueItem:', error);
      reject(error);
    }
  });
}

/**
 * Remove a queue item from IndexedDB
 */
async function removeQueueItem(db, id) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log('[SW] Removed queue item:', id);
        resolve();
      };

      request.onerror = () => {
        console.error('[SW] Error removing queue item:', request.error);
        reject(request.error);
      };
    } catch (error) {
      console.error('[SW] Exception in removeQueueItem:', error);
      reject(error);
    }
  });
}

/**
 * Save downloaded comic to IndexedDB
 */
async function saveComicBlob(db, comic, blob) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['comics'], 'readwrite');
      const store = tx.objectStore('comics');

      // Get userId from comic or use default
      const userId = comic.userId || 'default-user';

      const comicData = {
        id: comic.id,
        userId: userId,
        comicInfo: comic,
        fileBlob: blob,
        downloadedAt: Date.now()
      };

      const request = store.put(comicData);

      request.onsuccess = () => {
        console.log('[SW] Saved comic to IndexedDB:', comic.id);
        resolve();
      };

      request.onerror = () => {
        console.error('[SW] Error saving comic:', request.error);
        reject(request.error);
      };
    } catch (error) {
      console.error('[SW] Exception in saveComicBlob:', error);
      reject(error);
    }
  });
}

/**
 * Download with progress tracking
 */
async function downloadWithProgress(response, onProgress) {
  const total = parseInt(response.headers.get('Content-Length') || '0');
  const reader = response.body.getReader();
  let received = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.length;

    if (total && onProgress) {
      onProgress(received / total);
    }
  }

  return new Blob(chunks);
}

/**
 * Send message to all clients
 */
async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    console.log('[SW] Notifying', clients.length, 'clients:', message.type);

    clients.forEach(client => {
      try {
        client.postMessage(message);
      } catch (error) {
        console.error('[SW] Error sending message to client:', error);
      }
    });
  } catch (error) {
    console.error('[SW] Error notifying clients:', error);
  }
}

/**
 * Show notification when downloads complete
 */
async function showCompletionNotification(completedCount) {
  if (!self.registration.showNotification) {
    console.log('[SW] Notifications not supported');
    return;
  }

  try {
    await self.registration.showNotification('Comics Downloaded', {
      body: `${completedCount} comic${completedCount > 1 ? 's' : ''} downloaded successfully`,
      icon: `${BASE_PATH}icons/icon-192x192.png`,
      badge: `${BASE_PATH}icons/icon-192x192.png`,
      tag: 'download-complete',
      requireInteraction: false,
      data: { action: 'open-app' }
    });

    console.log('[SW] Showed completion notification');
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

/**
 * Process download queue (Background Sync handler)
 */
async function processDownloadQueue() {
  console.log('[SW] Processing download queue');

  let db;
  try {
    db = await openDownloadDB();
  } catch (error) {
    console.error('[SW] Failed to open IndexedDB:', error);
    return;
  }

  let queue;
  try {
    queue = await getQueueItems(db);
  } catch (error) {
    console.error('[SW] Failed to load queue:', error);
    return;
  }

  // Filter only pending items
  const pendingItems = queue.filter(item => item.status === 'pending');
  console.log('[SW] Found', pendingItems.length, 'pending downloads');

  if (pendingItems.length === 0) {
    console.log('[SW] No pending downloads');
    return;
  }

  let completedCount = 0;

  for (const item of pendingItems) {
    try {
      console.log('[SW] Downloading:', item.comicName);

      // Update status to downloading
      await updateQueueItem(db, item.id, { status: 'downloading', progress: 0 });

      // Notify clients of status change
      await notifyClients({
        type: 'download-status',
        comicId: item.id,
        status: 'downloading'
      });

      // Construct download URL (path must be base64 encoded, then URI encoded)
      const downloadUrl = `${self.location.origin}${BASE_PATH}api/v1/comics/download?path=${encodeURIComponent(encodePath(item.comicPath))}`;

      // Download comic with authentication
      // Note: Cloudflare Access cookies should be sent automatically with credentials: 'include'
      // Service Workers can't access or set cookies directly, so we rely on browser cookie handling
      console.log('[SW] Fetching:', downloadUrl);
      console.log('[SW] Using credentials: include (cookies sent automatically)');

      let response;
      try {
        response = await fetch(downloadUrl, {
          credentials: 'include',
          mode: 'cors',
          cache: 'no-cache'
        });
      } catch (fetchError) {
        console.error('[SW] Fetch error:', fetchError);
        console.error('[SW] This might be a CORS issue or network connectivity problem');
        throw new Error(`Network error: ${fetchError.message}. Try downloading from library instead.`);
      }

      console.log('[SW] Response status:', response.status, response.statusText);

      if (!response.ok) {
        // Handle authentication errors specially
        if (response.status === 401 || response.status === 403) {
          throw new Error('Authentication expired - please reopen app and restart download');
        }
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      // Download with progress tracking
      const blob = await downloadWithProgress(response, async (progress) => {
        await updateQueueItem(db, item.id, { progress });
        await notifyClients({
          type: 'download-progress',
          comicId: item.id,
          progress: progress
        });
      });

      console.log('[SW] Downloaded blob, size:', blob.size);

      // Save to IndexedDB
      await saveComicBlob(db, item.comic, blob);

      // Mark complete and remove from queue after 3 seconds
      await updateQueueItem(db, item.id, {
        status: 'completed',
        progress: 1
      });

      await notifyClients({
        type: 'download-complete',
        comicId: item.id
      });

      completedCount++;
      console.log('[SW] Completed:', item.comicName);

      // Remove from queue
      setTimeout(async () => {
        try {
          const db2 = await openDownloadDB();
          await removeQueueItem(db2, item.id);
        } catch (error) {
          console.error('[SW] Error removing completed item:', error);
        }
      }, 3000);

    } catch (error) {
      console.error('[SW] Download failed:', item.comicName, error);

      try {
        await updateQueueItem(db, item.id, {
          status: 'error',
          error: error.message || 'Download failed'
        });

        await notifyClients({
          type: 'download-error',
          comicId: item.id,
          error: error.message
        });
      } catch (updateError) {
        console.error('[SW] Error updating failed item:', updateError);
      }
    }
  }

  // Show notification if any completed
  if (completedCount > 0) {
    await showCompletionNotification(completedCount);
  }

  console.log('[SW] Queue processing complete, completed:', completedCount);
}

// SYNC EVENT: Handle background sync for downloads
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event received:', event.tag);

  if (event.tag === 'download-comics') {
    event.waitUntil(processDownloadQueue());
  }
});

// NOTIFICATION CLICK: Handle notification interactions
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.notification.data?.action === 'open-app') {
    event.waitUntil(
      clients.openWindow(BASE_PATH || '/')
    );
  }
});
