import { state } from '../../globals.js';
import { updateDeviceScanProgress } from './progress.js';

export const DEVICE_LIBRARIES_STORE = 'deviceLibraries';
export const DEVICE_COMICS_STORE = 'deviceComics';
export const DEVICE_LIB_COUNT_KEY = 'comics-now-device-library-count';

function syncDeviceLibraryCount(count) {
  const normalized = Math.max(0, Number(count) || 0);
  state.deviceLibraryCount = normalized;
  if (typeof window !== 'undefined') window.deviceLibraryCount = normalized;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DEVICE_LIB_COUNT_KEY, String(normalized));
    } catch (_) {}
  }
}

function getOfflineDb() {
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (!db.openOfflineDB) throw new Error('OfflineDB not initialized');
  return db.openOfflineDB();
}

export async function toPersistentBlob(fileObj) {
  if (!fileObj) return null;
  try {
    if (typeof fileObj.arrayBuffer === 'function' && typeof Blob !== 'undefined') {
      const buf = await fileObj.arrayBuffer();
      return new Blob([buf], { type: fileObj.type || 'application/octet-stream' });
    }
  } catch (_) {}
  return fileObj;
}

/**
 * Find an existing device library ID by folder name (case-insensitive)
 */
export async function findExistingLibraryIdByName(name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return null;
  const libs = await getDeviceLibraries();
  const match = libs.find(l => String(l.name || '').trim().toLowerCase() === norm);
  return match ? match.id : null;
}

/**
 * Save legacy device library with persistent IndexedDB Blobs
 */
