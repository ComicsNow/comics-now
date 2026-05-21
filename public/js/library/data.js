import { state, debugLog } from '../globals.js';

// Shared index for O(1) lookups
export const comicIdMap = new Map();
state.comicIdMap = comicIdMap;
if (typeof window !== 'undefined') {
  window.comicIdMap = comicIdMap;
}

export function buildComicIdMap(library) {
  comicIdMap.clear();
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
            comicIdMap.set(comic.id, comic);
          }
        }
      }
    }
  }
}

export function estimateLibrarySize(library) {
  if (!comicIdMap.size && library && typeof library === 'object') {
     buildComicIdMap(library);
  }
  return comicIdMap.size;
}

export async function fetchLibrary() {
  await fetchLibraryFull();
}

export async function tryProgressiveLoading() {
  try {
    debugLog('LAZY', 'Attempting progressive loading...');
    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(`${apiBaseUrl}/api/v1/comics/structure`);

    if (!response.ok) {
      debugLog('LAZY', 'Progressive loading endpoint not available, falling back to full loading');
      return false;
    }

    const libraryData = await response.json();
    state.library = libraryData;
    if (typeof window !== 'undefined') {
      window.library = libraryData;
    }

    const applyDisplayInfoToLibrary = state.applyDisplayInfoToLibrary || window.applyDisplayInfoToLibrary;
    if (typeof applyDisplayInfoToLibrary === 'function') {
      applyDisplayInfoToLibrary(libraryData);
    }

    buildComicIdMap(libraryData);

    libraryData._isLazyLoaded = true;

    debugLog('LAZY', 'Progressive loading successful');
    return true;
  } catch (error) {
    debugLog('LAZY', 'Progressive loading failed, falling back to full loading:', error);
    return false;
  }
}

