(function (global) {
  'use strict';

  // Shared index for O(1) lookups
  global.comicIdMap = new Map();

  function buildComicIdMap(library) {
    global.comicIdMap.clear();
    if (!library || typeof library !== 'object') return;

    for (const rootFolder of Object.keys(library)) {
      if (rootFolder.startsWith('_')) continue;
      const publishers = library[rootFolder]?.publishers || {};
      for (const publisherName of Object.keys(publishers)) {
        const seriesEntries = publishers[publisherName]?.series || {};
        for (const seriesName of Object.keys(seriesEntries)) {
          const comics = seriesEntries[seriesName];
          if (Array.isArray(comics)) {
            for (const comic of comics) {
              global.comicIdMap.set(comic.id, comic);
            }
          }
        }
      }
    }
  }

  function estimateLibrarySize(library) {
    if (!global.comicIdMap.size && library && typeof library === 'object') {
       buildComicIdMap(library);
    }
    return global.comicIdMap.size;
  }

  async function fetchLibrary() {
    await fetchLibraryFull();
  }

  async function tryProgressiveLoading() {
    try {
      debugLog('LAZY', 'Attempting progressive loading...');
      const response = await fetch(`${API_BASE_URL}/api/v1/comics/structure`);

      if (!response.ok) {
        debugLog('LAZY', 'Progressive loading endpoint not available, falling back to full loading');
        return false;
      }

      global.library = await response.json();
      applyDisplayInfoToLibrary(global.library);
      buildComicIdMap(global.library);

      global.library._isLazyLoaded = true;

      debugLog('LAZY', 'Progressive loading successful');
      return true;
    } catch (error) {
      debugLog('LAZY', 'Progressive loading failed, falling back to full loading:', error);
      return false;
    }
  }

  async function fetchLibraryFull() {
    debugLog('LAZY', 'Using full library loading');
    const response = await fetch(`${API_BASE_URL}/api/v1/comics`);

    if (!response.ok) {
      throw new Error(`Failed to fetch library: ${response.status} ${response.statusText}`);
    }

    global.library = await response.json();
    applyDisplayInfoToLibrary(global.library);
    buildComicIdMap(global.library);

    if (typeof saveLibraryCacheToDB === 'function') {
      try {
        await saveLibraryCacheToDB(global.library);
      } catch (error) {
        console.warn('Failed to save library cache to IndexedDB:', error);
      }
    }

    const librarySize = estimateLibrarySize(global.library);
    if (librarySize > 1000) {
      global.LibraryRender?.applyFilterAndRender?.();
      requestAnimationFrame(() => {
        global.LibrarySmartLists?.rebuildLatestComics?.();
        global.LibrarySmartLists?.rebuildGuidedComics?.();
        global.LibrarySmartLists?.rebuildMangaSmartLists?.();
        requestAnimationFrame(() => {
          if (typeof updateFilterButtonCounts === 'function') {
            updateFilterButtonCounts();
          }
        });
      });
    } else {
      global.LibrarySmartLists?.rebuildLatestComics?.();
      global.LibrarySmartLists?.rebuildGuidedComics?.();
      global.LibrarySmartLists?.rebuildMangaSmartLists?.();
      global.LibraryRender?.applyFilterAndRender?.();
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        backgroundSyncOperations();
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        backgroundSyncOperations();
      }, 50);
    }
  }

  async function ensureSeriesLoaded(rootFolder, publisher, series) {
    if (!global.library._isLazyLoaded) {
      return true;
    }

    try {
      const seriesData = global.library[rootFolder]?.publishers?.[publisher]?.series?.[series];

      if (!seriesData || seriesData._hasDetails) {
        return true;
      }

      debugLog('LAZY', `Loading series details: ${rootFolder}/${publisher}/${series}`);

      const response = await fetch(
        `${API_BASE_URL}/api/v1/comics/series/${encodeURIComponent(rootFolder)}/${encodeURIComponent(publisher)}/${encodeURIComponent(series)}`
      );

      if (!response.ok) {
        console.error(`Failed to load series details: ${response.status}`);
        return false;
      }

      const comics = await response.json();

      global.library[rootFolder].publishers[publisher].series[series] = comics;

      // Update the flat ID map with the new details
      for (const comic of comics) {
        comicIdMap.set(comic.id, comic);
      }

      debugLog('LAZY', `Successfully loaded ${comics.length} comics for series ${series}`);
      return true;
    } catch (error) {
      console.error('Error in ensureSeriesLoaded:', error);
      return false;
    }
  }

  async function getSeriesComics(rootFolder, publisher, series) {
    await ensureSeriesLoaded(rootFolder, publisher, series);

    const seriesData = global.library[rootFolder]?.publishers?.[publisher]?.series?.[series];

    if (Array.isArray(seriesData)) {
      return seriesData;
    } else if (seriesData && seriesData._hasDetails === false) {
      console.warn(`Series data for ${series} exists but has no details`);
      return [];
    }

    return [];
  }

  function updateComicInLibrary(comicId, updates) {
    if (!global.library || typeof global.library !== 'object' || !comicId || !updates) return false;

    try {
      const comic = comicIdMap.get(comicId);
      if (comic) {
        Object.assign(comic, updates);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating comic in library:', error);
      return false;
    }
  }

  async function backgroundSyncOperations() {
    try {
      debugLog('SYNC', 'Starting background sync operations...');

      const syncPromises = [];

      if (typeof window !== 'undefined' && window.syncManager) {
        syncPromises.push(
          window.syncManager.initializeDevice().catch(error => {
            console.error('SyncManager initialization failed:', error);
            return null;
          })
        );
      }

      if (typeof getAllDownloadedComicIds === 'function') {
        syncPromises.push(
          getAllDownloadedComicIds().catch(error => {
            console.error('Failed to get downloaded comic IDs:', error);
            return null;
          })
        );
      }

      if (typeof removeStaleDownloads === 'function') {
        syncPromises.push(
          removeStaleDownloads().catch(error => {
            console.error('Failed to remove stale downloads:', error);
            return null;
          })
        );
      }

      if (typeof rebuildDownloadedComics === 'function') {
        syncPromises.push(
          rebuildDownloadedComics({ skipRender: true }).catch(error => {
            console.error('Failed to rebuild downloaded comics:', error);
            return null;
          })
        );
      }

      await Promise.allSettled(syncPromises);

      if (typeof updateFilterButtonCounts === 'function') {
        updateFilterButtonCounts();
      }

      if (['root', 'publisher', 'series', 'search', 'latest', 'downloaded', 'guided', 'manga'].includes(currentView)) {
        requestAnimationFrame(() => {
          global.LibraryRender?.applyFilterAndRender?.();
        });
      }

      debugLog('SYNC', 'Background sync operations completed');
    } catch (error) {
      console.error('Fatal error in background sync:', error);
    }
  }

  const LibraryData = {
    estimateLibrarySize,
    fetchLibrary,
    tryProgressiveLoading,
    fetchLibraryFull,
    ensureSeriesLoaded,
    getSeriesComics,
    updateComicInLibrary,
    backgroundSyncOperations,
  };

  global.LibraryData = LibraryData;
  Object.assign(global, LibraryData);
})(typeof window !== 'undefined' ? window : globalThis);
