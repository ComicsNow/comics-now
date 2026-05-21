import { state } from './globals.js';

// Helper function to update a specific comic's manga mode in the cache
export async function updateMangaModeInCache(comicId, mangaMode) {
  try {
    const loadLibraryCacheFromDB = state.loadLibraryCacheFromDB || window.loadLibraryCacheFromDB;
    if (typeof loadLibraryCacheFromDB !== 'function') {
      return false;
    }

    const cachedRecord = await loadLibraryCacheFromDB();
    if (!cachedRecord || !cachedRecord.data) {
      return false;
    }

    const cachedLibrary = cachedRecord.data;
    let comicFound = false;

    // Find and update the comic in the cached library
    for (const rootFolder of Object.keys(cachedLibrary)) {
      const publishers = cachedLibrary[rootFolder]?.publishers || {};
      for (const publisherName of Object.keys(publishers)) {
        const seriesEntries = publishers[publisherName]?.series || {};
        for (const seriesName of Object.keys(seriesEntries)) {
          const comics = seriesEntries[seriesName];
          if (Array.isArray(comics)) {
            const comic = comics.find(c => c.id === comicId);
            if (comic) {
              comic.mangaMode = mangaMode;
              comicFound = true;
              break;
            }
          }
        }
        if (comicFound) break;
      }
      if (comicFound) break;
    }

    if (!comicFound) {
      return false;
    }

    const saveLibraryCacheToDB = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
    // Save the updated cache back to IndexedDB
    if (typeof saveLibraryCacheToDB === 'function') {
      await saveLibraryCacheToDB(cachedLibrary);
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}

// Update library cache with manga mode changes for given comics
export async function updateLibraryCache(comics, newMode) {
  const saveLibraryCacheToDB = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
  const library = state.library || window.library;
  const estimateLibrarySize = state.estimateLibrarySize || window.estimateLibrarySize;

  if (typeof saveLibraryCacheToDB !== 'function' ||
      typeof library === 'undefined' ||
      typeof estimateLibrarySize !== 'function') {
    return;
  }

  const librarySize = estimateLibrarySize(library);
  const comicArray = Array.isArray(comics) ? comics : [comics];

  if (librarySize > 0) {
    // Library is loaded in memory - save it directly
    await saveLibraryCacheToDB(library).catch(error => {});
  } else {
    // Library NOT loaded - update comics in the cache one by one
    for (const comic of comicArray) {
      await updateMangaModeInCache(comic.id, newMode).catch(error => {});
    }
  }
}

// Toggle manga mode for a comic via API
export async function toggleMangaMode(comicId, currentMode) {
  const newMode = !currentMode;
  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';

  // Try to update via API, but don't fail if offline
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/comics/manga-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comicId,
        mangaMode: newMode
      })
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.message || 'Failed to toggle manga mode');
    }

    return data.mangaMode;
  } catch (error) {
    // If offline or API fails, still allow local manga mode toggle
    return newMode;
  }
}

// Update manga mode UI elements (viewer buttons)
export function updateMangaModeUI(mangaMode) {
  const viewerBtn = document.getElementById('manga-mode-btn');
  const fullscreenBtn = document.getElementById('fullscreen-manga-mode-btn');

  if (viewerBtn) {
    if (mangaMode) {
      viewerBtn.classList.add('active');
    } else {
      viewerBtn.classList.remove('active');
    }
  }

  if (fullscreenBtn) {
    if (mangaMode) {
      fullscreenBtn.classList.add('active');
    } else {
      fullscreenBtn.classList.remove('active');
    }
  }
}

// Get navigation direction based on manga mode
export function getNavigationDirection(originalDirection) {
  const currentComic = state.currentComic || window.currentComic;
  if (!currentComic || !currentComic.mangaMode) {
    return originalDirection;
  }
  // In manga mode, reverse left/right navigation
  return -originalDirection;
}

// Setup click handler for a manga mode button
function setupMangaModeButtonHandler(button) {
  if (!button) return;

  button.addEventListener('click', async () => {
    const currentComic = state.currentComic || window.currentComic;
    if (!currentComic) return;

    try {
      const newMode = await toggleMangaMode(
        currentComic.id,
        currentComic.mangaMode || false
      );

      currentComic.mangaMode = newMode;
      updateMangaModeUI(newMode);

      const updateComicInLibrary = state.updateComicInLibrary || window.updateComicInLibrary;
      // Update the global library object if it exists
      if (typeof updateComicInLibrary === 'function') {
        updateComicInLibrary(currentComic.id, { mangaMode: newMode });
      }

      // Update library cache in IndexedDB
      await updateLibraryCache(currentComic, newMode);

      const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
      const updateDownloadedComicInfo = state.updateDownloadedComicInfo || window.updateDownloadedComicInfo;
      // Update downloaded comic in IndexedDB if it's downloaded
      const isDownloaded = downloadedComicIds?.has(currentComic.id);
      if (isDownloaded && typeof updateDownloadedComicInfo === 'function') {
        try {
          await updateDownloadedComicInfo(currentComic.id, { mangaMode: newMode });
        } catch (error) {
          console.error('[MANGA] Failed to update downloaded comic:', error);
        }
      }

      const updateDownloadedSmartListComic = state.updateDownloadedSmartListComic || window.updateDownloadedSmartListComic;
      // Also update in the downloaded smart list if it exists
      if (typeof updateDownloadedSmartListComic === 'function') {
        updateDownloadedSmartListComic(currentComic.id, { mangaMode: newMode });
      }

      const refreshGuidedToggle = state.refreshGuidedToggle || window.refreshGuidedToggle;
      // Re-evaluate which reading-aid buttons should be visible.
      if (typeof refreshGuidedToggle === 'function') {
        try { await refreshGuidedToggle(); } catch (_) {}
      }
    } catch (error) {
      console.error('[MANGA] Error toggling manga mode:', error);
      alert('Failed to toggle manga mode. Please try again.');
    }
  });
}

// Initialize manga mode handlers
export function initializeMangaMode() {
  // Setup both viewer and fullscreen manga mode buttons
  setupMangaModeButtonHandler(document.getElementById('manga-mode-btn'));
  setupMangaModeButtonHandler(document.getElementById('fullscreen-manga-mode-btn'));
}

export const MangaMode = {
  toggleMangaMode,
  updateMangaModeInCache,
  updateLibraryCache,
  updateMangaModeUI,
  getNavigationDirection,
  initializeMangaMode
};

state.MangaMode = MangaMode;
state.toggleMangaMode = toggleMangaMode;
state.updateMangaModeUI = updateMangaModeUI;
state.getNavigationDirection = getNavigationDirection;
state.initializeMangaMode = initializeMangaMode;

if (typeof window !== 'undefined') {
  window.MangaMode = MangaMode;
  window.toggleMangaMode = toggleMangaMode;
  window.updateMangaModeUI = updateMangaModeUI;
  window.getNavigationDirection = getNavigationDirection;
  window.initializeMangaMode = initializeMangaMode;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMangaMode);
} else {
  initializeMangaMode();
}
