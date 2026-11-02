import {
  escapeHtml,
  rootFolderListContainer,
  applyDisplayInfoToLibrary
} from '../globals.js';
import { isAppOnline, checkServerConnectivity } from '../offline/status.js';
import { appGlobal, showOfflineLibraryUnavailableMessage } from './bootstrap.js';

// Loads the library offline-first: cache first, then refresh from server
export async function loadLibraryOfflineFirst() {
  try {
    let cachedLibrary = null;

    try {
      if (typeof appGlobal.loadLibraryCacheFromDB === 'function') {
        const cachedRecord = await appGlobal.loadLibraryCacheFromDB();
        if (cachedRecord && cachedRecord.data) {
          cachedLibrary = cachedRecord.data;
        }
      }
    } catch (error) {
      console.warn('[loadLibraryOfflineFirst:cacheLoad]', error);
    }

    // Clean up legacy localStorage cache to reclaim quota if present
    try {
      localStorage.removeItem('comics-library-cache');
      localStorage.removeItem('comics-library-cache-timestamp');
    } catch (storageError) {
      console.warn('[loadLibraryOfflineFirst:legacyCacheCleanup]', storageError);
    }

    // Load downloaded comic IDs early so indicators show immediately
    if (typeof appGlobal.getAllDownloadedComicIds === 'function') {
      try {
        await appGlobal.getAllDownloadedComicIds();
      } catch (error) {
        console.error('[DEBUG] Failed to load downloaded comic IDs:', error);
        // Initialize empty set to prevent errors in UI
        if (!appGlobal.downloadedComicIds) {
          appGlobal.downloadedComicIds = new Set();
        }
      }
    }

    if (cachedLibrary) {
      appGlobal.library = cachedLibrary;
      applyDisplayInfoToLibrary(appGlobal.library);

      // Show cached data immediately for better UX
      const librarySize = typeof appGlobal.estimateLibrarySize === 'function' ? appGlobal.estimateLibrarySize(appGlobal.library) : 0;
      if (librarySize > 0) {
        if (librarySize > 1000) {
          if (typeof appGlobal.applyFilterAndRender === 'function') appGlobal.applyFilterAndRender();
          requestAnimationFrame(() => {
            if (typeof appGlobal.rebuildLatestComics === 'function') appGlobal.rebuildLatestComics();
            if (typeof appGlobal.rebuildMangaSmartLists === 'function') appGlobal.rebuildMangaSmartLists();
            requestAnimationFrame(() => {
              if (typeof appGlobal.updateFilterButtonCounts === 'function') {
                appGlobal.updateFilterButtonCounts();
              }
            });
          });
        } else {
          if (typeof appGlobal.rebuildLatestComics === 'function') appGlobal.rebuildLatestComics();
          if (typeof appGlobal.rebuildMangaSmartLists === 'function') appGlobal.rebuildMangaSmartLists();
          if (typeof appGlobal.applyFilterAndRender === 'function') appGlobal.applyFilterAndRender();
        }

        // Merge offline progress data
        if (typeof appGlobal.mergeOfflineStatusesIntoLibrary === 'function') {
          await appGlobal.mergeOfflineStatusesIntoLibrary();

          // Re-render UI with updated progress data
          if (typeof appGlobal.applyFilterAndRender === 'function') appGlobal.applyFilterAndRender();

          // Update library cache so next refresh shows correct progress immediately
          if (typeof appGlobal.saveLibraryCacheToDB === 'function') {
            appGlobal.saveLibraryCacheToDB(appGlobal.library).catch(() => {
              // Failed to update library cache
            });
          }
        }
      }
    }

    const isOffline = typeof isAppOnline === 'function' ? !isAppOnline() : navigator.onLine === false;
    const hasLibraryData = Boolean(cachedLibrary);

    if (!cachedLibrary && isOffline) {
      showOfflineLibraryUnavailableMessage();
    }

    // If we're online, refresh from the server
    if (!isOffline) {
      try {
        await fetchLibraryFromServer();
      } catch (error) {
        console.error('[DEBUG] fetchLibraryFromServer error:', error);
        // Network error - if we have cached data, continue using it silently
        if (!hasLibraryData) {
          showOfflineLibraryUnavailableMessage();
        }
      }
    } else {
      // If we initially loaded in offline mode, probe server in the background
      // to automatically break out of any stale Android Doze offline lock
      if (typeof checkServerConnectivity === 'function') {
        checkServerConnectivity().then(online => {
          if (online && typeof fetchLibraryFromServer === 'function') {
            fetchLibraryFromServer().catch(() => {});
          }
        }).catch(() => {});
      }
    }

    // Run background operations
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        if (typeof appGlobal.backgroundSyncOperations === 'function') {
          appGlobal.backgroundSyncOperations();
        }
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        if (typeof appGlobal.backgroundSyncOperations === 'function') {
          appGlobal.backgroundSyncOperations();
        }
      }, 50);
    }

    // Mark library as ready
    appGlobal.libraryReady = true;
    appGlobal.libraryLoadedAt = Date.now();
  } catch (error) {
    appGlobal.libraryReady = false;
    console.error('[LIBRARY] Failed to load library:', error);
    if (rootFolderListContainer) {
      rootFolderListContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading library. Check network connection.</div>';
    }
  }
}

