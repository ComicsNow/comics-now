import { state, debugLog } from '../globals.js';
import { openOfflineDB, LIBRARY_CACHE_STORE, LIBRARY_CACHE_KEY } from './db-core.js';

export async function saveLibraryCacheToDB(libraryData) {
  if (!libraryData) return null;
  
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return null;
  }

  if (!activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    debugLog('PROGRESS', `Object store '${LIBRARY_CACHE_STORE}' missing, skipping cache save.`);
    return null;
  }

  const record = {
    key: LIBRARY_CACHE_KEY,
    data: libraryData,
    timestamp: Date.now(),
  };

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readwrite');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.put(record);

      request.onsuccess = () => {
        resolve(record);
      };
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

export async function loadLibraryCacheFromDB() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return null;
  }

  if (!activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    debugLog('PROGRESS', `Object store '${LIBRARY_CACHE_STORE}' missing, no cached library available.`);
    return null;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readonly');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.get(LIBRARY_CACHE_KEY);

      request.onsuccess = (event) => {
        resolve(event.target.result || null);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

export async function clearLibraryCacheFromDB() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return;
  }

  if (!activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readwrite');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.delete(LIBRARY_CACHE_KEY);

      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

export const READING_LISTS_CACHE_KEY = 'reading-lists-cache';
export const READING_LIST_DETAIL_PREFIX = 'reading-list-detail:';

/**
 * Save reading lists collection to IndexedDB and localStorage
 */
export async function saveReadingListsCacheToDB(lists) {
  if (!lists) return null;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('comics-reading-lists-cache', JSON.stringify(lists));
    }
  } catch (e) {
    // Ignore storage quota errors
  }

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb || !activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    return null;
  }

  const record = {
    key: READING_LISTS_CACHE_KEY,
    data: lists,
    timestamp: Date.now()
  };

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readwrite');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = (event) => reject(event.target.error);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Load reading lists collection from IndexedDB with localStorage fallback
 */
export async function loadReadingListsCacheFromDB() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (activeDb && activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    try {
      const record = await new Promise((resolve, reject) => {
        try {
          const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readonly');
          const store = tx.objectStore(LIBRARY_CACHE_STORE);
          const request = store.get(READING_LISTS_CACHE_KEY);

          request.onsuccess = (event) => resolve(event.target.result || null);
          request.onerror = (event) => reject(event.target.error);
        } catch (error) {
          reject(error);
        }
      });

      if (record && record.data) {
        return record.data;
      }
    } catch (err) {
      debugLog('PROGRESS', 'Error reading reading lists from IndexedDB:', err);
    }
  }

  // Fallback to localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('comics-reading-lists-cache');
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    // Ignore JSON parse / storage errors
  }

  return null;
}

/**
 * Save single reading list details to IndexedDB and localStorage
 */
export async function saveReadingListDetailCacheToDB(listId, detailData) {
  if (!listId || !detailData) return null;
  const key = `${READING_LIST_DETAIL_PREFIX}${listId}`;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`comics-${key}`, JSON.stringify(detailData));
    }
  } catch (e) {
    // Ignore storage quota errors
  }

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb || !activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    return null;
  }

  const record = {
    key,
    data: detailData,
    timestamp: Date.now()
  };

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readwrite');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve(record);
      request.onerror = (event) => reject(event.target.error);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Load single reading list details from IndexedDB with localStorage fallback
 */
export async function loadReadingListDetailCacheFromDB(listId) {
  if (!listId) return null;
  const key = `${READING_LIST_DETAIL_PREFIX}${listId}`;

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (activeDb && activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    try {
      const record = await new Promise((resolve, reject) => {
        try {
          const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readonly');
          const store = tx.objectStore(LIBRARY_CACHE_STORE);
          const request = store.get(key);

          request.onsuccess = (event) => resolve(event.target.result || null);
          request.onerror = (event) => reject(event.target.error);
        } catch (error) {
          reject(error);
        }
      });

      if (record && record.data) {
        return record.data;
      }
    } catch (err) {
      debugLog('PROGRESS', `Error reading reading list detail for ${listId} from IndexedDB:`, err);
    }
  }

  // Fallback to localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`comics-${key}`);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    // Ignore JSON parse / storage errors
  }

  return null;
}

/**
 * Delete cached reading list details
 */
export async function deleteReadingListDetailCacheFromDB(listId) {
  if (!listId) return;
  const key = `${READING_LIST_DETAIL_PREFIX}${listId}`;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`comics-${key}`);
    }
  } catch (e) {}

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb || !activeDb.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction([LIBRARY_CACHE_STORE], 'readwrite');
      const store = tx.objectStore(LIBRARY_CACHE_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    } catch (error) {
      reject(error);
    }
  });
}

// Expose globals for backward compatibility during transition
state.saveLibraryCacheToDB = saveLibraryCacheToDB;
state.loadLibraryCacheFromDB = loadLibraryCacheFromDB;
state.clearLibraryCacheFromDB = clearLibraryCacheFromDB;
state.saveReadingListsCacheToDB = saveReadingListsCacheToDB;
state.loadReadingListsCacheFromDB = loadReadingListsCacheFromDB;
state.saveReadingListDetailCacheToDB = saveReadingListDetailCacheToDB;
state.loadReadingListDetailCacheFromDB = loadReadingListDetailCacheFromDB;
state.deleteReadingListDetailCacheFromDB = deleteReadingListDetailCacheFromDB;

if (typeof window !== 'undefined') {
  window.saveLibraryCacheToDB = saveLibraryCacheToDB;
  window.loadLibraryCacheFromDB = loadLibraryCacheFromDB;
  window.clearLibraryCacheFromDB = clearLibraryCacheFromDB;
  window.saveReadingListsCacheToDB = saveReadingListsCacheToDB;
  window.loadReadingListsCacheFromDB = loadReadingListsCacheFromDB;
  window.saveReadingListDetailCacheToDB = saveReadingListDetailCacheToDB;
  window.loadReadingListDetailCacheFromDB = loadReadingListDetailCacheFromDB;
  window.deleteReadingListDetailCacheFromDB = deleteReadingListDetailCacheFromDB;
}

