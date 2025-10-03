(function (global) {
  'use strict';

  function estimateLibrarySize(library) {
    if (!library || typeof library !== 'object') return 0;

    let totalComics = 0;
    for (const rootFolder of Object.keys(library)) {
      const publishers = library[rootFolder]?.publishers || {};
      for (const publisherName of Object.keys(publishers)) {
        const seriesEntries = publishers[publisherName]?.series || {};
        for (const seriesName of Object.keys(seriesEntries)) {
          const comics = seriesEntries[seriesName];
          if (Array.isArray(comics)) {
            totalComics += comics.length;
          }
        }
      }
    }
    return totalComics;
  }

  async function fetchLibrary() {
    await loadLibraryOfflineFirst();
  }

  async function tryProgressiveLoading() {
    try {
      debugLog('LAZY', 'Attempting progressive loading...');
      const response = await fetch(`${API_BASE_URL}/api/v1/comics/structure`);

      if (!response.ok) {
        debugLog('LAZY', 'Progressive loading endpoint not available, falling back to full loading');
        return false;
      }

      library = await response.json();
      applyDisplayInfoToLibrary(library);

      library._isLazyLoaded = true;

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
    library = await response.json();
    applyDisplayInfoToLibrary(library);

    if (typeof saveLibraryCacheToDB === 'function') {
      try {
        await saveLibraryCacheToDB(library);
      } catch (error) {
        console.warn('Failed to cache library data in IndexedDB:', error);
      }
    }

    const librarySize = estimateLibrarySize(library);
    if (librarySize > 1000) {
      global.LibraryRender?.applyFilterAndRender?.();
      requestAnimationFrame(() => {
        global.LibrarySmartLists?.rebuildLatestComics?.();
        global.LibrarySmartLists?.rebuildLatestConvertedComics?.();
        requestAnimationFrame(() => {
          if (typeof updateFilterButtonCounts === 'function') {
            updateFilterButtonCounts();
          }
        });
      });
    } else {
      global.LibrarySmartLists?.rebuildLatestComics?.();
      global.LibrarySmartLists?.rebuildLatestConvertedComics?.();
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
    if (!library._isLazyLoaded) {
      return true;
    }

    try {
      const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[series];

      if (!seriesData || seriesData._hasDetails) {
        return true;
      }

      debugLog('LAZY', `Loading series details: ${rootFolder}/${publisher}/${series}`);

      const response = await fetch(
        `${API_BASE_URL}/api/v1/comics/series/${encodeURIComponent(rootFolder)}/${encodeURIComponent(publisher)}/${encodeURIComponent(series)}`
      );

      if (!response.ok) {
        console.warn('Failed to load series details, falling back to existing data');
        return false;
      }

      const comics = await response.json();

      library[rootFolder].publishers[publisher].series[series] = comics;

      debugLog('LAZY', `Successfully loaded ${comics.length} comics for series ${series}`);
      return true;
    } catch (error) {
      console.warn('Error loading series details:', error);
      return false;
    }
  }

  async function getSeriesComics(rootFolder, publisher, series) {
    await ensureSeriesLoaded(rootFolder, publisher, series);

    const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[series];

    if (Array.isArray(seriesData)) {
      return seriesData;
    } else if (seriesData && seriesData._hasDetails === false) {
      console.warn(`Failed to load comics for series: ${series}`);
      return [];
    }

    return [];
  }

  async function backgroundSyncOperations() {
    try {
      debugLog('SYNC', 'Starting background sync operations...');

      const syncPromises = [];

      if (typeof window !== 'undefined' && window.syncManager) {
        syncPromises.push(
          window.syncManager.initializeDevice().catch(error => {
            console.warn('Device sync initialization failed:', error);
            return null;
          })
        );
      }

      if (typeof getAllDownloadedComicIds === 'function') {
        syncPromises.push(
          getAllDownloadedComicIds().catch(error => {
            console.warn('Failed to get downloaded comic IDs:', error);
            return null;
          })
        );
      }

      if (typeof removeStaleDownloads === 'function') {
        syncPromises.push(
          removeStaleDownloads().catch(error => {
            console.warn('Failed to remove stale downloads:', error);
            return null;
          })
        );
      }

      if (typeof rebuildDownloadedComics === 'function') {
        syncPromises.push(
          rebuildDownloadedComics({ skipRender: true }).catch(error => {
            console.warn('Failed to rebuild downloaded comics:', error);
            return null;
          })
        );
      }

      await Promise.allSettled(syncPromises);

      if (typeof updateFilterButtonCounts === 'function') {
        updateFilterButtonCounts();
      }

      if (['root', 'publisher', 'series', 'search', 'latest', 'converted', 'downloaded'].includes(currentView)) {
        requestAnimationFrame(() => {
          global.LibraryRender?.applyFilterAndRender?.();
        });
      }

      debugLog('SYNC', 'Background sync operations completed');
    } catch (error) {
      console.warn('Background sync operations failed:', error);
    }
  }

  const LibraryData = {
    estimateLibrarySize,
    fetchLibrary,
    tryProgressiveLoading,
    fetchLibraryFull,
    ensureSeriesLoaded,
    getSeriesComics,
    backgroundSyncOperations,
  };

  global.LibraryData = LibraryData;
  Object.assign(global, LibraryData);
})(typeof window !== 'undefined' ? window : globalThis);
