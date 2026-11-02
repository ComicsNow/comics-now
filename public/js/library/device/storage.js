import { state } from '../../globals.js';

export const DEVICE_LIBRARIES_STORE = 'deviceLibraries';
export const DEVICE_COMICS_STORE = 'deviceComics';

function getOfflineDb() {
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (!db.openOfflineDB) throw new Error('OfflineDB not initialized');
  return db.openOfflineDB();
}

/**
 * Save legacy device library (no persistent handles)
 */
export async function saveLegacyDeviceLibrary(id, name, files) {
  const activeDb = await getOfflineDb();

  const libraryEntry = {
    id: id,
    name: name,
    isLegacy: true,
    addedAt: Date.now()
  };

  const comics = files.map(file => ({
    id: `${id}:${file.webkitRelativePath || file.name}`,
    libraryId: id,
    name: file.name,
    path: file.webkitRelativePath || file.name,
    file: file,
    isLegacy: true,
    addedAt: Date.now()
  }));

  const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE, DEVICE_COMICS_STORE], 'readwrite');
  tx.objectStore(DEVICE_LIBRARIES_STORE).put(libraryEntry);
  const comicStore = tx.objectStore(DEVICE_COMICS_STORE);
  for (const comic of comics) {
    comicStore.put(comic);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Save device library root to IndexedDB
 */
export async function saveDeviceLibrary(id, handle) {
  const activeDb = await getOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE], 'readwrite');
    const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
    const request = store.put({
      id: id,
      name: handle.name,
      handle: handle,
      addedAt: Date.now()
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Scan a device library for CBZ/CBR files
 */
export async function scanDeviceLibrary(libraryId, directoryHandle) {
  console.log(`Scanning device library: ${directoryHandle.name}`);
  const comics = [];

  async function walk(handle, relativePath = '') {
    for await (const entry of handle.values()) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, path);
      } else if (entry.kind === 'file') {
        if (entry.name.toLowerCase().endsWith('.cbz') || entry.name.toLowerCase().endsWith('.cbr')) {
          comics.push({
            id: `${libraryId}:${path}`,
            libraryId: libraryId,
            name: entry.name,
            path: path,
            handle: entry,
            addedAt: Date.now()
          });
        }
      }
    }
  }

  await walk(directoryHandle);
  console.log(`Found ${comics.length} local comics`);

  const activeDb = await getOfflineDb();
  const tx = activeDb.transaction([DEVICE_COMICS_STORE], 'readwrite');
  const store = tx.objectStore(DEVICE_COMICS_STORE);

  for (const comic of comics) {
    store.put(comic);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(comics);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all device libraries
 */
export async function getDeviceLibraries() {
  const activeDb = await getOfflineDb();
  if (!activeDb.objectStoreNames.contains(DEVICE_LIBRARIES_STORE)) return [];

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction([DEVICE_LIBRARIES_STORE], 'readonly');
    const store = tx.objectStore(DEVICE_LIBRARIES_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
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
    tx.oncomplete = () => {
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
