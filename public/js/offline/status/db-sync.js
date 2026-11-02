import { state } from '../../globals.js';
import { updateLibraryProgress } from './progress-sync.js';

export async function saveStatusToDB(item) {
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['statuses'], 'readwrite');
    const store = tx.objectStore('statuses');
    store.put({ ...item, synced: false });
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => reject(event.target.error);
  });
}

export async function updateOfflineReadStatus(comicId, status) {
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) return Promise.resolve();

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
  const library = state.library || (typeof window !== 'undefined' ? window.library : null) || {};
  const series = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName] || [];
  if (Array.isArray(series)) {
    for (const comic of series) {
      await updateOfflineReadStatus(comic.id, status);
    }
  }
}

export async function mergeOfflineStatusesIntoLibrary() {
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) return Promise.resolve();

  const library = state.library || (typeof window !== 'undefined' ? window.library : null) || {};

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

export async function syncOfflineStatuses() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const db = state.OfflineDB || (typeof window !== 'undefined' ? window.OfflineDB : null) || {};
  if (db.openOfflineDB) {
    await db.openOfflineDB();
  }
  const activeDb = state.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) return;

  await new Promise(resolve => setTimeout(resolve, 0));

  const timeoutMs = 3000;

  const unsynced = await new Promise((resolve, reject) => {
    const tx = activeDb.transaction(['statuses'], 'readonly');
    const store = tx.objectStore('statuses');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
    req.onerror = () => reject(req.error || new Error('getAll failed'));
  });

  const apiBaseUrl = state.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';

  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < unsynced.length; i += CONCURRENCY_LIMIT) {
    const chunk = unsynced.slice(i, i + CONCURRENCY_LIMIT);
    
    await Promise.all(chunk.map(async (item) => {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller && typeof setTimeout === 'function' ? setTimeout(() => controller.abort(), timeoutMs) : null;

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
            signal: controller?.signal,
          });
        } else {
          await fetch(`${apiBaseUrl}/api/v1/comics/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comicId: item.comicId, status: item.status }),
            signal: controller?.signal,
          });
        }

        if (timeoutId && typeof clearTimeout === 'function') clearTimeout(timeoutId);

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
