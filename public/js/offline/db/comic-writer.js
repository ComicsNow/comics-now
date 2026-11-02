import { state, debugLog } from '../../globals.js';
import { openOfflineDB, getCurrentUserId } from '../db-core.js';

export const callScheduleOfflineProgressSync = (immediate = false) => {
  const fn = state?.scheduleOfflineProgressSync || (typeof window !== 'undefined' ? window.scheduleOfflineProgressSync : null);
  if (typeof fn === 'function') fn(immediate);
};

export async function saveComicToDB(comic, blob) {
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
  const userId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

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

export async function updateDownloadedComicInfo(comicId, updates) {
  if (!comicId || !updates) return false;

  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function' ? openOfflineDB : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }

  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    return false;
  }

  const getUserIdFn = typeof getCurrentUserId === 'function' ? getCurrentUserId : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  const currentUserId = typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';

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

        if (comic.userId && comic.userId !== currentUserId) {
          if (typeof debugLog === 'function') {
            debugLog('PROGRESS', `updateDownloadedComicInfo - comic ${comicId} belongs to different user, denying update`);
          }
          resolve(false);
          return;
        }

        if (!comic.comicInfo) {
          comic.comicInfo = {};
        }

        Object.assign(comic.comicInfo, updates);

        const putRequest = store.put(comic);

        putRequest.onsuccess = () => {
          if (typeof debugLog === 'function') {
            debugLog('PROGRESS', `updateDownloadedComicInfo - successfully updated comic ${comicId}`, updates);
          }
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
