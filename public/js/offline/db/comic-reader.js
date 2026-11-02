import { state, debugLog, applyDisplayInfoToComic } from '../../globals.js';
import { openOfflineDB, getCurrentUserId } from '../db-core.js';

export function isIdInLibrary(targetId) {
  const currentLibrary = state?.library || (typeof window !== 'undefined' ? window.library : null);
  if (!currentLibrary) return false;
  for (const root of Object.values(currentLibrary)) {
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

export async function getComicFromDB(comicId) {
  if (typeof debugLog === 'function') {
    debugLog('PROGRESS', `getComicFromDB called for ID: ${comicId}`);
  }
  
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    if (typeof debugLog === 'function') {
      debugLog('PROGRESS', 'DB not initialized in getComicFromDB, opening...');
    }
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
            if (result.userId && result.userId !== currentUserId) {
              if (typeof debugLog === 'function') {
                debugLog('PROGRESS', `getComicFromDB - comic ${comicId} belongs to different user, denying access`);
              }
              resolve(null);
              return;
            }
            if (typeof debugLog === 'function') {
              debugLog('PROGRESS', `getComicFromDB success - found comic: true for ID: ${comicId} (key: ${keyToTry})`);
            }
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
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    return [];
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

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
      const allComics = event.target.result || [];
      comics = allComics.filter(comic => {
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
            const infoFn = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic : (state?.applyDisplayInfoToComic || (c => c));
            const info = infoFn(comicInfo) || {};
            const displayName = info.displayName || comicInfo.name || 'Unknown Comic';
            
            if (typeof debugLog === 'function') {
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
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    return new Set();
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

  return new Promise((resolve, reject) => {
    try {
      const tx = activeDb.transaction(['comics'], 'readonly');
      const store = tx.objectStore('comics');
      const request = store.getAll();
      request.onsuccess = (event) => {
        const allComics = event.target.result || [];
        const userComicIds = allComics
          .filter(comic => !comic.userId || comic.userId === currentUserId)
          .map(comic => comic.id);

        const idSet = new Set(userComicIds);
        if (state) state.downloadedComicIds = idSet;
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

export async function getOfflineComicRecordById(targetId) {
  if (targetId == null) return null;

  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    try {
      const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
      if (typeof openDbFn === 'function') {
        await openDbFn();
      }
    } catch (error) {
      return null;
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    return null;
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

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
            if (result && result.userId && result.userId !== currentUserId) {
              if (typeof debugLog === 'function') {
                debugLog('PROGRESS', `getOfflineComicRecordById - comic ${key} belongs to different user, denying access`);
              }
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