export async function fetchLibraryFull() {
  debugLog('LAZY', 'Using full library loading');
  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
  const response = await fetch(`${apiBaseUrl}/api/v1/comics`);

  if (!response.ok) {
    throw new Error(`Failed to fetch library: ${response.status} ${response.statusText}`);
  }

  const libraryData = await response.json();
  state.library = libraryData;
  if (typeof window !== 'undefined') {
    window.library = libraryData;
  }

  const applyDisplayInfoToLibrary = state.applyDisplayInfoToLibrary || window.applyDisplayInfoToLibrary;
  if (typeof applyDisplayInfoToLibrary === 'function') {
    applyDisplayInfoToLibrary(libraryData);
  }

  buildComicIdMap(libraryData);

  const saveLibraryCacheToDB = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
  if (typeof saveLibraryCacheToDB === 'function') {
    try {
      await saveLibraryCacheToDB(libraryData);
    } catch (error) {
      console.warn('Failed to save library cache to IndexedDB:', error);
    }
  }

  const librarySize = estimateLibrarySize(libraryData);
  const applyFilterAndRender = state.LibraryRender?.applyFilterAndRender || window.LibraryRender?.applyFilterAndRender || state.applyFilterAndRender || window.applyFilterAndRender;
  const rebuildLatestComics = state.LibrarySmartLists?.rebuildLatestComics || window.LibrarySmartLists?.rebuildLatestComics || state.rebuildLatestComics || window.rebuildLatestComics;
  const rebuildGuidedComics = state.LibrarySmartLists?.rebuildGuidedComics || window.LibrarySmartLists?.rebuildGuidedComics || state.rebuildGuidedComics || window.rebuildGuidedComics;
  const rebuildMangaSmartLists = state.LibrarySmartLists?.rebuildMangaSmartLists || window.LibrarySmartLists?.rebuildMangaSmartLists || state.rebuildMangaSmartLists || window.rebuildMangaSmartLists;
  const updateFilterButtonCounts = state.updateFilterButtonCounts || window.updateFilterButtonCounts;

  if (librarySize > 1000) {
    if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
    requestAnimationFrame(() => {
      if (typeof rebuildLatestComics === 'function') rebuildLatestComics();
      if (typeof rebuildGuidedComics === 'function') rebuildGuidedComics();
      if (typeof rebuildMangaSmartLists === 'function') rebuildMangaSmartLists();
      requestAnimationFrame(() => {
        if (typeof updateFilterButtonCounts === 'function') {
          updateFilterButtonCounts();
        }
      });
    });
  } else {
    if (typeof rebuildLatestComics === 'function') rebuildLatestComics();
    if (typeof rebuildGuidedComics === 'function') rebuildGuidedComics();
    if (typeof rebuildMangaSmartLists === 'function') rebuildMangaSmartLists();
    if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
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

export async function ensureSeriesLoaded(rootFolder, publisher, series) {
  const library = state.library || window.library;
  if (!library._isLazyLoaded) {
    return true;
  }

  try {
    const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[series];

    if (!seriesData || seriesData._hasDetails) {
      return true;
    }

    debugLog('LAZY', `Loading series details: ${rootFolder}/${publisher}/${series}`);

    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(
      `${apiBaseUrl}/api/v1/comics/series/${encodeURIComponent(rootFolder)}/${encodeURIComponent(publisher)}/${encodeURIComponent(series)}`
    );

    if (!response.ok) {
      console.error(`Failed to load series details: ${response.status}`);
      return false;
    }

    const comics = await response.json();

    library[rootFolder].publishers[publisher].series[series] = comics;

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

export async function getSeriesComics(rootFolder, publisher, series) {
  await ensureSeriesLoaded(rootFolder, publisher, series);

  const library = state.library || window.library;
  const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[series];

  if (Array.isArray(seriesData)) {
    return seriesData;
  } else if (seriesData && seriesData._hasDetails === false) {
    console.warn(`Series data for ${series} exists but has no details`);
    return [];
  }

  return [];
}

export function updateComicInLibrary(comicId, updates) {
  const library = state.library || window.library;
  if (!library || typeof library !== 'object' || !comicId || !updates) return false;

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

export async function backgroundSyncOperations() {
  try {
    debugLog('SYNC', 'Starting background sync operations...');

    const syncPromises = [];
    const syncManager = state.syncManager || window.syncManager;
    const getAllDownloadedComicIds = state.getAllDownloadedComicIds || window.getAllDownloadedComicIds;
    const removeStaleDownloads = state.removeStaleDownloads || window.removeStaleDownloads;
    const rebuildDownloadedComics = state.rebuildDownloadedComics || window.rebuildDownloadedComics;

    if (syncManager) {
      syncPromises.push(
        syncManager.initializeDevice().catch(error => {
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

    const updateFilterButtonCounts = state.updateFilterButtonCounts || window.updateFilterButtonCounts;
    if (typeof updateFilterButtonCounts === 'function') {
      updateFilterButtonCounts();
    }

    const currentView = state.currentView;
    if (['root', 'publisher', 'series', 'search', 'latest', 'downloaded', 'guided', 'manga'].includes(currentView)) {
      const applyFilterAndRender = state.LibraryRender?.applyFilterAndRender || window.LibraryRender?.applyFilterAndRender || state.applyFilterAndRender || window.applyFilterAndRender;
      if (typeof applyFilterAndRender === 'function') {
        requestAnimationFrame(() => {
          applyFilterAndRender();
        });
      }
    }

    debugLog('SYNC', 'Background sync operations completed');
  } catch (error) {
    console.error('Fatal error in background sync:', error);
  }
}

export const LibraryData = {
  estimateLibrarySize,
  fetchLibrary,
  tryProgressiveLoading,
  fetchLibraryFull,
  ensureSeriesLoaded,
  getSeriesComics,
  updateComicInLibrary,
  backgroundSyncOperations,
};

// Expose on state & window for transitional compatibility
state.LibraryData = LibraryData;
Object.assign(state, LibraryData);

if (typeof window !== 'undefined') {
  window.LibraryData = LibraryData;
  Object.assign(window, LibraryData);
}
