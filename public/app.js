const APP_CONFIG_STORAGE_KEY = 'comics-now-app-config';

function cacheAppConfig(config) {
  if (!config || typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    
  }
}

function loadCachedAppConfig() {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(APP_CONFIG_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    
    return null;
  }
}

function resolveAppConfig() {
  if (window.APP_CONFIG && typeof window.APP_CONFIG === 'object') {
    cacheAppConfig(window.APP_CONFIG);
    return window.APP_CONFIG;
  }

  const cached = loadCachedAppConfig();
  if (cached) {
    
    window.APP_CONFIG = cached;
    return cached;
  }

  return null;
}

function showOfflineLibraryUnavailableMessage() {
  const offline = navigator.onLine === false;
  const message = offline
    ? 'Offline library unavailable. Connect to the server while online at least once to sync your comics for offline use.'
    : 'Unable to load the comics library. Check that the server is running and reachable.';

  if (typeof showRootFolderList === 'function') {
    showRootFolderList({ force: true });
  }

  if (rootFolderListContainer) {
    rootFolderListContainer.innerHTML = createErrorMessage(message);
  }
}

// --- INITIAL LOAD ---
async function initializeApp() {
  try {
    const config = resolveAppConfig() || { baseUrl: '/', comicsDirectories: [] };
    window.APP_CONFIG = config;

    // 1) Work out the base URL the server mounted us at (no trailing slash)
    API_BASE_URL = (config.baseUrl || '').replace(/\/$/, '');
    const rootFoldersFromConfig = config.comicsDirectories;
    configuredRootFolders = Array.isArray(rootFoldersFromConfig)
      ? [...rootFoldersFromConfig]
      : [];

    // 2) Keep <base> tag in sync (with trailing slash)
    const baseEl = document.querySelector('base');
    if (baseEl) baseEl.href = `${API_BASE_URL}/`;

    // 3) Register the service worker for this mount
    if ('serviceWorker' in navigator) {
      if (['localhost', '127.0.0.1'].includes(location.hostname)) {
        navigator.serviceWorker.getRegistrations().then(regs =>
          regs.forEach(reg => reg.unregister())
        );
      } else {
        navigator.serviceWorker
          .register(`${API_BASE_URL}/service-worker.js`, {
            scope: `${API_BASE_URL}/`,
            updateViaCache: 'none'
          })
          .then(registration => {
            registration.update();
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              newWorker.addEventListener('statechange', () => {});
            });
          })
          .catch(() => {});
      }
    }

    // 4) App init - prioritize offline data
    await openOfflineDB();
    initializeLibraryUIControls();
    initializeViewerUIControls();
    initializeProgressTracking();

    // 5) Load library from cache first, then sync with server
    await loadLibraryOfflineFirst();

  } catch (e) {
    console.error('[APP INIT ERROR]', e);
    console.error('[APP INIT ERROR] Stack:', e.stack);
    document.body.innerHTML =
      `<div class="text-red-400 text-center p-8">
         Could not load app configuration from server. Is it running and accessible?
         <br><br>
         <div class="text-sm text-gray-400">Error: ${e.message}</div>
       </div>`;
  }
}