// Fetches the library from the server and caches it
export async function fetchLibraryFromServer() {
  // Try lazy loading first, fallback to full loading
  const useProgressiveLoading = typeof appGlobal.tryProgressiveLoading === 'function' ? await appGlobal.tryProgressiveLoading() : false;

  if (!useProgressiveLoading) {
    // Fallback to original full loading
    if (typeof appGlobal.fetchLibraryFull === 'function') {
      await appGlobal.fetchLibraryFull();
    }
    return;
  }

  // Cache the library data
  if (typeof appGlobal.saveLibraryCacheToDB === 'function') {
    try {
      await appGlobal.saveLibraryCacheToDB(appGlobal.library);
    } catch (error) {
      console.error('Failed to save library cache to DB:', error);
    }
  }

  // Progressive loading succeeded - update UI
  const librarySize = typeof appGlobal.estimateLibrarySize === 'function' ? appGlobal.estimateLibrarySize(appGlobal.library) : 0;
  if (librarySize > 1000) {
    // For large libraries, show UI first then rebuild in background
    if (typeof appGlobal.applyFilterAndRender === 'function') appGlobal.applyFilterAndRender();
    requestAnimationFrame(() => {
      if (typeof appGlobal.rebuildLatestComics === 'function') appGlobal.rebuildLatestComics();
      if (typeof appGlobal.rebuildMangaSmartLists === 'function') appGlobal.rebuildMangaSmartLists();
      requestAnimationFrame(() => {
        if (typeof appGlobal.updateFilterButtonCounts === 'function') {
          appGlobal.updateFilterButtonCounts();
        }
      });
    });
  } else {
    // For smaller libraries, rebuild immediately
    if (typeof appGlobal.rebuildLatestComics === 'function') appGlobal.rebuildLatestComics();
    if (typeof appGlobal.rebuildMangaSmartLists === 'function') appGlobal.rebuildMangaSmartLists();
    if (typeof appGlobal.applyFilterAndRender === 'function') appGlobal.applyFilterAndRender();
  }
}

// --- USER BADGE ---
export function showUserBadge() {
  // Only show badge when auth is enabled
  if (!appGlobal.syncManager || !appGlobal.syncManager.authEnabled) {
    return;
  }

  // Check if badge already exists
  if (document.getElementById('user-badge')) {
    return;
  }

  const userEmail = appGlobal.syncManager.userEmail || 'Unknown';
  const userRole = appGlobal.syncManager.userRole || 'user';

  // Create badge element
  const badge = document.createElement('div');
  badge.id = 'user-badge';
  badge.className = 'z-30 bg-gray-700 text-white text-xs sm:text-sm font-medium shadow-lg';
  badge.style.cssText = 'position: fixed; padding: 0.25rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap; width: fit-content; max-width: 250px;';

  // Position at bottom left of page for both mobile and desktop
  if (appGlobal.matchMedia('(min-width: 640px)').matches) {
    badge.style.bottom = '1rem';
    badge.style.left = '2rem';
  } else {
    badge.style.bottom = '1rem';
    badge.style.left = '1rem';
  }

  const roleColor = userRole === 'admin' ? 'bg-blue-500' : 'bg-green-500';

  badge.innerHTML = `
    <span class="w-2 h-2 rounded-full ${roleColor}" style="flex-shrink: 0;"></span>
    <span>${escapeHtml(userEmail)}</span>
  `;

  document.body.appendChild(badge);
}
