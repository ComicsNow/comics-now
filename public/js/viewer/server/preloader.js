import { state, global as canonicalGlobal } from '../../globals.js';
import { openClientArchive } from '../../core/archive-extractor.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

function ensureInFlightMap() {
  if (!global.inFlightPageLoads) {
    global.inFlightPageLoads = new Map();
  }
  return global.inFlightPageLoads;
}

function getArchiveOpener() {
  if (typeof global.openClientArchive === 'function') return global.openClientArchive;
  if (typeof openClientArchive === 'function') return openClientArchive;
  return null;
}

async function extractFromArchive(archive, pageName) {
  if (!archive || typeof archive.getPageBlob !== 'function') return null;
  const blob = await archive.getPageBlob(pageName);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  global.pageUrlCache?.set(pageName, url);
  return url;
}

async function extractFromLegacyZip(zip, pageName) {
  const pageFile = zip?.file?.(pageName);
  if (!pageFile) return null;
  const blob = await pageFile.async('blob');
  const url = URL.createObjectURL(blob);
  global.pageUrlCache?.set(pageName, url);
  return url;
}

export async function getPageUrl(pageName) {
  if (!global.currentComic) return null;
  if (global.pageUrlCache?.has(pageName)) {
    return global.pageUrlCache.get(pageName);
  }

  const comicId = global.currentComic.id;

  // 1. Memory-first archive cache check (avoids IndexedDB read on every page turn)
  if (global.currentComicArchiveCache && global.currentComicArchiveCache.id === comicId) {
    if (!global.currentComicArchiveCache.failed && global.currentComicArchiveCache.archive) {
      try {
        const url = await extractFromArchive(global.currentComicArchiveCache.archive, pageName);
        if (url) return url;
      } catch (err) {
        console.error('[VIEWER-SERVER] Cached archive extraction failed:', err);
      }
    }
  } else if (global.currentComicZipCache && global.currentComicZipCache.id === comicId && global.currentComicZipCache.zip) {
    try {
      const url = await extractFromLegacyZip(global.currentComicZipCache.zip, pageName);
      if (url) return url;
    } catch (err) {
      console.error('[VIEWER-SERVER] Cached zip extraction failed:', err);
    }
  } else if (typeof global.getComicFromDB === 'function') {
    // 2. IndexedDB lookup only when not yet cached in memory
    const downloadedComic = await global.getComicFromDB(comicId);
    if (downloadedComic && downloadedComic.fileBlob) {
      const openArchive = getArchiveOpener();
      if (openArchive) {
        try {
          const archive = await openArchive(downloadedComic.fileBlob, global.currentComic.path || downloadedComic.name || '');
          global.currentComicArchiveCache = { id: comicId, archive };
          const url = await extractFromArchive(archive, pageName);
          if (url) return url;
        } catch (err) {
          console.error('[VIEWER-SERVER] Offline archive extraction failed:', err);
          global.currentComicArchiveCache = { id: comicId, failed: true };
        }
      } else if (global.JSZip) {
        try {
          const zip = await new global.JSZip().loadAsync(downloadedComic.fileBlob);
          global.currentComicZipCache = { id: comicId, zip };
          const url = await extractFromLegacyZip(zip, pageName);
          if (url) return url;
        } catch (zipError) {
          console.error('[VIEWER-SERVER] Zip extraction failed for offline comic:', zipError);
          global.currentComicArchiveCache = { id: comicId, failed: true };
        }
      } else {
        console.error('[VIEWER-SERVER] No archive extractor available for offline comic');
      }
    }
  }

  // Fallback to API URL. Request a full-resolution WebP (fmt=webp)
  const url = `${global.API_BASE_URL}/api/v1/comics/pages/image?path=${encodeURIComponent(global.encodePath(global.currentComic.path))}&page=${encodeURIComponent(pageName)}&fmt=webp`;
  global.pageUrlCache?.set(pageName, url);
  return url;
}

export function loadOrGetPageImage(pageUrl) {
  if (!pageUrl) return Promise.reject(new Error('Invalid page URL'));

  const cached = global.preloadedImages?.get(pageUrl);
  if (cached && cached.complete) {
    return Promise.resolve(cached);
  }

  const inFlight = ensureInFlightMap();
  if (inFlight.has(pageUrl)) {
    return inFlight.get(pageUrl).promise;
  }

  const img = new Image();
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => inFlight.delete(pageUrl);
    img.onload = () => {
      global.preloadedImages?.set(pageUrl, img);
      cleanup();
      resolve(img);
    };
    img.onerror = (err) => {
      cleanup();
      reject(err);
    };
  });

  inFlight.set(pageUrl, { img, promise });
  img.src = pageUrl;

  if (img.complete) {
    global.preloadedImages?.set(pageUrl, img);
    inFlight.delete(pageUrl);
    return Promise.resolve(img);
  }

  return promise;
}