// New function to load library offline-first
async function loadLibraryOfflineFirst() {
  try {
    const startTime = performance.now();
    let cachedLibrary = null;
    let cacheTimestamp = null;

    try {
      const cacheStartTime = performance.now();
      if (typeof loadLibraryCacheFromDB === 'function') {
        const cachedRecord = await loadLibraryCacheFromDB();
        if (cachedRecord && cachedRecord.data) {
          cachedLibrary = cachedRecord.data;
          cacheTimestamp = cachedRecord.timestamp;
        }
      }
    } catch (error) {
      // Cache load failed silently
    }

    // Clean up legacy localStorage cache to reclaim quota if present
    try {
      localStorage.removeItem('comics-library-cache');
      localStorage.removeItem('comics-library-cache-timestamp');
    } catch (storageError) {
      // Ignore browsers where localStorage is unavailable
    }

    // Load downloaded comic IDs early so indicators show immediately
    if (typeof getAllDownloadedComicIds === 'function') {
      try {
        console.log('[DEBUG] Loading downloaded comic IDs...');
        const ids = await getAllDownloadedComicIds();
        console.log('[DEBUG] Loaded', ids ? ids.size : 0, 'downloaded comic IDs');
      } catch (error) {
        console.error('[DEBUG] Failed to load downloaded comic IDs:', error);
        // Initialize empty set to prevent errors in UI
        if (!global.downloadedComicIds) {
          global.downloadedComicIds = new Set();
        }
      }
    } else {
      console.warn('[DEBUG] getAllDownloadedComicIds function not available');
    }

    if (cachedLibrary) {
      library = cachedLibrary;
      applyDisplayInfoToLibrary(library);

      // Show cached data immediately for better UX
      const librarySize = estimateLibrarySize(library);
      if (librarySize > 0) {
        if (librarySize > 1000) {
          applyFilterAndRender();
          requestAnimationFrame(() => {
            rebuildLatestComics();
            rebuildLatestConvertedComics();
            requestAnimationFrame(() => {
              if (typeof updateFilterButtonCounts === 'function') {
                updateFilterButtonCounts();
              }
            });
          });
        } else {
          rebuildLatestComics();
          rebuildLatestConvertedComics();
          applyFilterAndRender();
        }

        // Merge offline progress data
        if (typeof mergeOfflineStatusesIntoLibrary === 'function') {
          await mergeOfflineStatusesIntoLibrary();

          // Re-render UI with updated progress data
          applyFilterAndRender();

          // Update library cache so next refresh shows correct progress immediately
          if (typeof saveLibraryCacheToDB === 'function') {
            saveLibraryCacheToDB(library).catch(() => {
              // Failed to update library cache
            });
          }
        }
      }
    }

    const isOffline = navigator.onLine === false;
    let hasLibraryData = Boolean(cachedLibrary);

    if (!cachedLibrary && isOffline) {
      
      showOfflineLibraryUnavailableMessage();
    }

    // If we're online, refresh from the server
    if (!isOffline) {
      console.log('[DEBUG] Online, attempting to fetch library from server');
      const serverFetchStart = performance.now();
      try {
        await fetchLibraryFromServer();
        hasLibraryData = true;
      } catch (error) {
        console.error('[DEBUG] fetchLibraryFromServer error:', error);
        // Network error - if we have cached data, continue using it silently
        if (!hasLibraryData) {
          showOfflineLibraryUnavailableMessage();
        } else {
          // We have cached data, so just log the error and continue
          console.warn('[OFFLINE] Server fetch failed but using cached library data:', error.message);
        }
      }
    } else {
      console.log('[DEBUG] Offline, not fetching from server');
    }

    // Run background operations
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        backgroundSyncOperations();
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        backgroundSyncOperations();
      }, 50);
    }

  } catch (error) {
    
    rootFolderListContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading library. Check network connection.</div>';
  }
}

// Modified function to fetch from server and cache
async function fetchLibraryFromServer() {
  console.log('[DEBUG] fetchLibraryFromServer called');
  console.log('[DEBUG] window.tryProgressiveLoading exists?', typeof window.tryProgressiveLoading);
  console.log('[DEBUG] window.fetchLibraryFull exists?', typeof window.fetchLibraryFull);

  try {
    // Try lazy loading first, fallback to full loading
    console.log('[DEBUG] About to call tryProgressiveLoading');
    const useProgressiveLoading = await window.tryProgressiveLoading();
    console.log('[DEBUG] tryProgressiveLoading returned:', useProgressiveLoading);

    if (!useProgressiveLoading) {
      // Fallback to original full loading
      await window.fetchLibraryFull();
      return;
    }

    // Cache the library data
    if (typeof saveLibraryCacheToDB === 'function') {
      try {
        await saveLibraryCacheToDB(library);
      } catch (error) {
        
      }
    }

    // Progressive loading succeeded - update UI
    const librarySize = estimateLibrarySize(library);
    if (librarySize > 1000) {
      // For large libraries, show UI first then rebuild in background
      applyFilterAndRender();
      requestAnimationFrame(() => {
        rebuildLatestComics();
        rebuildLatestConvertedComics();
        requestAnimationFrame(() => {
          if (typeof updateFilterButtonCounts === 'function') {
            updateFilterButtonCounts();
          }
        });
      });
    } else {
      // For smaller libraries, rebuild immediately
      rebuildLatestComics();
      rebuildLatestConvertedComics();
      applyFilterAndRender();
    }

  } catch (error) {

    throw error;
  }
}

