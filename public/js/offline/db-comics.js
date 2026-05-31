import { state, debugLog, applyDisplayInfoToComic, encodePath } from '../globals.js';
import { openOfflineDB, getCurrentUserId } from './db-core.js';

// Safe schedule progress sync helper
const callScheduleOfflineProgressSync = (immediate = false) => {
  const fn = state.scheduleOfflineProgressSync || window.scheduleOfflineProgressSync;
  if (typeof fn === 'function') fn(immediate);
};

export async function saveComicToDB(comic, blob) {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    throw new Error('Database not initialized');
  }

  // Get current userId
  const userId = getCurrentUserId();

  const comicData = {
    id: comic.id,
    userId: userId,
    comicInfo: comic,
    fileBlob: blob
  };

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['comics'], 'readwrite');
    const store = tx.objectStore('comics');
    const request = store.put(comicData);
    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(new Error(`Failed to save comic: ${event.target.errorCode}`));
  });
}

export async function getComicFromDB(comicId) {
  debugLog('PROGRESS', `getComicFromDB called for ID: ${comicId}`);
  
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    debugLog('PROGRESS', 'DB not initialized in getComicFromDB, opening...');
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    throw new Error('Database not initialized');
  }

  // Get current userId
  const currentUserId = getCurrentUserId();

  const originalId = comicId;
  const idStr = String(comicId);
  let idNum = null;
  if (/^\d+$/.test(idStr)) {
    idNum = Number(comicId);
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['comics'], 'readonly');
      const store = tx.objectStore('comics');
      
      let retrievalAttempts = 0;
      const maxRetrievalAttempts = 3;

      function attemptRetrieval() {
        if (retrievalAttempts >= maxRetrievalAttempts) {
          resolve(null);
          return;
        }

        let keyToTry;
        if (retrievalAttempts === 0) {
          keyToTry = originalId;
        } else if (retrievalAttempts === 1 && idNum !== null) {
          keyToTry = idNum;
        } else {
          keyToTry = idStr;
        }

        const request = store.get(keyToTry);
        request.onsuccess = (event) => {
          const result = event.target.result;
          if (result) {
            // Verify userId matches (or comic has no userId for legacy support)
            if (result.userId && result.userId !== currentUserId) {
              debugLog('PROGRESS', `getComicFromDB - comic ${comicId} belongs to different user, denying access`);
              resolve(null);
              return;
            }
            debugLog('PROGRESS', `getComicFromDB success - found comic: true for ID: ${comicId} (key: ${keyToTry})`);
            resolve(result);
          } else {
            retrievalAttempts++;
            attemptRetrieval();
          }
        };
        request.onerror = () => {
          retrievalAttempts++;
          attemptRetrieval();
        };
      }

      attemptRetrieval();
    } catch (error) {
      reject(error);
    }
  });
}

export async function getAllDownloadedComics() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return [];
  }

  // Get current userId from syncManager or default
  const currentUserId = getCurrentUserId();

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['comics', 'progress'], 'readonly');
    const comicsStore = tx.objectStore('comics');
    const progressStore = tx.objectStore('progress');

    const comicsRequest = comicsStore.getAll();
    const progressRequest = progressStore.getAll();

    let comics = [];
    const progressMap = new Map();
    let requestsCompleted = 0;

    comicsRequest.onsuccess = (event) => {
      // Filter comics by current userId
      const allComics = event.target.result || [];
      comics = allComics.filter(comic => {
        // Support both new userId field and legacy comics without userId
        return !comic.userId || comic.userId === currentUserId;
      });
      requestsCompleted++;
      if (requestsCompleted === 2) mergeAndResolve();
    };

    progressRequest.onsuccess = (event) => {
      const progressData = event.target.result || [];
      progressData.forEach(p => progressMap.set(p.id, p));
      requestsCompleted++;
      if (requestsCompleted === 2) mergeAndResolve();
    };

    function mergeAndResolve() {
      try {
        const mergedComics = comics.map((comic, index) => {
          const savedProgress = progressMap.get(comic.id);
          const fallbackProgress = comic.comicInfo?.progress || { totalPages: 0, lastReadPage: 0 };

          const progress = savedProgress ? {
            totalPages: savedProgress.totalPages || fallbackProgress.totalPages || 0,
            lastReadPage: savedProgress.lastReadPage || fallbackProgress.lastReadPage || 0,
          } : fallbackProgress;

          if (index < 2) {
            const comicInfo = comic.comicInfo || {};
            const info = applyDisplayInfoToComic(comicInfo);
            const displayName = info.displayName || comicInfo.name || 'Unknown Comic';
            
            debugLog('OFFLINE', `getAllDownloadedComics - Comic ${index} (${displayName}):`, {
              savedProgress,
              fallbackProgress,
              finalProgress: progress,
              isInProgress:
                progress.totalPages > 0 &&
                progress.lastReadPage > 0 &&
                progress.lastReadPage < progress.totalPages - 1,
            });
          }

          return {
            ...comic,
            comicInfo: {
              ...comic.comicInfo,
              progress,
            },
          };
        });

        resolve(mergedComics);
      } catch (err) {
        reject(err);
      }
    }

    comicsRequest.onerror = () => reject(new Error('Failed to get comics from DB'));
    progressRequest.onerror = () => reject(new Error('Failed to get progress from DB'));
  });
}

