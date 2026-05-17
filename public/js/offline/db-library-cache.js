(function (global) {
  'use strict';

  async function saveLibraryCacheToDB(libraryData) {
    if (!libraryData) return null;
    if (!global.db) await global.openOfflineDB();

    if (!global.db.objectStoreNames.contains(global.LIBRARY_CACHE_STORE)) {
      debugLog('PROGRESS', `Object store '${global.LIBRARY_CACHE_STORE}' missing, skipping cache save.`);
      return null;
    }

    const record = {
      key: global.LIBRARY_CACHE_KEY,
      data: libraryData,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      try {
        const tx = global.db.transaction([global.LIBRARY_CACHE_STORE], 'readwrite');
        const store = tx.objectStore(global.LIBRARY_CACHE_STORE);
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

  async function loadLibraryCacheFromDB() {
    if (!global.db) await global.openOfflineDB();

    if (!global.db.objectStoreNames.contains(global.LIBRARY_CACHE_STORE)) {
      debugLog('PROGRESS', `Object store '${global.LIBRARY_CACHE_STORE}' missing, no cached library available.`);
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = global.db.transaction([global.LIBRARY_CACHE_STORE], 'readonly');
        const store = tx.objectStore(global.LIBRARY_CACHE_STORE);
        const request = store.get(global.LIBRARY_CACHE_KEY);

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

  async function clearLibraryCacheFromDB() {
    if (!global.db) await global.openOfflineDB();

    if (!global.db.objectStoreNames.contains(global.LIBRARY_CACHE_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = global.db.transaction([global.LIBRARY_CACHE_STORE], 'readwrite');
        const store = tx.objectStore(global.LIBRARY_CACHE_STORE);
        const request = store.delete(global.LIBRARY_CACHE_KEY);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          reject(event.target.error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // Expose globals
  global.saveLibraryCacheToDB = saveLibraryCacheToDB;
  global.loadLibraryCacheFromDB = loadLibraryCacheFromDB;
  global.clearLibraryCacheFromDB = clearLibraryCacheFromDB;

})(typeof window !== 'undefined' ? window : globalThis);
