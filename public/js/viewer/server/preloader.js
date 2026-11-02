import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export async function getPageUrl(pageName) {
  if (!global.currentComic) return null;
  if (global.pageUrlCache?.has(pageName)) {
    return global.pageUrlCache.get(pageName);
  }

  let zipData = null;

  // Check for Downloaded Comic in DB (for offline support of server comics)
  if (typeof global.getComicFromDB === 'function') {
    const downloadedComic = await global.getComicFromDB(global.currentComic?.id);
    if (downloadedComic && downloadedComic.fileBlob) {
      zipData = downloadedComic.fileBlob;
    }
  }

  if (zipData) {
    try {
      let zip;
      if (global.currentComicZipCache && global.currentComicZipCache.id === global.currentComic.id) {
        zip = global.currentComicZipCache.zip;
      } else {
        const JSZipCtor = global.JSZip;
        if (!JSZipCtor) {
          console.error('[VIEWER-SERVER] JSZip not found for offline comic');
        } else {
          zip = await new JSZipCtor().loadAsync(zipData);
          global.currentComicZipCache = { id: global.currentComic.id, zip: zip };
        }
      }
      
      if (zip) {
        const pageFile = zip.file(pageName);
        if (pageFile) {
          const blob = await pageFile.async('blob');
          const url = URL.createObjectURL(blob);
          global.pageUrlCache?.set(pageName, url);
          return url;
        }
      }
    } catch (zipError) {
      console.error('[VIEWER-SERVER] Zip extraction failed for offline comic:', zipError);
    }
  }

  // Fallback to API URL. Request a full-resolution WebP (fmt=webp)
  const url = `${global.API_BASE_URL}/api/v1/comics/pages/image?path=${encodeURIComponent(global.encodePath(global.currentComic.path))}&page=${encodeURIComponent(pageName)}&fmt=webp`;
  global.pageUrlCache?.set(pageName, url);
  return url;
}

export function preloadPages(currentIndex, pages) {
  if (!Array.isArray(pages)) return;

  const start = currentIndex + 1;
  const end = Math.min(pages.length, start + (global.PRELOAD_AHEAD_COUNT || 0));

  for (let i = start; i < end; i++) {
    const pageName = pages[i];
    (async () => {
      try {
        const pageUrl = await getPageUrl(pageName);
        if (!global.preloadedImages?.has(pageUrl)) {
          const img = new Image();
          img.src = pageUrl;
          img.onload = () => global.preloadedImages?.set(pageUrl, img);
        }
      } catch (error) {
        // Silent catch for preloading
      }
    })();
  }
}

export function prunePreloadedImages(currentIndex, pages) {
  if (!Array.isArray(pages)) return;

  (async () => {
    try {
      const urlsToKeep = new Set();
      const PRELOAD_BEHIND_COUNT = 5;

      const start = Math.max(0, currentIndex - PRELOAD_BEHIND_COUNT);
      const end = Math.min(pages.length, currentIndex + (global.PRELOAD_AHEAD_COUNT || 0) + 1);

      for (let i = start; i < end; i++) {
        const url = await getPageUrl(pages[i]);
        urlsToKeep.add(url);
      }

      for (const key of Array.from(global.preloadedImages?.keys?.() || [])) {
        if (!urlsToKeep.has(key)) {
          global.preloadedImages.delete(key);
        }
      }
    } catch (error) {
      // Silent catch
    }
  })();
}
