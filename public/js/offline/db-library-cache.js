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

// Expose globals for backward compatibility during transition
state.saveLibraryCacheToDB = saveLibraryCacheToDB;
state.loadLibraryCacheFromDB = loadLibraryCacheFromDB;
state.clearLibraryCacheFromDB = clearLibraryCacheFromDB;

if (typeof window !== 'undefined') {
  window.saveLibraryCacheToDB = saveLibraryCacheToDB;
  window.loadLibraryCacheFromDB = loadLibraryCacheFromDB;
  window.clearLibraryCacheFromDB = clearLibraryCacheFromDB;
}