export async function getAllDownloadedComicIds() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return new Set();
  }

  // Get current userId from syncManager or default
  const currentUserId = getCurrentUserId();

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['comics'], 'readonly');
      const store = tx.objectStore('comics');
      const request = store.getAll();
      request.onsuccess = (event) => {
        const allComics = event.target.result || [];

        // Filter by userId and extract IDs
        const userComicIds = allComics
          .filter(comic => !comic.userId || comic.userId === currentUserId)
          .map(comic => comic.id);

        const idSet = new Set(userComicIds);
        state.downloadedComicIds = idSet;
        if (typeof window !== 'undefined') {
          window.downloadedComicIds = idSet;
        }
        resolve(idSet);
      };
      request.onerror = (event) => {
        console.error('[OFFLINE] Error getting comics from DB:', event.target.error);
        reject(new Error(`Failed to get comics: ${event.target.errorCode}`));
      };
    } catch (error) {
      console.error('[OFFLINE] Exception in getAllDownloadedComicIds:', error);
      reject(error);
    }
  });
}

export async function removeStaleDownloads() {
  if (state.library && state.library._isLazyLoaded) {
    debugLog('CLEANUP', 'Skipping stale download removal due to lazy loading');
    return;
  }

  const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds || new Set();
  const finalComicIdMap = state.comicIdMap || window.comicIdMap;
  const hasIdMap = finalComicIdMap && finalComicIdMap.size > 0;
  
  let deletedCount = 0;
  for (const id of [...downloadedComicIds]) {
    const exists = hasIdMap ? finalComicIdMap.has(id) : isIdInLibrary(id);
    if (!exists) {
      await deleteOfflineComic(id);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    await forceStorageCleanup();
  }
}

/**
 * Fallback for checking if an ID exists in the library without the Map
 */
export function isIdInLibrary(targetId) {
  if (!state.library) return false;
  for (const root of Object.values(state.library)) {
    for (const publisher of Object.values(root.publishers || {})) {
      for (const series of Object.values(publisher.series || {})) {
        if (Array.isArray(series)) {
          if (series.some(comic => comic.id === targetId)) return true;
        }
      }
    }
  }
  return false;
}

export async function clearOfflineData() {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return;
  }

  // Get current userId from syncManager or default
  const currentUserId = getCurrentUserId();

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['comics', 'progress', 'statuses'], 'readwrite');
    const comicsStore = tx.objectStore('comics');
    const progressStore = tx.objectStore('progress');
    const statusStore = tx.objectStore('statuses');

    // Get all comics and only delete those belonging to current user
    const getAllRequest = comicsStore.getAll();
    getAllRequest.onsuccess = async () => {
      const allComics = getAllRequest.result || [];
      const userComics = allComics.filter(comic => !comic.userId || comic.userId === currentUserId);

      debugLog('OFFLINE', `Clearing ${userComics.length} comics for user ${currentUserId}`);

      // Delete each user comic
      userComics.forEach(comic => {
        comicsStore.delete(comic.id);
      });

      // Clear all progress and statuses (these are already user-specific via sync system)
      progressStore.clear();
      statusStore.clear();

      // Also clear the Cache API data for downloads
      if ('caches' in window) {
        try {
          await caches.delete('comics-now-downloads');
        } catch (e) {
          console.error('[OFFLINE] Error clearing downloads cache:', e);
        }
      }

      tx.oncomplete = () => {
        if (state.downloadedComicIds) {
          state.downloadedComicIds.clear();
        }
        if (typeof window !== 'undefined' && window.downloadedComicIds) {
          window.downloadedComicIds.clear();
        }
        resolve();
      };

      tx.onerror = (event) => reject(new Error(`Failed to clear data: ${event.target.errorCode}`));
    };

    getAllRequest.onerror = (event) => {
      reject(new Error(`Failed to get comics: ${event.target.errorCode}`));
    };
  });
}

