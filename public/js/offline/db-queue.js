import { state, debugLog } from '../globals.js';
import { openOfflineDB } from './db-core.js';

/**
 * Save or update a download queue item to IndexedDB
 * @param {Object} queueItem - Queue item with id, comicPath, comicName, status, progress, priority, addedAt
 * @returns {Promise<boolean>}
 */
export async function saveQueueItemToDB(queueItem) {
  if (!queueItem || !queueItem.id) return false;
  
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
      const tx = activeDb.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');
      const request = store.put(queueItem);

      request.onsuccess = () => {
        debugLog('QUEUE', `Saved queue item: ${queueItem.comicName}`);
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('[QUEUE] Error saving queue item:', event.target.error);
        reject(event.target.error);
      };
    } catch (error) {
      console.error('[QUEUE] Exception in saveQueueItemToDB:', error);
      reject(error);
    }
  });
}

/**
 * Get all download queue items from IndexedDB, sorted by priority
 * @returns {Promise<Array>}
 */
export async function getQueueFromDB() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return [];
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['downloadQueue'], 'readonly');
      const store = tx.objectStore('downloadQueue');
      const index = store.index('priority');
      const request = index.getAll();

      request.onsuccess = (event) => {
        const queue = event.target.result || [];
        debugLog('QUEUE', `Loaded ${queue.length} items from queue`);
        resolve(queue);
      };

      request.onerror = (event) => {
        console.error('[QUEUE] Error loading queue:', event.target.error);
        reject(event.target.error);
      };
    } catch (error) {
      console.error('[QUEUE] Exception in getQueueFromDB:', error);
      reject(error);
    }
  });
}

/**
 * Remove a download queue item from IndexedDB
 * @param {string} comicId - Comic ID
 * @returns {Promise<boolean>}
 */
export async function removeQueueItemFromDB(comicId) {
  if (!comicId) return false;

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
      const tx = activeDb.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');
      const request = store.delete(comicId);

      request.onsuccess = () => {
        debugLog('QUEUE', `Removed queue item: ${comicId}`);
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('[QUEUE] Error removing queue item:', event.target.error);
        reject(event.target.error);
      };
    } catch (error) {
      console.error('[QUEUE] Exception in removeQueueItemFromDB:', error);
      reject(error);
    }
  });
}

/**
 * Update priority for all queue items (for reordering)
 * @param {Array} queueItems - Array of queue items with updated priorities
 * @returns {Promise<boolean>}
 */
export async function updateQueuePriorities(queueItems) {
  if (!Array.isArray(queueItems) || queueItems.length === 0) return false;

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
      const tx = activeDb.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');

      let completed = 0;
      const total = queueItems.length;

      queueItems.forEach((item, index) => {
        item.priority = index; // Update priority based on array position
        const request = store.put(item);

        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            debugLog('QUEUE', `Updated priorities for ${total} items`);
            resolve(true);
          }
        };

        request.onerror = (event) => {
          console.error('[QUEUE] Error updating priority:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error('[QUEUE] Exception in updateQueuePriorities:', error);
      reject(error);
    }
  });
}

/**
 * Clear all completed and error queue items from IndexedDB
 * @returns {Promise<number>} - Number of items cleared
 */
export async function clearCompletedQueueItems() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return 0;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['downloadQueue'], 'readwrite');
      const store = tx.objectStore('downloadQueue');
      const request = store.getAll();

      request.onsuccess = (event) => {
        const allItems = event.target.result || [];
        const toRemove = allItems.filter(item =>
          item.status === 'completed' || item.status === 'error'
        );

        let removed = 0;
        toRemove.forEach(item => {
          const deleteRequest = store.delete(item.id);
          deleteRequest.onsuccess = () => {
            removed++;
            if (removed === toRemove.length) {
              debugLog('QUEUE', `Cleared ${removed} completed/error items`);
              resolve(removed);
            }
          };
        });

        if (toRemove.length === 0) {
          resolve(0);
        }
      };

      request.onerror = (event) => {
        console.error('[QUEUE] Error clearing completed items:', event.target.error);
        reject(event.target.error);
      };
    } catch (error) {
      console.error('[QUEUE] Exception in clearCompletedQueueItems:', error);
      reject(error);
    }
  });
}

// Expose globals for backward compatibility during transition
state.saveQueueItemToDB = saveQueueItemToDB;
state.getQueueFromDB = getQueueFromDB;
state.removeQueueItemFromDB = removeQueueItemFromDB;
state.updateQueuePriorities = updateQueuePriorities;
state.clearCompletedQueueItems = clearCompletedQueueItems;

if (typeof window !== 'undefined') {
  window.saveQueueItemToDB = saveQueueItemToDB;
  window.getQueueFromDB = getQueueFromDB;
  window.removeQueueItemFromDB = removeQueueItemFromDB;
  window.updateQueuePriorities = updateQueuePriorities;
  window.clearCompletedQueueItems = clearCompletedQueueItems;
}
