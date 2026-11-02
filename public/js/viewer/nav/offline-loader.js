import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const IMAGE_FILE_REGEX = /\.(jpg|jpeg|png|gif|webp)$/i;
const MAC_OS_RESOURCE_PREFIX = '__MACOSX';

function normalizePagesResponse(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.pages)) return data.pages;
  return [];
}

async function loadOfflineComicPages(comic) {
  if (!comic) {
    return [];
  }

  try {
    let zipData = null;

    // Try local file handle or File object (Device Library) first
    if (comic.handle) {
      try {
        zipData = await comic.handle.getFile();
      } catch (handleError) {
        console.error('[DEVICE] Failed to get file from handle:', handleError);
      }
    } else if (comic.file) {
      zipData = comic.file;
    }

    // Fallback to IndexedDB (Downloaded comics)
    if (!zipData && typeof global.getComicFromDB === 'function') {
      const record = await global.getComicFromDB(comic.id);
      if (record && record.fileBlob) {
        zipData = record.fileBlob;
      }
    }

    if (!zipData) {
      return [];
    }

    const JSZipCtor = global.JSZip;
    if (!JSZipCtor) {
      return [];
    }

    const zip = await new JSZipCtor().loadAsync(zipData);
    const pageNames = Object.keys(zip.files)
      .filter(name => {
        const entry = zip.files[name];
        if (!entry || entry.dir) return false;
        if (name.startsWith(MAC_OS_RESOURCE_PREFIX)) return false;
        return IMAGE_FILE_REGEX.test(name);
      })
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    // If we're loading from a local handle, we might not have a downloadedComicIds set yet
    if (!global.downloadedComicIds) {
      global.downloadedComicIds = new Set();
    }

    // If it's a device library comic, we mark it as "downloaded" so the viewer
    // knows to use local extraction logic for pages.
    if (comic.handle || comic.file || (typeof Blob !== 'undefined' && zipData instanceof Blob)) {
      global.downloadedComicIds.add(comic.id);
    }

    if (global.currentComic) {
      if (!global.currentComic.progress) {
        global.currentComic.progress = {};
      }
      if (typeof global.currentComic.progress.totalPages !== 'number' && pageNames.length > 0) {
        global.currentComic.progress.totalPages = pageNames.length;
      }
    }

    return pageNames;
  } catch (error) {
    console.error('[OFFLINE] Error loading local pages:', error);
    return [];
  }
}

export {
  IMAGE_FILE_REGEX,
  MAC_OS_RESOURCE_PREFIX,
  normalizePagesResponse,
  loadOfflineComicPages
};