export async function deleteFromCache(comicId, comicPath) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('comics-now-downloads');
    const keys = await cache.keys();
    const idStr = String(comicId);
    
    const encodedPaths = [];
    if (comicPath) {
      try {
        const pathForward = comicPath.replace(/\\/g, '/');
        const pathBackward = comicPath.replace(/\//g, '\\');
        encodedPaths.push(encodePath(pathForward));
        encodedPaths.push(encodePath(pathBackward));
        encodedPaths.push(encodePath(comicPath));
      } catch (e) {
        console.error('[OFFLINE] Error encoding path for cache deletion:', e);
      }
    }

    const deletions = [];
    const escapedId = idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const request of keys) {
      const url = request.url;
      let shouldDelete = false;

      const apiPattern = new RegExp(`\\/api\\/(?:v1\\/)?comics\\/${escapedId}(?:$|\\/|\\?)`);
      
      if (apiPattern.test(url)) {
        shouldDelete = true;
      } 
      else if (encodedPaths.length > 0 && url.includes('path=')) {
        if (encodedPaths.some(enc => url.includes(encodeURIComponent(enc)) || url.includes(enc))) {
          shouldDelete = true;
        }
      }
      else if (url.includes(`/thumbnails/${idStr}.jpg`)) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        deletions.push(cache.delete(request));
      }
    }

    if (deletions.length > 0) {
      await Promise.all(deletions);
      debugLog('OFFLINE', `Deleted ${deletions.length} items from cache for comic ${comicId}`);
    }
  } catch (error) {
    console.error('[OFFLINE] Error deleting from cache:', error);
  }
}

export async function deleteOfflineComic(comicId) {
  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    await openOfflineDB();
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    throw new Error('Database not initialized');
  }

  // Get current userId from syncManager or default
  const currentUserId = getCurrentUserId();

  const originalId = comicId;
  const idStr = String(comicId);
  let idNum = null;
  if (/^\d+$/.test(idStr)) {
    idNum = Number(comicId);
  }

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['comics', 'progress', 'statuses'], 'readwrite');
    const comicsStore = tx.objectStore('comics');
    const progressStore = tx.objectStore('progress');
    const statusStore = tx.objectStore('statuses');

    let comicDataFound = null;
    let retrievalAttempts = 0;
    const maxRetrievalAttempts = 2;

    function attemptRetrieval() {
      if (retrievalAttempts >= maxRetrievalAttempts) {
        proceedWithDeletion();
        return;
      }

      let keyToTry;
      if (retrievalAttempts === 0) {
        keyToTry = originalId;
      } else if (retrievalAttempts === 1 && idNum !== null) {
        keyToTry = idNum;
      } else {
        keyToTry = idStr;
      }

      const getRequest = comicsStore.get(keyToTry);
      getRequest.onsuccess = (event) => {
        const result = event.target.result;
        if (result) {
          // Verify userId matches (or comic has no userId for legacy support)
          if (result.userId && result.userId !== currentUserId) {
            debugLog('OFFLINE', `deleteOfflineComic - comic ${comicId} belongs to different user, denying deletion`);
            reject(new Error('Cannot delete comic belonging to different user'));
            return;
          }
          comicDataFound = result;
          proceedWithDeletion();
        } else {
          retrievalAttempts++;
          attemptRetrieval();
        }
      };
      getRequest.onerror = () => {
        retrievalAttempts++;
        attemptRetrieval();
      };
    }

    function markProgressUnsynced(key) {
      if (key === undefined || key === null) return;
      let request;
      try {
        request = progressStore.get(key);
      } catch (_) {
        console.warn('[OFFLINE] Silent failure in progressStore.get:', _);
        return;
      }
      if (!request) return;
      request.onsuccess = (event) => {
        const record = event.target.result;
        if (!record) return;
        record.synced = false;
        record.updatedAt = new Date().toISOString();
        try {
          progressStore.put(record);
        } catch (_) {
          console.warn('[OFFLINE] Silent failure in progressStore.put:', _);
        }
      };
    }

    function proceedWithDeletion() {
      try { comicsStore.delete(originalId); } catch (_) { console.warn('[OFFLINE] Failed to delete originalId:', originalId, _); }
      if (idNum !== null) {
        try { comicsStore.delete(idNum); } catch (_) { console.warn('[OFFLINE] Failed to delete idNum:', idNum, _); }
      }
      try { comicsStore.delete(idStr); } catch (_) { console.warn('[OFFLINE] Failed to delete idStr:', idStr, _); }

      try { markProgressUnsynced(originalId); } catch (_) { console.warn('[OFFLINE] Failed to markProgressUnsynced originalId:', originalId, _); }
      try { markProgressUnsynced(idStr); } catch (_) { console.warn('[OFFLINE] Failed to markProgressUnsynced idStr:', idStr, _); }
      if (idNum !== null) {
        try { markProgressUnsynced(idNum); } catch (_) { console.warn('[OFFLINE] Failed to markProgressUnsynced idNum:', idNum, _); }
      }

      try { statusStore.delete(`comic:${originalId}`); } catch (_) { console.warn('[OFFLINE] Failed to delete status originalId:', originalId, _); }
      try { statusStore.delete(`comic:${idStr}`); } catch (_) { console.warn('[OFFLINE] Failed to delete status idStr:', idStr, _); }

      tx.oncomplete = async () => {
        const comicPath = comicDataFound?.comicInfo?.path || comicDataFound?.path;
        await deleteFromCache(originalId, comicPath);

        const cleanupId = (id) => {
          if (state.downloadedComicIds) state.downloadedComicIds.delete(id);
          if (typeof window !== 'undefined' && window.downloadedComicIds) {
            window.downloadedComicIds.delete(id);
          }
        };

        cleanupId(originalId);
        cleanupId(idStr);
        if (idNum !== null) {
          cleanupId(idNum);
        }

        if (comicDataFound && comicDataFound.fileBlob) {
          try {
            debugLog(
              'OFFLINE',
              `Cleaning up comic blob for ID ${comicId}, size: ${comicDataFound.fileBlob.size} bytes`
            );
            comicDataFound.fileBlob = null;
          } catch (error) {
            // Ignore blob errors
          }
        }

        // Trigger garbage collection if available
        if (typeof window !== 'undefined' && typeof window.gc === 'function') {
          try {
            setTimeout(() => window.gc(), 100);
          } catch (_) {}
        } else if (typeof globalThis.gc === 'function') {
          try {
            setTimeout(() => globalThis.gc(), 100);
          } catch (_) {}
        }

        debugLog('OFFLINE', `Successfully deleted offline comic ${comicId} from local storage`);
        callScheduleOfflineProgressSync(true);
        resolve();
      };

      tx.onerror = (event) => {
        reject(new Error(`Failed to delete comic: ${event.target.errorCode}`));
      };
    }

    attemptRetrieval();
  });
}

