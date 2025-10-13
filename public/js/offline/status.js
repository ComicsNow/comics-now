(function (global) {
  'use strict';

  const OfflineDB = global.OfflineDB || {};
  const {
    openOfflineDB,
    getOfflineComicRecordById,
    loadLibraryCacheFromDB,
  } = OfflineDB;

  const PROGRESS_SYNC_DEBOUNCE_MS = 400;
  let progressSyncTimerId = null;
  let progressSyncInProgress = false;
  let progressSyncNeedsRun = false;
  let progressSyncPromise = null;

  function scheduleOfflineProgressSync(immediate = false) {
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

  async function saveStatusToDB(item) {
    await openOfflineDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['statuses'], 'readwrite');
      const store = tx.objectStore('statuses');
      store.put({ ...item, synced: false });
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
  }

  function updateLibraryProgress(comicId, page, totalPages) {
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

  async function updateOfflineReadStatus(comicId, status) {
    await openOfflineDB();
    const idNum = typeof comicId === 'number' ? comicId : Number(comicId);
    const idStr = String(comicId);
    return new Promise(resolve => {
      const tx = db.transaction(['comics', 'progress'], 'readwrite');
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

  async function updateOfflineSeriesStatus(rootFolder, publisher, seriesName, status) {
    const series = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName] || [];
    if (Array.isArray(series)) {
      for (const comic of series) {
        await updateOfflineReadStatus(comic.id, status);
      }
    } else if (series && series._hasDetails === false) {
      
    }
  }

  function findComicInLibraryById(targetId) {
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

  function updateOfflineIndicator() {
    const offlineIndicator = document.getElementById('offline-indicator');
    if (offlineIndicator) {
      if (navigator.onLine === false) {
        offlineIndicator.classList.remove('hidden');
      } else {
        offlineIndicator.classList.add('hidden');
      }
    }
  }

  async function mergeOfflineStatusesIntoLibrary() {
    await openOfflineDB();

    await new Promise(resolve => setTimeout(resolve, 0));

    return new Promise((resolve) => {
      const tx = db.transaction(['statuses', 'progress'], 'readonly');
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

  async function syncOfflineProgress() {
    if (progressSyncInProgress) {
      progressSyncNeedsRun = true;
      return progressSyncPromise || Promise.resolve();
    }

    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      progressSyncNeedsRun = true;
      return;
    }

    const timeoutMs = 3000;

    progressSyncInProgress = true;
    progressSyncNeedsRun = false;

    progressSyncPromise = (async () => {
      await openOfflineDB();

      await new Promise(resolve => setTimeout(resolve, 0));

      const unsynced = await new Promise((resolve, reject) => {
        const tx = db.transaction(['progress'], 'readonly');
        const store = tx.objectStore('progress');
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
        req.onerror = () => reject(req.error || new Error('getAll failed'));
      });

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

          if (!comicPath) {
            const offlineRecord = await getOfflineComicRecordById(item.id);
            if (offlineRecord && offlineRecord.comicInfo) {
              comicPath = offlineRecord.comicInfo.path || offlineRecord.comicInfo.filePath || offlineRecord.path || null;
            }
          }

          if (!comicPath) {
            debugLog('OFFLINE', `Comic with ID ${item.id} not found in library or offline cache, cleaning up progress entry`);
            await new Promise((resolve, reject) => {
              const tx2 = db.transaction(['progress'], 'readwrite');
              tx2.objectStore('progress').delete(item.id);
              tx2.oncomplete = () => resolve();
              tx2.onerror = () => reject(tx2.error || new Error('delete failed'));
            });
            continue;
          }

          // Use sync manager for per-device progress tracking
          if (window.syncManager && window.syncManager.deviceId) {
            try {
              await window.syncManager.updateProgress(item.id, pageValue);
              
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
            const tx2 = db.transaction(['progress'], 'readwrite');
            tx2.objectStore('progress').put(item);
            tx2.oncomplete = () => resolve();
            tx2.onerror = () => reject(tx2.error || new Error('put failed'));
          });
        } catch (error) {
          
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

  async function syncOfflineStatuses() {
    if (!navigator.onLine) return;
    await openOfflineDB();

    await new Promise(resolve => setTimeout(resolve, 0));

    const timeoutMs = 3000;

    const unsynced = await new Promise((resolve, reject) => {
      const tx = db.transaction(['statuses'], 'readonly');
      const store = tx.objectStore('statuses');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter(i => !i.synced));
      req.onerror = () => reject(req.error || new Error('getAll failed'));
    });

    for (const item of unsynced) {
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        if (item.type === 'series') {
          await fetch(`${API_BASE_URL}/api/v1/series/status`, {
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
          await fetch(`${API_BASE_URL}/api/v1/comics/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comicId: item.comicId, status: item.status }),
            signal: controller.signal,
          });
        }

        clearTimeout(timeoutId);

        item.synced = true;
        await new Promise((resolve, reject) => {
          const tx2 = db.transaction(['statuses'], 'readwrite');
          tx2.objectStore('statuses').put(item);
          tx2.oncomplete = () => resolve();
          tx2.onerror = () => reject(tx2.error || new Error('put failed'));
        });
      } catch (error) {
        
      }
    }
  }

  async function enhancedBackgroundSync() {
    try {
      

      if (navigator.onLine === false) {
        
        return;
      }

      if (typeof scheduleOfflineProgressSync === 'function') {
        await scheduleOfflineProgressSync(true);
      }

      if (typeof syncOfflineStatuses === 'function') {
        await syncOfflineStatuses();
      }

      let cacheTimestamp = null;
      if (typeof loadLibraryCacheFromDB === 'function') {
        try {
          const cachedRecord = await loadLibraryCacheFromDB();
          cacheTimestamp = cachedRecord?.timestamp || null;
        } catch (error) {
          
        }
      }

      const now = Date.now();
      const cacheAge = cacheTimestamp ? now - cacheTimestamp : Infinity;

      if (cacheAge > 5 * 60 * 1000) {
        
        if (typeof global.fetchLibraryFromServer === 'function') {
          await global.fetchLibraryFromServer();
        }
      }

      
    } catch (error) {
      
    }
  }

  const OfflineStatus = {
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

  global.OfflineStatus = OfflineStatus;
  Object.assign(global, OfflineStatus);
})(typeof window !== 'undefined' ? window : globalThis);