// --- USER BADGE ---
function showUserBadge() {
  // Only show badge when auth is enabled
  if (!window.syncManager || !window.syncManager.authEnabled) {
    return;
  }

  // Check if badge already exists
  if (document.getElementById('user-badge')) {
    return;
  }

  const userEmail = window.syncManager.userEmail || 'Unknown';
  const userRole = window.syncManager.userRole || 'user';

  // Create badge element
  const badge = document.createElement('div');
  badge.id = 'user-badge';
  badge.className = 'z-30 bg-gray-700 text-white text-xs sm:text-sm font-medium shadow-lg';
  badge.style.cssText = 'position: absolute; padding: 0.25rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap; width: fit-content; max-width: 250px;';

  // Position below logout button for both mobile and desktop
  if (window.matchMedia('(min-width: 640px)').matches) {
    // Desktop: Logout button is at top: 2rem (32px), position badge below it
    badge.style.top = '4rem';  // 2rem (logout top position) + ~2rem (button height + gap)
    badge.style.left = '2rem';
  } else {
    // Mobile: Logout button is at top: 1rem (16px), position badge below it
    badge.style.top = '3.5rem';  // 1rem (logout top position) + ~2.5rem (button height + gap)
    badge.style.left = '1rem';
  }

  // Add role indicator color
  const roleColor = userRole === 'admin' ? 'bg-blue-500' : 'bg-green-500';

  badge.innerHTML = `
    <span class="w-2 h-2 rounded-full ${roleColor}" style="flex-shrink: 0;"></span>
    <span>${userEmail}</span>
  `;

  document.body.appendChild(badge);
}

// --- HIDE ADMIN UI FOR NON-ADMINS ---
function hideAdminUI() {
  // Only hide admin UI when auth is enabled AND user is NOT admin
  if (!window.syncManager || !window.syncManager.authEnabled) {
    // Auth disabled - everyone has access
    return;
  }

  if (window.syncManager.userRole === 'admin') {
    // User is admin - show all controls
    return;
  }

  // User is NOT admin - hide admin controls

  // Hide CT (ComicTagger) button (admin only)
  const ctButton = document.getElementById('ct-button');
  if (ctButton) {
    ctButton.style.display = 'none';
  }

  // Hide admin-only tabs in settings modal
  const adminTabs = [
    'settings-tab-general',
    'settings-tab-logs',
    'settings-tab-users',
    'settings-tab-comics-management'
  ];

  adminTabs.forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.style.display = 'none';
    }
  });

  // Hide admin-only tab content
  const adminTabContent = [
    'settings-content-general',
    'settings-content-logs',
    'settings-content-users',
    'settings-content-comics-management'
  ];

  adminTabContent.forEach(contentId => {
    const content = document.getElementById(contentId);
    if (content) {
      content.style.display = 'none';
    }
  });

  // Auto-select Devices or Downloads tab for non-admin users when settings opens
  setTimeout(() => {
    const devicesTab = document.getElementById('settings-tab-devices');
    if (devicesTab && !devicesTab.classList.contains('active')) {
      devicesTab.click();
    }
  }, 100);

  // Note: We don't throw errors if elements don't exist - they might not be loaded yet
  // The UI will gracefully handle missing elements
}

// Expose functions globally for library/data.js
if (typeof window !== 'undefined') {
  window.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
  window.fetchLibraryFromServer = fetchLibraryFromServer;
}

initializeApp();
