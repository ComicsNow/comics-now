import {
  state,
  debugLog
} from '../globals.js';

async function callOpenOfflineDB() {
  const fn = state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null);
  if (typeof fn === 'function') return await fn();
  if (typeof debugLog === 'function') debugLog('PROGRESS', 'openOfflineDB not available');
}

function callScheduleOfflineProgressSync(immediate = false) {
  const fn = state?.scheduleOfflineProgressSync || (typeof window !== 'undefined' ? window.scheduleOfflineProgressSync : null);
  if (typeof fn === 'function') fn(immediate);
}

async function callGetSeriesComics(rootFolder, publisher, series) {
  const fn = state?.getSeriesComics || (typeof window !== 'undefined' ? window.getSeriesComics : null);
  if (typeof fn === 'function') return await fn(rootFolder, publisher, series);
  return [];
}

// Save progress to IndexedDB (for downloaded comics)
export async function saveProgressToDB(comicId, currentPage, totalPages, comicPath) {
  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) {
    if (typeof debugLog === 'function') debugLog('PROGRESS', 'IndexedDB not initialized, opening connection...');
    await callOpenOfflineDB();
  }

  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    throw new Error('IndexedDB connection could not be opened');
  }

  const normalizedPage = typeof currentPage === 'number' && !Number.isNaN(currentPage)
    ? currentPage
    : 0;
  const progressData = {
    id: comicId,
    lastReadPage: normalizedPage,
    page: normalizedPage,
    synced: false,
    updatedAt: new Date().toISOString()
  };

  if (typeof totalPages === 'number' && !Number.isNaN(totalPages)) {
    progressData.totalPages = totalPages;
  }

  if (typeof comicPath === 'string' && comicPath.length > 0) {
    progressData.comicPath = comicPath;
  }

  if (typeof debugLog === 'function') debugLog('PROGRESS', 'Saving to IndexedDB:', progressData);

  return new Promise((resolve, reject) => {
    try {
      const transaction = dbToUse.transaction(['progress', 'comics'], 'readwrite');
      const progressStore = transaction.objectStore('progress');
      const comicsStore = transaction.objectStore('comics');

      const keysToUpdate = [];
      if (comicId !== undefined && comicId !== null) {
        keysToUpdate.push(comicId);
        const idStr = String(comicId);
        if (!keysToUpdate.some(key => key === idStr)) {
          keysToUpdate.push(idStr);
        }
        const idNum = Number(idStr);
        if (!Number.isNaN(idNum) && !keysToUpdate.some(key => key === idNum)) {
          keysToUpdate.push(idNum);
        }
      }

      progressStore.put(progressData);

      const updateNextComicRecord = (index = 0) => {
        if (index >= keysToUpdate.length) {
          return;
        }

        let request;
        try {
          request = comicsStore.get(keysToUpdate[index]);
        } catch (error) {
          updateNextComicRecord(index + 1);
          return;
        }

        request.onsuccess = () => {
          const comicData = request.result;
          if (comicData && comicData.comicInfo) {
            if (!comicData.comicInfo.progress) {
              comicData.comicInfo.progress = {};
            }
            comicData.comicInfo.progress.lastReadPage = normalizedPage;
            if (typeof totalPages === 'number' && !Number.isNaN(totalPages)) {
              comicData.comicInfo.progress.totalPages = totalPages;
            }
            if (typeof comicPath === 'string' && comicPath.length > 0) {
              comicData.comicInfo.path = comicPath;
            }
            try {
              comicsStore.put(comicData);
            } catch (error) {
              // Ignore inner errors
            }
          } else {
            updateNextComicRecord(index + 1);
          }
        };

        request.onerror = () => {
          updateNextComicRecord(index + 1);
        };
      };

      updateNextComicRecord();

      transaction.oncomplete = () => {
        if (typeof debugLog === 'function') debugLog('PROGRESS', `Successfully saved progress to IndexedDB for comic ${comicId}`);
        callScheduleOfflineProgressSync(true);
        resolve();
      };

      transaction.onerror = (event) => {
        reject(new Error('IndexedDB transaction failed: ' + event.target.error));
      };
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to update offline progress data for downloaded comics
export async function updateOfflineProgressForComic(comicId, status) {
  const activeDb = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!activeDb) await callOpenOfflineDB();

  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) return;

  let actualTotalPages = 0;
  const library = state?.library;

  if (library) {
    for (const rootFolder in library) {
      if (!library[rootFolder] || !library[rootFolder].publishers) continue;
      for (const publisherName in library[rootFolder].publishers) {
        for (const seriesName in library[rootFolder].publishers[publisherName].series) {
          const comics = library[rootFolder].publishers[publisherName].series[seriesName];

          if (Array.isArray(comics)) {
            const comic = comics.find(c => c.id === comicId);
            if (comic && comic.progress) {
              actualTotalPages = comic.progress.totalPages || 0;
              break;
            }
          }
        }
      }
    }
  }

  const lastReadPage = status === 'read'
    ? Math.max(0, actualTotalPages - 1)
    : 0;

  const progressData = {
    id: comicId,
    lastReadPage,
    page: lastReadPage,
    totalPages: actualTotalPages,
    synced: false,
    updatedAt: new Date().toISOString()
  };

  return new Promise((resolve) => {
    const tx = dbToUse.transaction(['progress'], 'readwrite');
    const store = tx.objectStore('progress');
    const request = store.put(progressData);
    request.onsuccess = () => {
      callScheduleOfflineProgressSync(true);
      resolve();
    };
    request.onerror = () => {
      resolve(); // Don't fail the whole operation
    };
  });
}

// Helper function to update offline progress data for all comics in a series
export async function updateOfflineProgressForSeries(rootFolder, publisher, seriesName, status) {
  const hasDb = !!(state?.db || (typeof window !== 'undefined' ? window.db : null));
  if (!hasDb || !state?.library) return;

  const seriesComics = state.library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
  if (!seriesComics) return;

  if (Array.isArray(seriesComics)) {
    for (const comic of seriesComics) {
      await updateOfflineProgressForComic(comic.id, status);
    }
  } else if (seriesComics && seriesComics._hasDetails === false) {
    const detailedComics = await callGetSeriesComics(rootFolder, publisher, seriesName);
    if (Array.isArray(detailedComics)) {
      for (const comic of detailedComics) {
        await updateOfflineProgressForComic(comic.id, status);
      }
    }
  }
}
