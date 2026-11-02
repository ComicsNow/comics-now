import { state, actions } from '../globals.js';
import { saveProgressToDB, updateLibraryProgress } from '../progress.js';
import { continuousState, isEinkActive } from './state.js';

/**
 * Update continuous mode button UI state
 * @param {boolean} isActive - Whether continuous mode is active
 */
export function updateContinuousModeUI(isActive) {
  const buttons = [
    document.getElementById('continuous-mode-btn'),
    document.getElementById('fullscreen-continuous-mode-btn')
  ];

  buttons.forEach(btn => {
    if (!btn) return;

    if (isActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Setup scroll event listener for progress tracking
 */
export function setupScrollProgressTracking() {
  if (!continuousState.continuousContainer) return;

  const handleScroll = () => {
    clearTimeout(continuousState.scrollTimeout);
    continuousState.scrollTimeout = setTimeout(async () => {
      await updateCurrentPageFromScroll();
    }, 200);
  };

  continuousState.continuousContainer.addEventListener('scroll', handleScroll);
}

/**
 * Update current page index based on scroll position
 */
export async function updateCurrentPageFromScroll() {
  const continuousContainer = continuousState.continuousContainer;
  if (!continuousContainer) return;

  if (continuousState.isInitializingScroll) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) return;

  const viewportMiddle = window.innerHeight / 2;
  let closestPage = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = pageIndex;
    }
  });

  if (state.currentPageIndex !== closestPage) {
    const actionsRef = (typeof actions !== 'undefined' ? actions : (typeof state !== 'undefined' ? state?.actions : null));
    if (actionsRef?.viewer?.setPageIndex) {
      actionsRef.viewer.setPageIndex(closestPage, { source: 'continuous_scroll', triggerFlash: isEinkActive() });
    } else {
      state.currentPageIndex = closestPage;
      if (isEinkActive()) {
        const triggerEinkFlash = state.triggerEinkFlash || (typeof window !== 'undefined' ? window.triggerEinkFlash : null);
        if (typeof triggerEinkFlash === 'function') {
          triggerEinkFlash();
        }
      }
    }

    const getViewerPages = state.getViewerPages || window.getViewerPages;
    const pages = getViewerPages?.() || [];
    const updateViewerPageCounter = state.updateViewerPageCounter || window.updateViewerPageCounter;
    if (typeof updateViewerPageCounter === 'function') {
      updateViewerPageCounter(pages);
    }

    // Keep the page scrubber slider/readout in sync with scroll position.
    const updateReaderScrubberStatus = state.updateReaderScrubberStatus || window.updateReaderScrubberStatus;
    if (typeof updateReaderScrubberStatus === 'function') {
      updateReaderScrubberStatus(closestPage + 1, pages.length);
    }

    const currentComic = state.currentComic || window.currentComic;
    const getComicFromDB = state.getComicFromDB || window.getComicFromDB;
    const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
    const updateLibraryProgressFn = state.updateLibraryProgress || (typeof updateLibraryProgress === 'function' ? updateLibraryProgress : null);

    try {
      const comicFromDB = await getComicFromDB?.(currentComic.id);
      const isDownloaded = downloadedComicIds?.has(currentComic.id) || !!comicFromDB;

      if (isDownloaded) {
        try {
          if (typeof saveProgressToDB === 'function') {
            await saveProgressToDB(
              currentComic.id,
              closestPage,
              currentComic.progress?.totalPages,
              currentComic.path,
            );
          }
        } catch (error) {
          console.error('[CONTINUOUS] Failed to save to IndexedDB:', error);
        }

        if (!currentComic.progress) {
          currentComic.progress = { totalPages: 0, lastReadPage: 0 };
        }
        currentComic.progress.lastReadPage = closestPage;
        downloadedComicIds?.add(currentComic.id);
        updateLibraryProgressFn?.(currentComic.id, closestPage, currentComic.progress.totalPages);

        const saveProgress = state.saveProgress || window.saveProgress;
        if (typeof navigator !== 'undefined' && navigator.onLine && typeof saveProgress === 'function') {
          saveProgress(closestPage);
        }
      } else {
        const saveProgress = state.saveProgress || window.saveProgress;
        if (typeof saveProgress === 'function') {
          saveProgress(closestPage);
        }
        if (updateLibraryProgressFn) {
          updateLibraryProgressFn(currentComic.id, closestPage, currentComic.progress?.totalPages);
        }
      }
    } catch (error) {
      console.error('[CONTINUOUS] Error saving progress:', error);
    }
  }
}