export async function getStorageInfo() {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return { supported: false };
  }

  try {
    const estimate = await navigator.storage.estimate();
    return {
      supported: true,
      quota: estimate.quota,
      usage: estimate.usage,
      usagePercent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0,
      usageMB: Math.round(((estimate.usage || 0) / (1024 * 1024)) * 100) / 100,
      quotaMB: Math.round(((estimate.quota || 0) / (1024 * 1024)) * 100) / 100,
    };
  } catch (error) {
    return { supported: false, error: error.message };
  }
}

export async function forceStorageCleanup() {
  debugLog('OFFLINE', 'Forcing storage cleanup...');

  const storageBefore = await getStorageInfo();
  if (storageBefore.supported) {
    debugLog(
      'OFFLINE',
      `Storage before cleanup: ${storageBefore.usageMB}MB / ${storageBefore.quotaMB}MB (${storageBefore.usagePercent}%)`
    );
  }

  try {
    const gcFn = (typeof window !== 'undefined' && window.gc) || (typeof globalThis.gc === 'function' ? globalThis.gc : null);
    if (gcFn) {
      gcFn();
    }

    if ('storage' in navigator && 'persist' in navigator.storage) {
      try {
        await navigator.storage.persist();
      } catch (_) {
        console.warn('[OFFLINE] navigator.storage.persist failed:', _);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const storageAfter = await getStorageInfo();
    if (storageAfter.supported) {
      debugLog(
        'OFFLINE',
        `Storage after cleanup: ${storageAfter.usageMB}MB / ${storageAfter.quotaMB}MB (${storageAfter.usagePercent}%)`
      );

      const savedMB = storageBefore.usageMB - storageAfter.usageMB;
      if (savedMB > 0) {
        debugLog('OFFLINE', `Freed ${savedMB}MB of storage`);
      }
    }

    return storageAfter;
  } catch (error) {
    console.error('[OFFLINE] Error during forceStorageCleanup:', error);
    return storageBefore;
  }
}

export async function getOfflineComicRecordById(targetId) {
  if (targetId == null) return null;

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    try {
      await openOfflineDB();
    } catch (error) {
      return null;
    }
  }

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return null;
  }

  // Get current userId from syncManager or default
  const currentUserId = getCurrentUserId();

  const keysToTry = [];
  keysToTry.push(targetId);
  const stringId = String(targetId);
  if (!keysToTry.includes(stringId)) {
    keysToTry.push(stringId);
  }
  const numericId = Number(stringId);
  if (!Number.isNaN(numericId) && !keysToTry.includes(numericId)) {
    keysToTry.push(numericId);
  }

  for (const key of keysToTry) {
    try {
      const record = await new Promise(resolve => {
        try {
          const tx = activeDb.transaction(['comics'], 'readonly');
          const store = tx.objectStore('comics');
          const req = store.get(key);
          req.onsuccess = () => {
            const result = req.result || null;
            // Verify userId matches (or comic has no userId for legacy support)
            if (result && result.userId && result.userId !== currentUserId) {
              debugLog('PROGRESS', `getOfflineComicRecordById - comic ${key} belongs to different user, denying access`);
              resolve(null);
              return;
            }
            resolve(result);
          };
          req.onerror = () => resolve(null);
        } catch (error) {
          resolve(null);
        }
      });
      if (record) return record;
    } catch (error) {
      // Keep trying
    }
  }

  return null;
}

