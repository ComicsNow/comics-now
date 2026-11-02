import { state, debugLog, encodePath } from '../../globals.js';
import { openOfflineDB, getCurrentUserId } from '../db-core.js';
import { isIdInLibrary } from './comic-reader.js';
import { callScheduleOfflineProgressSync } from './comic-writer.js';
import { forceStorageCleanup, getStorageInfo } from './comic-storage.js';

export async function deleteFromCache(comicId, comicPath) {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await caches.open('comics-now-downloads');
    const keys = await cache.keys();
    const idStr = String(comicId);
    
    const encodedPaths = [];
    if (comicPath) {
      try {
        const pathForward = comicPath.replace(/\\/g, '/');
        const pathBackward = comicPath.replace(/\//g, '\\');
        const encodeFn = typeof encodePath === 'function' ? encodePath : (state?.encodePath || (p => p));
        encodedPaths.push(encodeFn(pathForward));
        encodedPaths.push(encodeFn(pathBackward));
        encodedPaths.push(encodeFn(comicPath));
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
      if (typeof debugLog === 'function') {
        debugLog('OFFLINE', `Deleted ${deletions.length} items from cache for comic ${comicId}`);
      }
    }
  } catch (error) {
    console.error('[OFFLINE] Error deleting from cache:', error);
  }
}

export async function deleteOfflineComic(comicId) {
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    throw new Error('Database not initialized');
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

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
          if (result.userId && result.userId !== currentUserId) {
            if (typeof debugLog === 'function') {
              debugLog('OFFLINE', `deleteOfflineComic - comic ${comicId} belongs to different user, denying deletion`);
            }
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
          if (state?.downloadedComicIds) state.downloadedComicIds.delete(id);
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
            if (typeof debugLog === 'function') {
              debugLog(
                'OFFLINE',
                `Cleaning up comic blob for ID ${comicId}, size: ${comicDataFound.fileBlob.size} bytes`
              );
            }
            comicDataFound.fileBlob = null;
          } catch (error) {
            // Ignore blob errors
          }
        }

        if (typeof window !== 'undefined' && typeof window.gc === 'function') {
          try {
            setTimeout(() => window.gc(), 100);
          } catch (_) {}
        } else if (typeof globalThis.gc === 'function') {
          try {
            setTimeout(() => globalThis.gc(), 100);
          } catch (_) {}
        }

        if (typeof debugLog === 'function') {
          debugLog('OFFLINE', `Successfully deleted offline comic ${comicId} from local storage`);
        }
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

export async function clearOfflineData() {
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    return;
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['comics', 'progress', 'statuses'], 'readwrite');
    const comicsStore = tx.objectStore('comics');
    const progressStore = tx.objectStore('progress');
    const statusStore = tx.objectStore('statuses');

    const getAllRequest = comicsStore.getAll();
    getAllRequest.onsuccess = async () => {
      const allComics = getAllRequest.result || [];
      const userComics = allComics.filter(comic => !comic.userId || comic.userId === currentUserId);

      if (typeof debugLog === 'function') {
        debugLog('OFFLINE', `Clearing ${userComics.length} comics for user ${currentUserId}`);
      }

      userComics.forEach(comic => {
        comicsStore.delete(comic.id);
      });

      progressStore.clear();
      statusStore.clear();

      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          await caches.delete('comics-now-downloads');
        } catch (e) {
          console.error('[OFFLINE] Error clearing downloads cache:', e);
        }
      }

      tx.oncomplete = () => {
        if (state?.downloadedComicIds) {
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

export async function removeStaleDownloads() {
  if (state?.library && state.library._isLazyLoaded) {
    if (typeof debugLog === 'function') {
      debugLog('CLEANUP', 'Skipping stale download removal due to lazy loading');
    }
    return;
  }

  const downloadedComicIds = state?.downloadedComicIds || (typeof window !== 'undefined' ? window.downloadedComicIds : null) || new Set();
  const finalComicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
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

export {
  getStorageInfo,
  forceStorageCleanup
};
