import { state } from '../globals.js';
import { openOfflineDB } from './db-core.js';

/**
 * Save JWT token to IndexedDB for Service Worker access
 * @param {string} token - JWT token
 * @returns {Promise<boolean>}
 */
export async function saveJWTToken(token) {
  if (!token) return false;
  
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return false;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['settings'], 'readwrite');
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
export async function getJWTToken() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const tx = activeDb.transaction(['settings'], 'readonly');
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

// Expose globals for backward compatibility during transition
state.saveJWTToken = saveJWTToken;
state.getJWTToken = getJWTToken;

if (typeof window !== 'undefined') {
  window.saveJWTToken = saveJWTToken;
  window.getJWTToken = getJWTToken;
}