export async function updateDownloadedComicInfo(comicId, updates) {
  if (!comicId || !updates) return false;

  const dbToUse = state.db || window.db;
  if (!dbToUse) await openOfflineDB();

  const activeDb = state.db || window.db;
  if (!activeDb) {
    return false;
  }

  // Get current userId
  const currentUserId = getCurrentUserId();

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['comics'], 'readwrite');
      const store = tx.objectStore('comics');
      const getRequest = store.get(comicId);

      getRequest.onsuccess = (event) => {
        const comic = event.target.result;

        if (!comic) {
          resolve(false);
          return;
        }

        // Verify userId matches (or comic has no userId for legacy support)
        if (comic.userId && comic.userId !== currentUserId) {
          debugLog('PROGRESS', `updateDownloadedComicInfo - comic ${comicId} belongs to different user, denying update`);
          resolve(false);
          return;
        }

        // Update comicInfo with the new data
        if (!comic.comicInfo) {
          comic.comicInfo = {};
        }

        Object.assign(comic.comicInfo, updates);

        // Save back to DB
        const putRequest = store.put(comic);

        putRequest.onsuccess = () => {
          debugLog('PROGRESS', `updateDownloadedComicInfo - successfully updated comic ${comicId}`, updates);
          resolve(true);
        };

        putRequest.onerror = (event) => {
          reject(new Error(`Failed to update comic: ${event.target.errorCode}`));
        };
      };

      getRequest.onerror = (event) => {
        reject(new Error(`Failed to get comic: ${event.target.errorCode}`));
      };
    } catch (error) {
      reject(error);
    }
  });
}

// Expose globals for backward compatibility during transition
state.saveComicToDB = saveComicToDB;
state.getComicFromDB = getComicFromDB;
state.getAllDownloadedComics = getAllDownloadedComics;
state.getAllDownloadedComicIds = getAllDownloadedComicIds;
state.removeStaleDownloads = removeStaleDownloads;
state.clearOfflineData = clearOfflineData;
state.deleteOfflineComic = deleteOfflineComic;
state.deleteFromCache = deleteFromCache;
state.getStorageInfo = getStorageInfo;
state.forceStorageCleanup = forceStorageCleanup;
state.getOfflineComicRecordById = getOfflineComicRecordById;
state.updateDownloadedComicInfo = updateDownloadedComicInfo;

if (typeof window !== 'undefined') {
  window.saveComicToDB = saveComicToDB;
  window.getComicFromDB = getComicFromDB;
  window.getAllDownloadedComics = getAllDownloadedComics;
  window.getAllDownloadedComicIds = getAllDownloadedComicIds;
  window.removeStaleDownloads = removeStaleDownloads;
  window.clearOfflineData = clearOfflineData;
  window.deleteOfflineComic = deleteOfflineComic;
  window.deleteFromCache = deleteFromCache;
  window.getStorageInfo = getStorageInfo;
  window.forceStorageCleanup = forceStorageCleanup;
  window.getOfflineComicRecordById = getOfflineComicRecordById;
  window.updateDownloadedComicInfo = updateDownloadedComicInfo;
}
