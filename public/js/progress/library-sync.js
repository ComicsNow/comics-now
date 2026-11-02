import {
  state,
  debugLog,
  applyDisplayInfoToComic
} from '../globals.js';

function callInvalidateFolderCache() {
  const fn = state?.invalidateFolderCache || (typeof window !== 'undefined' ? window.invalidateFolderCache : null);
  if (typeof fn === 'function') fn();
}

function callGetComicStatus(comic) {
  const fn = state?.getComicStatus || (typeof window !== 'undefined' ? window.getComicStatus : null);
  if (typeof fn === 'function') return fn(comic);
  return 'unread';
}

function callUpdateFilterButtonCounts() {
  const fn = state?.updateFilterButtonCounts || (typeof window !== 'undefined' ? window.updateFilterButtonCounts : null);
  if (typeof fn === 'function') fn();
}

function callUpdateDownloadedComicProgressData(comicId, progress) {
  const fn = state?.updateDownloadedComicProgressData || (typeof window !== 'undefined' ? window.updateDownloadedComicProgressData : null);
  if (typeof fn === 'function') fn(comicId, progress);
}

function callRenderDownloadedSmartList() {
  const fn = state?.renderDownloadedSmartList || (typeof window !== 'undefined' ? window.renderDownloadedSmartList : null);
  if (typeof fn === 'function') fn();
}

function callApplyFilterAndRender() {
  const fn = state?.applyFilterAndRender || (typeof window !== 'undefined' ? window.applyFilterAndRender : null);
  if (typeof fn === 'function') fn();
}

function callUpdateCardBanner(comicId, updatedStatus) {
  const fn = state?.updateCardBanner || (typeof window !== 'undefined' ? window.updateCardBanner : null);
  if (typeof fn === 'function') fn(comicId, updatedStatus);
}

// Update lazy loading counts when comic status changes
export function updateLazyLoadingCounts(rootFolder, publisher, seriesName, oldStatus, newStatus) {
  if (!state?.library || !state.library._isLazyLoaded) return;

  const seriesData = state.library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
  const publisherData = state.library[rootFolder]?.publishers?.[publisher];

  if (seriesData && seriesData._counts) {
    if (oldStatus && seriesData._counts[oldStatus] > 0) {
      seriesData._counts[oldStatus]--;
    }
    if (newStatus) {
      seriesData._counts[newStatus]++;
    }

    if (publisherData && publisherData._counts) {
      if (oldStatus && publisherData._counts[oldStatus] > 0) {
        publisherData._counts[oldStatus]--;
      }
      if (newStatus) {
        publisherData._counts[newStatus]++;
      }
    }
  }
}

// Update the in-memory library with new progress data
export function updateLibraryProgress(comicId, progressData, maybeTotalPages) {
  if (!state?.library) return;

  const targetId = comicId == null ? null : String(comicId);
  if (!targetId) return;

  let lastReadPage;
  let totalPages;

  if (progressData && typeof progressData === 'object') {
    if (typeof progressData.lastReadPage === 'number' && !Number.isNaN(progressData.lastReadPage)) {
      lastReadPage = progressData.lastReadPage;
    } else if (typeof progressData.page === 'number' && !Number.isNaN(progressData.page)) {
      lastReadPage = progressData.page;
    }

    if (typeof progressData.totalPages === 'number' && !Number.isNaN(progressData.totalPages)) {
      totalPages = progressData.totalPages;
    }
  } else if (typeof progressData === 'number' && !Number.isNaN(progressData)) {
    lastReadPage = progressData;
    if (typeof maybeTotalPages === 'number' && !Number.isNaN(maybeTotalPages)) {
      totalPages = maybeTotalPages;
    }
  }

  if (typeof lastReadPage !== 'number') {
    const sessionSavedPage = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`progress_${targetId}`) : null;
    if (sessionSavedPage !== null && (targetId.startsWith('device-') || targetId.startsWith('upload-'))) {
      lastReadPage = parseInt(sessionSavedPage, 10);
    } else {
      lastReadPage = 0;
    }
  }

  callInvalidateFolderCache();

  const numericTarget = Number(targetId);
  const hasNumericTarget = !Number.isNaN(numericTarget);

  for (const rootDir in state.library) {
    const publishers = state.library[rootDir]?.publishers;
    if (!publishers) continue;

    for (const publisherName in publishers) {
      const seriesCollection = publishers[publisherName]?.series;
      if (!seriesCollection) continue;

      for (const seriesName in seriesCollection) {
        const comics = seriesCollection[seriesName];
        if (!Array.isArray(comics)) continue;

        const comic = comics.find(c => {
          const comicIdValue = c?.id;
          if (comicIdValue == null) return false;
          if (String(comicIdValue) === targetId) return true;
          if (!hasNumericTarget) return false;
          const comicNum = Number(comicIdValue);
          return !Number.isNaN(comicNum) && comicNum === numericTarget;
        });

        if (comic) {
          const previousStatus = callGetComicStatus(comic);
          if (!comic.progress) {
            comic.progress = { totalPages: 0, lastReadPage: 0 };
          }

          comic.progress.lastReadPage = lastReadPage;

          if (typeof totalPages === 'number') {
            comic.progress.totalPages = totalPages;
          } else if (typeof maybeTotalPages === 'number' && !Number.isNaN(maybeTotalPages)) {
            comic.progress.totalPages = maybeTotalPages;
          }

          const updatedStatus = callGetComicStatus(comic);
          if (previousStatus !== updatedStatus) {
            updateLazyLoadingCounts(rootDir, publisherName, seriesName, previousStatus, updatedStatus);
            callUpdateFilterButtonCounts();
            callUpdateCardBanner(comicId, updatedStatus);
            callApplyFilterAndRender();
          }

          const applyDisplay = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic : (c) => c;
          const updatedName = comic.displayName || (applyDisplay(comic).displayTitle);
          if (typeof debugLog === 'function') debugLog('PROGRESS', `Updated library progress for ${updatedName}`);

          callUpdateDownloadedComicProgressData(comic.id ?? targetId, {
            lastReadPage,
            totalPages: comic.progress.totalPages,
          });

          if (state.currentView === 'downloaded') {
            callRenderDownloadedSmartList();
          }
          return;
        }
      }
    }
  }
}
