import { state, debugLog } from '../globals.js';

const PROGRESS_SYNC_DEBOUNCE_MS = 400;
let progressSyncTimerId = null;
let progressSyncInProgress = false;
let progressSyncNeedsRun = false;
let progressSyncPromise = null;

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

export async function saveStatusToDB(item) {
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || window.db;
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['statuses'], 'readwrite');
    const store = tx.objectStore('statuses');
    store.put({ ...item, synced: false });
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

export function updateLibraryProgress(comicId, page, totalPages) {
  const library = state.library || window.library;
  if (!library) return;
  const idNum = typeof comicId === 'number' ? comicId : Number(comicId);
  for (const root of Object.values(library)) {
    for (const pub of Object.values(root.publishers || {})) {
      for (const series of Object.values(pub.series || {})) {
        if (Array.isArray(series)) {
          const comic = series.find(c => c.id === idNum);
          if (comic) {
            if (!comic.progress) comic.progress = {};
            comic.progress.lastReadPage = page;
            if (typeof totalPages === 'number') {
              comic.progress.totalPages = totalPages;
            }
            return;
          }
        }
      }
    }
  }
}

export async function updateOfflineReadStatus(comicId, status) {
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || window.db;
  const idNum = typeof comicId === 'number' ? comicId : Number(comicId);
  const idStr = String(comicId);
  return new Promise(resolve => {
    const tx = activeDb.transaction(['comics', 'progress'], 'readwrite');
    const comicsStore = tx.objectStore('comics');
    const progressStore = tx.objectStore('progress');

    function applyUpdate(data) {
      if (!data) return;
      const info = data.comicInfo || (data.comicInfo = {});
      const prog = info.progress || (info.progress = {});
      let total = prog.totalPages || 0;
      if (status === 'read') {
        if (total > 0) {
          prog.lastReadPage = total - 1;
        } else {
          prog.lastReadPage = 0;
          prog.totalPages = 1;
        }
      } else {
        prog.lastReadPage = 0;
      }
      comicsStore.put(data);

      const normalizedLastRead = typeof prog.lastReadPage === 'number' && !Number.isNaN(prog.lastReadPage)
        ? prog.lastReadPage
        : 0;
      const progressRecord = {
        id: data.id,
        lastReadPage: normalizedLastRead,
        page: normalizedLastRead,
        synced: true,
        updatedAt: new Date().toISOString(),
      };

      if (typeof prog.totalPages === 'number' && !Number.isNaN(prog.totalPages)) {
        progressRecord.totalPages = prog.totalPages;
      }

      const comicPath = data?.comicInfo?.path || data?.path;
      if (typeof comicPath === 'string' && comicPath.length > 0) {
        progressRecord.comicPath = comicPath;
      }

      progressStore.put(progressRecord);
      updateLibraryProgress(data.id, { lastReadPage: normalizedLastRead, totalPages: prog.totalPages });
    }

    const req = comicsStore.get(idNum);
    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        applyUpdate(data);
      } else {
        const req2 = comicsStore.get(idStr);
        req2.onsuccess = () => applyUpdate(req2.result);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function updateOfflineSeriesStatus(rootFolder, publisher, seriesName, status) {
  const library = state.library || window.library || {};
  const series = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName] || [];
  if (Array.isArray(series)) {
    for (const comic of series) {
      await updateOfflineReadStatus(comic.id, status);
    }
  }
}

export function findComicInLibraryById(targetId) {
  const library = state.library || window.library;
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

export function updateOfflineIndicator() {
  const offlineIndicator = document.getElementById('offline-indicator');
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  
  if (offlineIndicator) {
    if (isOffline) {
      offlineIndicator.classList.remove('hidden');
    } else {
      offlineIndicator.classList.add('hidden');
    }
  }
  
  // Toggle class on body for CSS-based hiding of UI elements
  document.body.classList.toggle('is-offline', isOffline);
}

export async function mergeOfflineStatusesIntoLibrary() {
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || window.db;
  const library = state.library || window.library || {};

  await new Promise(resolve => setTimeout(resolve, 0));

  return new Promise((resolve) => {
    const tx = activeDb.transaction(['statuses', 'progress'], 'readonly');
    const statusStore = tx.objectStore('statuses');
    const progressStore = tx.objectStore('progress');

    const statusRequest = statusStore.getAll();

    statusRequest.onsuccess = (event) => {
      const statuses = event.target.result || [];
      const progressRequest = progressStore.getAll();

      progressRequest.onsuccess = (progressEvent) => {
        const progressData = progressEvent.target.result || [];
        const progressMap = new Map();

        for (const entry of progressData) {
          if (!entry) continue;

          const lastReadPage = (typeof entry.lastReadPage === 'number' && !Number.isNaN(entry.lastReadPage))
            ? entry.lastReadPage
            : (typeof entry.page === 'number' && !Number.isNaN(entry.page) ? entry.page : 0);

          const normalizedProgress = { lastReadPage };

          if (typeof entry.totalPages === 'number' && !Number.isNaN(entry.totalPages)) {
            normalizedProgress.totalPages = entry.totalPages;
          }

          progressMap.set(entry.id, normalizedProgress);
        }

        for (const statusItem of statuses) {
          if (statusItem.type === 'comic') {
            for (const rootFolder in library) {
              for (const publisherName in library[rootFolder].publishers) {
                for (const seriesName in library[rootFolder].publishers[publisherName].series) {
                  const comics = library[rootFolder].publishers[publisherName].series[seriesName];
                  const comic = comics.find(c => c.id === statusItem.comicId);
                  if (comic) {
                    if (!comic.progress) comic.progress = { totalPages: 0, lastReadPage: 0 };

                    const offlineProgress = progressMap.get(comic.id);
                    if (offlineProgress) {
                      comic.progress.lastReadPage = offlineProgress.lastReadPage;
                      if (typeof offlineProgress.totalPages === 'number') {
                        comic.progress.totalPages = offlineProgress.totalPages;
                      }
                    }

                    if (statusItem.status === 'read') {
                      comic.progress.lastReadPage = comic.progress.totalPages - 1;
                    } else if (statusItem.status === 'unread') {
                      comic.progress.lastReadPage = 0;
                    }
                  }
                }
              }
            }
          } else if (statusItem.type === 'series') {
            const rootFolder = statusItem.rootFolder;
            const publisherName = statusItem.publisher;
            const seriesName = statusItem.seriesName;

            if (
              library[rootFolder] &&
              library[rootFolder].publishers[publisherName] &&
              library[rootFolder].publishers[publisherName].series[seriesName]
            ) {
              const comics = library[rootFolder].publishers[publisherName].series[seriesName];

              for (const comic of comics) {
                if (!comic.progress) comic.progress = { totalPages: 0, lastReadPage: 0 };

                const offlineProgress = progressMap.get(comic.id);
                if (offlineProgress) {
                  comic.progress.lastReadPage = offlineProgress.lastReadPage;
                  if (typeof offlineProgress.totalPages === 'number') {
                    comic.progress.totalPages = offlineProgress.totalPages;
                  }
                }

                if (statusItem.status === 'read') {
                  comic.progress.lastReadPage = comic.progress.totalPages - 1;
                } else if (statusItem.status === 'unread') {
                  comic.progress.lastReadPage = 0;
                }
              }
            }
          }
        }

        for (const [comicId, progress] of progressMap.entries()) {
          updateLibraryProgress(comicId, progress.lastReadPage, progress.totalPages);
        }

        resolve();
      };

      progressRequest.onerror = () => resolve();
    };

    statusRequest.onerror = () => resolve();
  });
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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.openOfflineDB) {
      await db.openOfflineDB();
    }
    const activeDb = state.db || window.db;

    await new Promise(resolve => setTimeout(resolve, 0));

    const unsynced = await new Promise((resolve, reject) => {
      const tx = activeDb.transaction(['progress'], 'readonly');
      const store = tx.objectStore('progress');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });

    const syncManager = state.syncManager || window.syncManager;

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

        // Use sync manager for per-device progress tracking
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

export async function syncOfflineStatuses() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || window.db;

  await new Promise(resolve => setTimeout(resolve, 0));

  const timeoutMs = 3000;

  const unsynced = await new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['statuses'], 'readonly');
    const store = tx.objectStore('statuses');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
    req.onerror = () => reject(req.error || new Error('getAll failed'));
  });

  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';

  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < unsynced.length; i += CONCURRENCY_LIMIT) {
    const chunk = unsynced.slice(i, i + CONCURRENCY_LIMIT);
    
    await Promise.all(chunk.map(async (item) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        if (item.type === 'series') {
          await fetch(`${apiBaseUrl}/api/v1/series/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rootFolder: item.rootFolder,
              publisher: item.publisher,
              series: item.seriesName,
              status: item.status,
            }),
            signal: controller.signal,
          });
        } else {
          await fetch(`${apiBaseUrl}/api/v1/comics/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comicId: item.comicId, status: item.status }),
            signal: controller.signal,
          });
        }

        clearTimeout(timeoutId);

        item.synced = true;
        await new Promise((resolve, reject) => {
          const tx2 = activeDb.transaction(['statuses'], 'readwrite');
          tx2.objectStore('statuses').put(item);
          tx2.oncomplete = () => resolve();
          tx2.onerror = () => reject(tx2.error || new Error('put failed'));
        });
      } catch (error) {
        console.error('[OFFLINE] Failed to sync status for item:', item, error);
      }
    }));
  }
}

export async function enhancedBackgroundSync() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    await scheduleOfflineProgressSync(true);
    await syncOfflineStatuses();
  } catch (error) {
    // Handle error silently
  }
}

export const OfflineStatus = {
  PROGRESS_SYNC_DEBOUNCE_MS,
  scheduleOfflineProgressSync,
  syncOfflineProgress,
  syncOfflineStatuses,
  updateLibraryProgress,
  updateOfflineReadStatus,
  updateOfflineSeriesStatus,
  findComicInLibraryById,
  updateOfflineIndicator,
  mergeOfflineStatusesIntoLibrary,
  enhancedBackgroundSync,
  saveStatusToDB,
};

// Expose on state & window for transitional compatibility
state.OfflineStatus = OfflineStatus;
Object.assign(state, OfflineStatus);

if (typeof window !== 'undefined') {
  window.OfflineStatus = OfflineStatus;
  Object.assign(window, OfflineStatus);
}
