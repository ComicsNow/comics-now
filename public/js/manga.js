/**
 * Manga Mode - Functionality for manga-style reading (right-to-left navigation)
 */
(function (global) {
  'use strict';

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  /**
   * Helper function to update a specific comic's manga mode in the cache
   * @param {string} comicId - The comic ID to update
   * @param {boolean} mangaMode - The new manga mode value
   * @returns {Promise<boolean>} - Success status
   */
  async function updateMangaModeInCache(comicId, mangaMode) {
    try {
      // Load the library cache from IndexedDB
      if (typeof global.loadLibraryCacheFromDB !== 'function') {
        return false;
      }

      const cachedRecord = await global.loadLibraryCacheFromDB();
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

      // Save the updated cache back to IndexedDB
      if (typeof global.saveLibraryCacheToDB === 'function') {
        await global.saveLibraryCacheToDB(cachedLibrary);
        return true;
      }

      return false;
    } catch (error) {

      return false;
    }
  }

  /**
   * Update library cache with manga mode changes for given comics
   * @param {Array|Object} comics - Single comic or array of comics to update in cache
   * @param {boolean} newMode - The new manga mode value
   */
  async function updateLibraryCache(comics, newMode) {
    if (typeof global.saveLibraryCacheToDB !== 'function' ||
        typeof global.library === 'undefined' ||
        typeof global.estimateLibrarySize !== 'function') {
      return;
    }

    const librarySize = global.estimateLibrarySize(global.library);
    const comicArray = Array.isArray(comics) ? comics : [comics];

    if (librarySize > 0) {
      // Library is loaded in memory - save it directly
      await global.saveLibraryCacheToDB(global.library).catch(error => {});
    } else {
      // Library NOT loaded - update comics in the cache one by one
      for (const comic of comicArray) {
        await updateMangaModeInCache(comic.id, newMode).catch(error => {});
      }
    }
  }

  // ============================================================================
  // MANGA MODE API
  // ============================================================================

  /**
   * Toggle manga mode for a comic via API
   * @param {string} comicId - The comic ID
   * @param {boolean} currentMode - The current manga mode value
   * @returns {Promise<boolean>} - The new manga mode value
   */
  async function toggleMangaMode(comicId, currentMode) {
    const newMode = !currentMode;

    // Try to update via API, but don't fail if offline
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/comics/manga-mode`, {
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
      console.log('[MANGA] API call failed, using local manga mode toggle:', error.message);
      return newMode;
    }
  }

  // ============================================================================
  // UI FUNCTIONS
  // ============================================================================

  /**
   * Update manga mode UI elements (viewer buttons)
   * @param {boolean} mangaMode - The manga mode state
   */
  function updateMangaModeUI(mangaMode) {
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

  /**
   * Get navigation direction based on manga mode
   * In manga mode, navigation is reversed (right-to-left)
   * @param {number} originalDirection - The original direction (-1 or 1)
   * @returns {number} - The adjusted direction
   */
  function getNavigationDirection(originalDirection) {
    if (!global.currentComic || !global.currentComic.mangaMode) {
      return originalDirection;
    }
    // In manga mode, reverse left/right navigation
    return -originalDirection;
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Setup click handler for a manga mode button
   * @param {HTMLElement} button - The button element to attach handler to
   */
  function setupMangaModeButtonHandler(button) {
    if (!button) return;

    button.addEventListener('click', async () => {
      if (!global.currentComic) return;

      try {
        const newMode = await toggleMangaMode(
          global.currentComic.id,
          global.currentComic.mangaMode || false
        );

        global.currentComic.mangaMode = newMode;
        updateMangaModeUI(newMode);

        // Update the global library object if it exists
        if (typeof global.updateComicInLibrary === 'function') {
          global.updateComicInLibrary(global.currentComic.id, { mangaMode: newMode });
        }

        // Update library cache in IndexedDB
        await updateLibraryCache(global.currentComic, newMode);

        // Update downloaded comic in IndexedDB if it's downloaded
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id);
        if (isDownloaded && typeof global.updateDownloadedComicInfo === 'function') {
          try {
            await global.updateDownloadedComicInfo(global.currentComic.id, { mangaMode: newMode });
            console.log('[MANGA] Updated downloaded comic manga mode in IndexedDB');
          } catch (error) {
            console.error('[MANGA] Failed to update downloaded comic:', error);
          }
        }

        // Also update in the downloaded smart list if it exists
        if (typeof global.updateDownloadedSmartListComic === 'function') {
          global.updateDownloadedSmartListComic(global.currentComic.id, { mangaMode: newMode });
        }
      } catch (error) {
        console.error('[MANGA] Error toggling manga mode:', error);
        alert('Failed to toggle manga mode. Please try again.');
      }
    });
  }

  /**
   * Initialize manga mode handlers
   * Sets up event listeners on manga mode buttons
   */
  function initializeMangaMode() {
    // Setup both viewer and fullscreen manga mode buttons
    setupMangaModeButtonHandler(document.getElementById('manga-mode-btn'));
    setupMangaModeButtonHandler(document.getElementById('fullscreen-manga-mode-btn'));
  }

  // ============================================================================
  // EXPOSE PUBLIC API
  // ============================================================================

  global.MangaMode = {
    toggleMangaMode,
    updateMangaModeInCache,
    updateLibraryCache,
    updateMangaModeUI,
    getNavigationDirection,
    initializeMangaMode
  };

  // Legacy global scope exposure (for backward compatibility)
  global.toggleMangaMode = toggleMangaMode;
  global.updateMangaModeUI = updateMangaModeUI;
  global.getNavigationDirection = getNavigationDirection;
  global.initializeMangaMode = initializeMangaMode;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMangaMode);
  } else {
    initializeMangaMode();
  }

})(typeof window !== 'undefined' ? window : globalThis);