export async function prefetchNextComicCover(currentIndex, pages) {
  if (!Array.isArray(pages) || pages.length === 0 || currentIndex < pages.length - 2) return;

  try {
    if (!global.prefetchedNextComicIds) {
      global.prefetchedNextComicIds = new Set();
    }

    let nextComic = null;
    if (global.currentComic?._readingListContext && typeof global.getNextComicInReadingList === 'function') {
      nextComic = await global.getNextComicInReadingList();
    }
    if (!nextComic && typeof global.getNextComicInSeries === 'function') {
      nextComic = await global.getNextComicInSeries();
    }

    if (!nextComic || !nextComic.path || global.prefetchedNextComicIds.has(nextComic.id)) return;
    global.prefetchedNextComicIds.add(nextComic.id);

    const encodeFn = global.encodePath || ((p) => p);
    let firstPage = Array.isArray(nextComic.pages) && nextComic.pages.length > 0 ? nextComic.pages[0] : null;
    if (!firstPage && typeof fetch === 'function') {
      const resp = await fetch(`${global.API_BASE_URL}/api/v1/comics/pages?path=${encodeURIComponent(encodeFn(nextComic.path))}`);
      if (resp.ok) {
        const data = await resp.json();
        firstPage = Array.isArray(data?.pages) && data.pages.length > 0 ? data.pages[0] : null;
      }
    }

    if (firstPage) {
      const nextUrl = `${global.API_BASE_URL}/api/v1/comics/pages/image?path=${encodeURIComponent(encodeFn(nextComic.path))}&page=${encodeURIComponent(firstPage)}&fmt=webp`;
      loadOrGetPageImage(nextUrl).catch(() => {});
    }
  } catch (error) {
    // Silent catch for next-issue prefetch
  }
}

export function preloadPagesWith(currentIndex, pages, getUrlFn = getPageUrl) {
  if (!Array.isArray(pages)) return;

  const start = currentIndex + 1;
  const end = Math.min(pages.length, start + (global.PRELOAD_AHEAD_COUNT || 0));

  for (let i = start; i < end; i++) {
    const pageName = pages[i];
    (async () => {
      try {
        const pageUrl = await getUrlFn(pageName);
        if (pageUrl) {
          await loadOrGetPageImage(pageUrl);
        }
      } catch (error) {
        // Silent catch for preloading
      }
    })();
  }
}

export function preloadPages(currentIndex, pages) {
  if (!Array.isArray(pages)) return;
  preloadPagesWith(currentIndex, pages, getPageUrl);
  if (currentIndex >= pages.length - 2) {
    prefetchNextComicCover(currentIndex, pages);
  }
}

export function prunePreloadedImages(currentIndex, pages) {
  if (!Array.isArray(pages)) return;

  try {
    const urlsToKeep = new Set();
    const pagesToKeep = new Set();
    const PRELOAD_BEHIND_COUNT = global.PRELOAD_BEHIND_COUNT ?? 2;

    const start = Math.max(0, currentIndex - PRELOAD_BEHIND_COUNT);
    const end = Math.min(pages.length, currentIndex + (global.PRELOAD_AHEAD_COUNT || 0) + 1);

    for (let i = start; i < end; i++) {
      const pageName = pages[i];
      pagesToKeep.add(pageName);
      const cachedUrl = global.pageUrlCache?.get(pageName);
      if (cachedUrl) {
        urlsToKeep.add(cachedUrl);
      }
    }

    for (const key of Array.from(global.preloadedImages?.keys?.() || [])) {
      if (!urlsToKeep.has(key)) {
        global.preloadedImages.delete(key);
        if (typeof key === 'string' && key.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
          URL.revokeObjectURL(key);
        }
      }
    }

    for (const [pageName, cachedUrl] of Array.from(global.pageUrlCache?.entries?.() || [])) {
      if (!pagesToKeep.has(pageName)) {
        global.pageUrlCache.delete(pageName);
        if (typeof cachedUrl === 'string' && cachedUrl.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
          URL.revokeObjectURL(cachedUrl);
        }
      }
    }
  } catch (error) {
    // Silent catch
  }
}