export async function saveLegacyDeviceLibrary(id, name, files, onProgress) {
  const existingId = await findExistingLibraryIdByName(name);
  const targetId = existingId || id;
  const activeDb = await getOfflineDb();
  const report = (info) => {
    updateDeviceScanProgress(targetId, name, info);
    if (typeof onProgress === 'function') onProgress(info);
  };

  const libraryEntry = {
    id: targetId,
    name: name,
    isLegacy: true,
    addedAt: Date.now()
  };

  report({ status: 'scanning', current: 0, total: files.length });

  const comics = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    report({ status: 'scanning', current: i + 1, total: files.length, fileName: file.name });
    const persistedBlob = await toPersistentBlob(file);
    const relPath = file.webkitRelativePath || file.name;
    comics.push({
      id: `${targetId}:${relPath}`,
      libraryId: targetId,
      name: file.name,
      path: relPath,
      file: persistedBlob,
      isLegacy: true,
      addedAt: Date.now()
    });
  }

  const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');
  tx.objectStore(DEVICE_LIBRARIES_STORE).put(libraryEntry);
  const comicStore = tx.objectStore(DEVICE_COMICS_STORE);
  for (const comic of comics) {
    comicStore.put(comic);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      syncDeviceLibraryCount(Math.max(1, Number(state.deviceLibraryCount) || 1));
      report({ status: 'ready', current: comics.length, total: comics.length });
      resolve(targetId);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Save device library root to IndexedDB (reusing existing ID if folder name matches)
 */
export async function saveDeviceLibrary(id, handle) {
  const existingId = await findExistingLibraryIdByName(handle?.name);
  const targetId = existingId || id;
  const activeDb = await getOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE], 'readwrite');
    const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
    const request = store.put({
      id: targetId,
      name: handle.name,
      handle: handle,
      addedAt: Date.now()
    });
    request.onsuccess = () => {
      syncDeviceLibraryCount(Math.max(1, Number(state.deviceLibraryCount) || 1));
      resolve(targetId);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Scan a device library for CBZ/CBR files and persist their Blobs into IndexedDB
 */
export async function scanDeviceLibrary(libraryId, directoryHandle, onProgress) {
  const libName = directoryHandle?.name || 'Local Library';
  console.log(`Scanning device library: ${libName}`);
  const report = (info) => {
    updateDeviceScanProgress(libraryId, libName, info);
    if (typeof onProgress === 'function') onProgress(info);
  };

  report({ status: 'scanning', current: 0, total: 0 });

  const foundEntries = [];
  async function walk(handle, relativePath = '') {
    for await (const entry of handle.values()) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, path);
      } else if (entry.kind === 'file') {
        if (entry.name.toLowerCase().endsWith('.cbz') || entry.name.toLowerCase().endsWith('.cbr')) {
          foundEntries.push({ entry, path });
        }
      }
    }
  }

  await walk(directoryHandle);
  console.log(`Found ${foundEntries.length} local comics`);

  const comics = [];
  for (let i = 0; i < foundEntries.length; i++) {
    const { entry, path } = foundEntries[i];
    report({ status: 'scanning', current: i + 1, total: foundEntries.length, fileName: entry.name });
    let persistedBlob = null;
    try {
      if (typeof entry.getFile === 'function') {
        const rawFile = await entry.getFile();
        persistedBlob = await toPersistentBlob(rawFile);
      }
    } catch (_) {}
    comics.push({
      id: `${libraryId}:${path}`,
      libraryId: libraryId,
      name: entry.name,
      path: path,
      handle: entry,
      file: persistedBlob,
      addedAt: Date.now()
    });
  }

  const activeDb = await getOfflineDb();
  const tx = activeDb.transaction([DEVICE_COMICS_STORE], 'readwrite');
  const store = tx.objectStore(DEVICE_COMICS_STORE);

  for (const comic of comics) {
    store.put(comic);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      report({ status: 'ready', current: comics.length, total: comics.length });
      resolve(comics);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all device libraries (automatically deduplicating same-named folders)
 */
export async function getDeviceLibraries() {
  const activeDb = await getOfflineDb();
  if (!activeDb.objectStoreNames.contains(DEVICE_LIBRARIES_STORE)) {
    syncDeviceLibraryCount(0);
    return [];
  }

  const allLibs = await new Promise((resolve, reject) => {
    const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE], 'readonly');
    const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  if (allLibs.length <= 1) {
    syncDeviceLibraryCount(allLibs.length);
    return allLibs;
  }

  // Sort newest first so we keep the newest entry per folder name
  const sorted = [...allLibs].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const kept = [];
  const duplicateIds = [];
  const seenNames = new Set();

  for (const lib of sorted) {
    const key = String(lib.name || lib.id || '').trim().toLowerCase();
    if (seenNames.has(key)) {
      duplicateIds.push(lib.id);
    } else {
      seenNames.add(key);
      kept.push(lib);
    }
  }

  if (duplicateIds.length > 0) {
    try {
      const cleanTx = activeDb.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');
      const libStore = cleanTx.objectStore(DEVICE_LIBRARIES_STORE);
      for (const dupId of duplicateIds) {
        libStore.delete(dupId);
      }
    } catch (_) {}
  }

  syncDeviceLibraryCount(kept.length);
  return kept;
}

/**
 * Get all comics for a device library
 */
export async function getDeviceComics(libraryId) {
  const activeDb = await getOfflineDb();
  if (!activeDb.objectStoreNames.contains(DEVICE_COMICS_STORE)) return [];

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction([DEVICE_COMICS_STORE], 'readonly');
    const store = tx.objectStore(DEVICE_COMICS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const allComics = request.result || [];
      resolve(allComics.filter(c => c.libraryId === libraryId));
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a device library and its cached comic entries
 */
export async function removeDeviceLibrary(libraryId) {
  const activeDb = await getOfflineDb();
  const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');

  tx.objectStore(DEVICE_LIBRARIES_STORE).delete(libraryId);

  const comicsStore = tx.objectStore(DEVICE_COMICS_STORE);
  const request = comicsStore.getAll();
  request.onsuccess = () => {
    const allComics = request.result || [];
    for (const comic of allComics) {
      if (comic.libraryId === libraryId) {
        comicsStore.delete(comic.id);
      }
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = async () => {
      try {
        await getDeviceLibraries();
      } catch (_) {}
      const showRootFolderList = state.showRootFolderList || (typeof window !== 'undefined' ? window.showRootFolderList : null);
      const applyFilterAndRender = state.applyFilterAndRender || (typeof window !== 'undefined' ? window.applyFilterAndRender : null);

      if (typeof showRootFolderList === 'function') {
        showRootFolderList({ force: true });
      } else if (typeof applyFilterAndRender === 'function') {
        applyFilterAndRender();
      }
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
