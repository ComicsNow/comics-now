import { state, debugLog } from '../../globals.js';

export const PROGRESS_SYNC_DEBOUNCE_MS = 400;
let progressSyncTimerId = null;
let progressSyncInProgress = false;
let progressSyncNeedsRun = false;
let progressSyncPromise = null;

export function updateLibraryProgress(comicId, page, totalPages) {
  const library = state.library || (typeof window !== 'undefined' ? window.library : null);
  if (!library) return;
  const idNum = typeof comicId === 'number' ? comicId : Number(comicId);
  for (const root of Object.values(library)) {
    for (const pub of Object.values(root.publishers || {})) {
      for (const series of Object.values(pub.series || {})) {
        if (Array.isArray(series)) {
          const comic = series.find(c => c.id === idNum);
          if (comic) {
            if (!comic.progress) comic.progress = {};
            if (typeof page === 'object' && page !== null) {
              comic.progress.lastReadPage = page.lastReadPage;
              if (typeof page.totalPages === 'number') {
                comic.progress.totalPages = page.totalPages;
              }
            } else {
              comic.progress.lastReadPage = page;
              if (typeof totalPages === 'number') {
                comic.progress.totalPages = totalPages;
              }
            }
            return;
          }
        }
      }
    }
  }
}

export function findComicInLibraryById(targetId) {
  const library = state.library || (typeof window !== 'undefined' ? window.library : null);
  if (!library || targetId == null) return null;

  const stringId = String(targetId);
  const numericId = Number(stringId);
  const hasNumericId = !Number.isNaN(numericId);

  for (const root of Object.values(library)) {
    if (!root || !root.publishers) continue;
    for (const publisher of Object.values(root.publishers)) {
      if (!publisher || !publisher.series) continue;
      for (const series of Object.values(publisher.series)) {
        if (!Array.isArray(series)) continue;
        for (const comic of series) {
          if (!comic) continue;
          const candidateId = comic.id;
          if (candidateId == null) continue;
          if (candidateId === targetId) return comic;
          if (String(candidateId) === stringId) return comic;
          if (hasNumericId) {
            const candidateNum = Number(candidateId);
            if (!Number.isNaN(candidateNum) && candidateNum === numericId) return comic;
          }
        }
      }
    }
  }

  return null;
}

export function scheduleOfflineProgressSync(immediate = false) {
  progressSyncNeedsRun = true;

  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return;
  }

  if (progressSyncInProgress) {
    return;
  }

  if (progressSyncTimerId) {
    clearTimeout(progressSyncTimerId);
    progressSyncTimerId = null;
  }

  const trigger = () => {
    progressSyncTimerId = null;
    syncOfflineProgress();
  };

  if (immediate) {
    trigger();
  } else {
    progressSyncTimerId = setTimeout(trigger, PROGRESS_SYNC_DEBOUNCE_MS);
  }
}

export async function syncOfflineProgress() {
  if (progressSyncInProgress) {
    progressSyncNeedsRun = true;
    return progressSyncPromise || Promise.resolve();
  }

  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    progressSyncNeedsRun = true;
    return;
  }

  progressSyncInProgress = true;
  progressSyncNeedsRun = false;

  progressSyncPromise = (async () => {
    const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
    if (db.openOfflineDB) {
      await db.openOfflineDB();
    }
    const activeDb = state.db || (typeof window !== 'undefined' ? window.db : null);
    if (!activeDb) return;

    await new Promise(resolve => setTimeout(resolve, 0));

    const unsynced = await new Promise((resolve, reject) => {
      const tx = activeDb.transaction(['progress'], 'readonly');
      const store = tx.objectStore('progress');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });

    const syncManager = state.syncManager || (typeof window !== 'undefined' ? window.syncManager : null);

    for (const item of unsynced) {
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        const pageValue = (typeof item.lastReadPage === 'number' && !Number.isNaN(item.lastReadPage))
          ? item.lastReadPage
          : (typeof item.page === 'number' && !Number.isNaN(item.page) ? item.page : null);

        if (pageValue === null || pageValue < 0) {
          debugLog('OFFLINE', `Invalid data for comic ${item.id}, page: ${item.page}`);
          continue;
        }

        const totalPages = (typeof item.totalPages === 'number' && !Number.isNaN(item.totalPages))
          ? item.totalPages
          : undefined;

        let comicPath = (typeof item.comicPath === 'string' && item.comicPath.length > 0)
          ? item.comicPath
          : null;

        const libraryComic = findComicInLibraryById(item.id);
        if (!comicPath && libraryComic && typeof libraryComic.path === 'string') {
          comicPath = libraryComic.path;
        }

        if (!comicPath && db.getOfflineComicRecordById) {
          const offlineRecord = await db.getOfflineComicRecordById(item.id);
          if (offlineRecord && offlineRecord.comicInfo) {
            comicPath = offlineRecord.comicInfo.path || offlineRecord.comicInfo.filePath || offlineRecord.path || null;
          }
        }

        if (!comicPath) {
          debugLog('OFFLINE', `Comic with ID ${item.id} not found in library or offline cache, cleaning up progress entry`);
          await new Promise((resolve, reject) => {
            const tx2 = activeDb.transaction(['progress'], 'readwrite');
            tx2.objectStore('progress').delete(item.id);
            tx2.oncomplete = () => resolve();
            tx2.onerror = () => reject(tx2.error || new Error('delete failed'));
          });
          continue;
        }

        if (syncManager && syncManager.deviceId) {
          try {
            await syncManager.updateProgress(item.id, pageValue);
          } catch (syncError) {
            continue;
          }
        } else {
          continue;
        }

        updateLibraryProgress(item.id, pageValue, totalPages);

        item.synced = true;
        item.lastReadPage = pageValue;
        item.page = pageValue;
        if (typeof totalPages === 'number') {
          item.totalPages = totalPages;
        }
        item.comicPath = comicPath;
        item.updatedAt = new Date().toISOString();

        await new Promise((resolve, reject) => {
          const tx2 = activeDb.transaction(['progress'], 'readwrite');
          tx2.objectStore('progress').put(item);
          tx2.oncomplete = () => resolve();
          tx2.onerror = () => reject(tx2.error || new Error('put failed'));
        });
      } catch (error) {
        // Handle error silently
      }
    }
  })();

  try {
    await progressSyncPromise;
  } finally {
    progressSyncInProgress = false;
    progressSyncPromise = null;
    if (progressSyncNeedsRun && (typeof navigator === 'undefined' || !navigator || navigator.onLine !== false)) {
      progressSyncNeedsRun = false;
      scheduleOfflineProgressSync(true);
    }
  }
}

export async function enhancedBackgroundSync() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    await scheduleOfflineProgressSync(true);
    const syncStatuses = state.syncOfflineStatuses || (typeof window !== 'undefined' ? window.syncOfflineStatuses : null);
    if (typeof syncStatuses === 'function') {
      await syncStatuses();
    }
  } catch (error) {
    // Handle error silently
  }
}
