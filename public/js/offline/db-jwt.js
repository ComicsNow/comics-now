(function (global) {
  'use strict';

  /**
   * Save JWT token to IndexedDB for Service Worker access
   * @param {string} token - JWT token
   * @returns {Promise<boolean>}
   */
  async function saveJWTToken(token) {
    if (!token) return false;
    if (!global.db) await global.openOfflineDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = global.db.transaction(['settings'], 'readwrite');
        const store = tx.objectStore('settings');

        const data = {
          key: 'cf-jwt-token',
          value: token,
          timestamp: Date.now()
        };

        const request = store.put(data);

        request.onsuccess = () => {
          resolve(true);
        };

        request.onerror = (event) => {
          console.error('[JWT] Error saving token:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('[JWT] Exception in saveJWTToken:', error);
        reject(error);
      }
    });
  }

  /**
   * Get JWT token from IndexedDB
   * @returns {Promise<string|null>}
   */
  async function getJWTToken() {
    if (!global.db) await global.openOfflineDB();

    return new Promise((resolve, reject) => {
      try {
        const tx = global.db.transaction(['settings'], 'readonly');
        const store = tx.objectStore('settings');
        const request = store.get('cf-jwt-token');

        request.onsuccess = () => {
          const result = request.result;
          if (result && result.value) {
            resolve(result.value);
          } else {
            resolve(null);
          }
        };

        request.onerror = (event) => {
          console.error('[JWT] Error getting token:', event.target.error);
          resolve(null);
        };
      } catch (error) {
        console.error('[JWT] Exception in getJWTToken:', error);
        resolve(null);
      }
    });
  }

  // Expose globals
  global.saveJWTToken = saveJWTToken;
  global.getJWTToken = getJWTToken;

})(typeof window !== 'undefined' ? window : globalThis);