/**
 * Scroll to the next page in continuous mode
 */
export function scrollToNextPage() {
  const continuousContainer = continuousState.continuousContainer;
  if (!continuousContainer) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) {
    return;
  }

  const viewportMiddle = window.innerHeight / 2;
  let currentPageIndex = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      currentPageIndex = pageIndex;
    }
  });

  const isEink = isEinkActive();
  const behavior = isEink ? 'instant' : 'smooth';

  const nextPageIndex = currentPageIndex + 1;
  const nextContainer = continuousContainer.querySelector(
    `.page-container[data-index="${nextPageIndex}"]`
  );

  if (nextContainer) {
    nextContainer.scrollIntoView({ behavior, block: 'center' });
  } else {
    continuousContainer.scrollTo({
      top: continuousContainer.scrollHeight,
      behavior
    });
  }

  if (isEink) {
    const triggerEinkFlash = state.triggerEinkFlash || (typeof window !== 'undefined' ? window.triggerEinkFlash : null);
    if (typeof triggerEinkFlash === 'function') {
      triggerEinkFlash();
    }
  }
}

/**
 * Scroll to the previous page in continuous mode
 */
export function scrollToPreviousPage() {
  const continuousContainer = continuousState.continuousContainer;
  if (!continuousContainer) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) {
    return;
  }

  const viewportMiddle = window.innerHeight / 2;
  let currentPageIndex = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      currentPageIndex = pageIndex;
    }
  });

  const isEink = isEinkActive();
  const behavior = isEink ? 'instant' : 'smooth';

  const prevPageIndex = currentPageIndex - 1;
  const prevContainer = continuousContainer.querySelector(
    `.page-container[data-index="${prevPageIndex}"]`
  );

  if (prevContainer) {
    prevContainer.scrollIntoView({ behavior, block: 'center' });
  } else {
    continuousContainer.scrollTo({
      top: 0,
      behavior
    });
  }

  if (isEink) {
    const triggerEinkFlash = state.triggerEinkFlash || (typeof window !== 'undefined' ? window.triggerEinkFlash : null);
    if (typeof triggerEinkFlash === 'function') {
      triggerEinkFlash();
    }
  }
}

/**
 * Update continuous mode in cache (IndexedDB)
 * @param {string} comicId - Comic ID
 * @param {boolean} continuousMode - New continuous mode value
 * @returns {Promise<boolean>} - Success status
 */
export async function updateContinuousModeInCache(comicId, continuousMode) {
  try {
    const loadLibraryCacheFromDB = state.loadLibraryCacheFromDB || window.loadLibraryCacheFromDB;
    if (typeof loadLibraryCacheFromDB !== 'function') {
      return false;
    }

    const cachedRecord = await loadLibraryCacheFromDB();
    if (!cachedRecord?.data) return false;

    const cachedLibrary = cachedRecord.data;
    let comicFound = false;

    for (const rootFolder of Object.keys(cachedLibrary)) {
      const publishers = cachedLibrary[rootFolder]?.publishers || {};
      for (const publisherName of Object.keys(publishers)) {
        const seriesEntries = publishers[publisherName]?.series || {};
        for (const seriesName of Object.keys(seriesEntries)) {
          const comics = seriesEntries[seriesName];
          if (Array.isArray(comics)) {
            const comic = comics.find(c => c.id === comicId);
            if (comic) {
              comic.continuousMode = continuousMode;
              comicFound = true;
              break;
            }
          }
        }
        if (comicFound) break;
      }
      if (comicFound) break;
    }

    const saveLibraryCacheToDB = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
    if (comicFound && typeof saveLibraryCacheToDB === 'function') {
      await saveLibraryCacheToDB(cachedLibrary);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[CONTINUOUS] Cache update failed:', error);
    return false;
  }
}
