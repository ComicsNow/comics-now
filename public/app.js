import {
  state,
  escapeHtml,
  createErrorMessage,
  getRelativePath,
  ICONS,
  CSS_CLASSES,
  rootFolderListContainer,
  applyDisplayInfoToLibrary
} from './js/globals.js';

import { registerRoutes } from './js/routes.js';

// Side-effect imports to load and register all other ES Modules in order
import './js/router.js';
import './js/utils/device-detection.js';
import './js/offline/db-core.js';
import './js/offline/db-jwt.js';
import './js/offline/db-library-cache.js';
import './js/offline/db-queue.js';
import './js/offline/db-comics.js';
import './js/offline/db-namespace.js';
import './js/jwt-capture.js';
import './js/offline/status.js';
import './js/offline/downloads.js';
import './js/offline/download-progress.js';
import './js/offline/download-notifications.js';
import './js/offline/download-actions.js';
import './js/offline/downloads-namespace.js';
import './js/offline.js';
import './js/library/data.js';
import './js/library/smartlists.js';
import './js/library/status.js';
import './js/library/smart-filters.js';
import './js/library/breadcrumb.js';
import './js/library/alpha-list.js';
import './js/library/search.js';
import './js/library/render.js';
import './js/library/folder-viewer.js';
import './js/library/device-library.js';
import './js/library.js';
import './js/context-menu/menu-builder.js';
import './js/manga.js';
import './js/continuous.js';
import './js/context-menu/actions-shared.js';
import './js/context-menu/actions-comic.js';
import './js/context-menu/actions-series.js';
import './js/context-menu/actions-publisher.js';
import './js/context-menu/actions-library.js';
import './js/context-menu/actions-folder.js';
import './js/metadata.js';
import './js/bulk-status.js';
import './js/viewer/fullscreen.js';
import './js/viewer/full-image.js';
import './js/viewer/ui-page-jump.js';
import './js/viewer/ui-orientation.js';
import './js/viewer/ui-summary.js';
import './js/viewer/ui.js';
import './js/viewer/ui-init.js';
import './js/viewer/navigation.js';
import './js/viewer/viewer-server.js';
import './js/viewer/viewer-local.js';
import './js/viewer/end-navigation.js';
import './js/viewer/guided/data.js';
import './js/viewer/guided/geometry.js';
import './js/viewer/guided/overlay.js';
import './js/viewer/guided/mode-registry.js';
import './js/viewer/guided/modes/guided.js';
import './js/viewer/guided/modes/bubble.js';
import './js/viewer/guided/modes/western-speech-zoom.js';
import './js/viewer/guided/modes/manga-panel-zoom.js';
import './js/viewer/guided/modes/manga-speech-zoom.js';
import './js/viewer/guided/pan.js';
import './js/viewer/guided/input.js';
import './js/viewer/guided/lifecycle.js';
import './js/viewer/guided/buttons.js';
import './js/viewer/guided/index.js';
import './js/settings/shared.js';
import './js/settings/continuous-mode.js';
import './js/settings/devices.js';
import './js/settings/users.js';
import './js/settings/user-access.js';
import './js/settings/comics-defaults.js';
import './js/settings/comics-management.js';
import './js/settings.js';
import './js/guided-reader.js';
import './js/comictagger.js';
import './js/events.js';
import './js/comicvine.js';
import './js/progress.js';
import './js/sync.js';
import './js/auth.js';
import './js/reading-lists.js';


const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop === 'state') return state;
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

const APP_CONFIG_STORAGE_KEY = 'comics-now-app-config';

function cacheAppConfig(config) {
  if (!config || typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('[cacheAppConfig]', error);
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
    console.warn('[loadCachedAppConfig]', error);
    return null;
  }
}

function resolveAppConfig() {
  if (global.APP_CONFIG && typeof global.APP_CONFIG === 'object') {
    cacheAppConfig(global.APP_CONFIG);
    return global.APP_CONFIG;
  }

  const cached = loadCachedAppConfig();
  if (cached) {
    global.APP_CONFIG = cached;
    return cached;
  }

  return null;
}

function showOfflineLibraryUnavailableMessage() {
  const offline = navigator.onLine === false;
  const message = offline
    ? 'Offline library unavailable. Connect to the server while online at least once to sync your comics for offline use.'
    : 'Unable to load the comics library. Check that the server is running and reachable.';

  if (typeof global.showRootFolderList === 'function') {
    global.showRootFolderList({ force: true });
  }

  if (rootFolderListContainer) {
    rootFolderListContainer.innerHTML = createErrorMessage(message);
  }
}

// --- LIBRARY STATUS TRACKING ---
global.libraryReady = false;
global.libraryLoadedAt = null;
let isListEditMode = false;

function updateLibraryStatusBadge() {
  const badge = document.getElementById('library-status-badge');
  if (!badge) return;

  if (global.libraryReady) {
    const comicCount = Object.keys(global.library || {}).length;
    badge.textContent = comicCount > 0 ? 'Ready' : 'Empty';
    badge.className = comicCount > 0
      ? 'text-xs px-2 py-1 rounded-full bg-green-600'
      : 'text-xs px-2 py-1 rounded-full bg-gray-600';
  } else {
    badge.textContent = 'Loading...';
    badge.className = 'text-xs px-2 py-1 rounded-full bg-yellow-600';
  }
}

// --- INITIAL LOAD ---

/**
 * Phase 1: Environment and configuration setup
 */
function initEnvironment() {
  const config = resolveAppConfig() || { baseUrl: '/', libraries: [] };
  global.APP_CONFIG = config;

  // 1) Work out the base URL the server mounted us at (no trailing slash)
  global.API_BASE_URL = (config.baseUrl || '').replace(/\/$/, '');
  
  // Store library names for display mapping
  global.LIBRARY_NAMES = {};
  global.configuredRootFolders = [];

  if (Array.isArray(config.libraries)) {
    config.libraries.forEach(lib => {
      if (typeof lib === 'object' && lib.id && lib.name) {
        global.LIBRARY_NAMES[lib.id] = lib.name;
        global.configuredRootFolders.push(lib.id);
      }
    });
  }

  // 2) Keep <base> tag in sync (with trailing slash)
  const baseEl = document.querySelector('base');
  if (baseEl) baseEl.href = `${global.API_BASE_URL}/`;

  return config;
}

/**
 * Phase 2: Service worker registration
 */
async function registerServiceWorker(config) {
  // 3) Register the service worker for this mount
  if ('serviceWorker' in navigator) {
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      const regs = await navigator.serviceWorker.getRegistrations();
      regs.forEach(reg => reg.unregister());
    } else {
      try {
        const registration = await navigator.serviceWorker.register(`${global.API_BASE_URL}/service-worker.js`, {
          scope: `${global.API_BASE_URL}/`,
          updateViaCache: 'none'
        });
        registration.update();
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {});
        });
      } catch (error) {
        // Silently fail
      }
    }
  }
}

/**
 * Phase 3: Storage and database initialization
 */
async function initAppStorage() {
  // 4) App init - prioritize offline data
  if (typeof global.openOfflineDB === 'function') {
    await global.openOfflineDB();
  }

  // Initialize download queue and resume any pending downloads
  if (typeof global.initializeDownloadQueue === 'function') {
    try {
      await global.initializeDownloadQueue();
    } catch (error) {
      console.error('[APP] Failed to initialize download queue:', error);
    }
  }

  // Initialize JWT token capture for Cloudflare Access authentication
  // This enables background downloads to work with authentication enabled
  if (typeof global.initializeJWTCapture === 'function') {
    try {
      await global.initializeJWTCapture(30 * 60 * 1000); // Refresh every 30 minutes
    } catch (error) {
      console.error('[APP] Failed to initialize JWT capture:', error);
    }
  }
}

/**
 * Phase 4: UI controls initialization
 */
function initUIControls() {
  if (typeof global.initializeLibraryUIControls === 'function') {
    global.initializeLibraryUIControls();
  }
  if (typeof global.initializeViewerUIControls === 'function') {
    global.initializeViewerUIControls();
  }
  if (typeof global.initializeProgressTracking === 'function') {
    global.initializeProgressTracking();
  }
}

/**
 * Phase 5: Initial data loading
 */
async function loadInitialData() {
  // 4.5) Load manga mode preference early
  try {
    const response = await fetch(`${global.API_BASE_URL}/api/v1/manga-mode-preference`);
    const data = await response.json();
    if (response.ok && data.ok) {
      global.mangaModePreference = data.mangaMode;
    }
  } catch (error) {
    console.warn('[initializeApp:mangaModePreference]', error);
  }

  // 5) Load library from cache first, then sync with server
  await loadLibraryOfflineFirst();
}

async function initializeApp() {
  global._isAppInitializing = true;
  try {
    const config = initEnvironment();
    await registerServiceWorker(config);
    await initAppStorage();
    initUIControls();
    await loadInitialData();

    if (global.router) {
      global.router.navigate(getRelativePath() + global.location.search, false);
    }
  } catch (e) {
    console.error('[APP INIT ERROR]', e);
    console.error('[APP INIT ERROR] Stack:', e.stack);
    document.body.innerHTML =
      `<div class="text-red-400 text-center p-8">
         Could not load app configuration from server. Is it running and accessible?
         <br><br>
         <span class="text-xs text-gray-500">${escapeHtml(e.message)}</span>
       </div>`;
  } finally {
    global._isAppInitializing = false;
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
      if (typeof global.loadLibraryCacheFromDB === 'function') {
        const cachedRecord = await global.loadLibraryCacheFromDB();
        if (cachedRecord && cachedRecord.data) {
          cachedLibrary = cachedRecord.data;
          cacheTimestamp = cachedRecord.timestamp;
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
    if (typeof global.getAllDownloadedComicIds === 'function') {
      try {
        const ids = await global.getAllDownloadedComicIds();
      } catch (error) {
        console.error('[DEBUG] Failed to load downloaded comic IDs:', error);
        // Initialize empty set to prevent errors in UI
        if (!global.downloadedComicIds) {
          global.downloadedComicIds = new Set();
        }
      }
    }

    if (cachedLibrary) {
      global.library = cachedLibrary;
      applyDisplayInfoToLibrary(global.library);

      // Show cached data immediately for better UX
      const librarySize = typeof global.estimateLibrarySize === 'function' ? global.estimateLibrarySize(global.library) : 0;
      if (librarySize > 0) {
        if (librarySize > 1000) {
          if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
          requestAnimationFrame(() => {
            if (typeof global.rebuildLatestComics === 'function') global.rebuildLatestComics();
            if (typeof global.rebuildMangaSmartLists === 'function') global.rebuildMangaSmartLists();
            requestAnimationFrame(() => {
              if (typeof global.updateFilterButtonCounts === 'function') {
                global.updateFilterButtonCounts();
              }
            });
          });
        } else {
          if (typeof global.rebuildLatestComics === 'function') global.rebuildLatestComics();
          if (typeof global.rebuildMangaSmartLists === 'function') global.rebuildMangaSmartLists();
          if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
        }

        // Merge offline progress data
        if (typeof global.mergeOfflineStatusesIntoLibrary === 'function') {
          await global.mergeOfflineStatusesIntoLibrary();

          // Re-render UI with updated progress data
          if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();

          // Update library cache so next refresh shows correct progress immediately
          if (typeof global.saveLibraryCacheToDB === 'function') {
            global.saveLibraryCacheToDB(global.library).catch(() => {
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
      const serverFetchStart = performance.now();
      try {
        await fetchLibraryFromServer();
        hasLibraryData = true;
      } catch (error) {
        console.error('[DEBUG] fetchLibraryFromServer error:', error);
        // Network error - if we have cached data, continue using it silently
        if (!hasLibraryData) {
          showOfflineLibraryUnavailableMessage();
        }
      }
    }

    // Run background operations
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        if (typeof global.backgroundSyncOperations === 'function') {
          global.backgroundSyncOperations();
        }
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        if (typeof global.backgroundSyncOperations === 'function') {
          global.backgroundSyncOperations();
        }
      }, 50);
    }

    // Mark library as ready
    global.libraryReady = true;
    global.libraryLoadedAt = Date.now();

    // Update library status badge
    updateLibraryStatusBadge();

  } catch (error) {
    global.libraryReady = false;
    console.error('[LIBRARY] Failed to load library:', error);
    if (rootFolderListContainer) {
      rootFolderListContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading library. Check network connection.</div>';
    }
  }
}

// Modified function to fetch from server and cache
async function fetchLibraryFromServer() {
  try {
    // Try lazy loading first, fallback to full loading
    const useProgressiveLoading = typeof global.tryProgressiveLoading === 'function' ? await global.tryProgressiveLoading() : false;

    if (!useProgressiveLoading) {
      // Fallback to original full loading
      if (typeof global.fetchLibraryFull === 'function') {
        await global.fetchLibraryFull();
      }
      return;
    }

    // Cache the library data
    if (typeof global.saveLibraryCacheToDB === 'function') {
      try {
        await global.saveLibraryCacheToDB(global.library);
      } catch (error) {
        console.error('Failed to save library cache to DB:', error);
      }
    }

    // Progressive loading succeeded - update UI
    const librarySize = typeof global.estimateLibrarySize === 'function' ? global.estimateLibrarySize(global.library) : 0;
    if (librarySize > 1000) {
      // For large libraries, show UI first then rebuild in background
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      requestAnimationFrame(() => {
        if (typeof global.rebuildLatestComics === 'function') global.rebuildLatestComics();
        if (typeof global.rebuildMangaSmartLists === 'function') global.rebuildMangaSmartLists();
        requestAnimationFrame(() => {
          if (typeof global.updateFilterButtonCounts === 'function') {
            global.updateFilterButtonCounts();
          }
        });
      });
    } else {
      // For smaller libraries, rebuild immediately
      if (typeof global.rebuildLatestComics === 'function') global.rebuildLatestComics();
      if (typeof global.rebuildMangaSmartLists === 'function') global.rebuildMangaSmartLists();
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
    }

  } catch (error) {
    throw error;
  }
}

// --- USER BADGE ---
function showUserBadge() {
  // Only show badge when auth is enabled
  if (!global.syncManager || !global.syncManager.authEnabled) {
    return;
  }

  // Check if badge already exists
  if (document.getElementById('user-badge')) {
    return;
  }

  const userEmail = global.syncManager.userEmail || 'Unknown';
  const userRole = global.syncManager.userRole || 'user';

  // Create badge element
  const badge = document.createElement('div');
  badge.id = 'user-badge';
  badge.className = 'z-30 bg-gray-700 text-white text-xs sm:text-sm font-medium shadow-lg';
  badge.style.cssText = 'position: fixed; padding: 0.25rem 0.75rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap; width: fit-content; max-width: 250px;';

  // Position at bottom left of page for both mobile and desktop
  if (global.matchMedia('(min-width: 640px)').matches) {
    // Desktop: Position at bottom left
    badge.style.bottom = '1rem';
    badge.style.left = '2rem';
  } else {
    // Mobile: Position at bottom left
    badge.style.bottom = '1rem';
    badge.style.left = '1rem';
  }

  // Add role indicator color
  const roleColor = userRole === 'admin' ? 'bg-blue-500' : 'bg-green-500';

  badge.innerHTML = `
    <span class="w-2 h-2 rounded-full ${roleColor}" style="flex-shrink: 0;"></span>
    <span>${escapeHtml(userEmail)}</span>
  `;

  document.body.appendChild(badge);
}

// --- HIDE ADMIN UI FOR NON-ADMINS ---
function hideAdminUI() {
  if (!global.syncManager || !global.syncManager.authEnabled) {
    return;
  }

  if (global.syncManager.userRole === "admin") {
    if (global.APP_CONFIG && global.APP_CONFIG.hideSupportForAdmin) {
      const sl = document.getElementById("support-link");
      if (sl) sl.style.display = "none";
    }
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
    'settings-tab-guided-reader',
    'metadata-tab'
  ];

  adminTabs.forEach(tabId => {
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.remove();
    }
  });

  // Hide admin-only tab content
  const adminTabContent = [
    'settings-content-general',
    'settings-content-logs',
    'settings-content-users',
    'settings-content-guided-reader',
    'metadata-content'
  ];

  adminTabContent.forEach(contentId => {
    const content = document.getElementById(contentId);
    if (content) {
      content.remove();
    }
  });

  // Hide admin-only sections in the Comics Defaults tab
  const adminDefaultSections = [
    'settings-defaults-formats',
    'settings-defaults-metadata'
  ];

  adminDefaultSections.forEach(sectionId => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.remove();
    }
  });
}

// --- READING LIST MODAL ---

/**
 * Open the reading list modal and refresh its contents
 */
function openReadingListModal() {
  if (!global._isNavigatingFromRouter && global.router) {
    if (getRelativePath() !== '/reading-lists') {
      global.router.navigate('/reading-lists', true);
    }
  }
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.remove('hidden');
    updateLibraryStatusBadge(); // Update status badge
    refreshReadingListModal();
  }
}

/**
 * Close the reading list modal
 */
function closeReadingListModal() {
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.classList.add('hidden');
    if (global.router && getRelativePath() === '/reading-lists') {
      const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
      global.router.navigate(path, true);
    }
  }
}

/**
 * Refresh the reading list modal display
 */
async function refreshReadingListModal() {
  const listsContainer = document.getElementById('reading-lists-container');
  if (!listsContainer) return;

  // Handle Edit Mode buttons visibility
  const editBtn = document.getElementById('edit-reading-lists-btn');
  const saveBtn = document.getElementById('save-reading-lists-order-btn');
  const cancelBtn = document.getElementById('cancel-reading-lists-edit-btn');
  const buttonsSection = document.querySelector('#reading-list-modal .mb-6.space-y-2');

  if (editBtn) editBtn.classList.toggle('hidden', isListEditMode);
  if (saveBtn) saveBtn.classList.toggle('hidden', !isListEditMode);
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !isListEditMode);
  if (buttonsSection) buttonsSection.classList.toggle('hidden', isListEditMode);

  // Show loading state
  listsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading...</p>';

  // Fetch lists from API
  if (typeof global.ReadingLists !== 'undefined' && typeof global.ReadingLists.fetchReadingLists === 'function') {
    const lists = await global.ReadingLists.fetchReadingLists();

    if (lists.length === 0) {
      listsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No reading lists yet. Create one to get started!</p>';
    } else {
      listsContainer.innerHTML = '';

      lists.forEach((list) => {
        const listDiv = document.createElement('div');
        listDiv.className = 'bg-gray-800/50 p-5 rounded-xl border border-gray-700/50 hover:border-purple-500/50 transition-all group cursor-pointer relative flex flex-col gap-3';
        listDiv.dataset.listId = list.id;
        
        if (isListEditMode) {
          listDiv.classList.add('is-editing');
        }

        const itemCount = list.totalComics || 0;
        const readCount = list.readComics || 0;
        const createdDate = list.created ? new Date(list.created).toLocaleDateString() : '';
        const progressPercent = list.progressPercent || 0;

        // Determine read status
        const allRead = readCount === itemCount && itemCount > 0;
        const hasProgress = readCount > 0;

        listDiv.innerHTML = `
          <div class="flex justify-between items-start">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              ${isListEditMode ? `
                <div class="flex flex-col gap-1">
                  <button class="reorder-up-btn text-gray-500 hover:text-white p-0.5" title="Move Up">▲</button>
                  <button class="reorder-down-btn text-gray-500 hover:text-white p-0.5" title="Move Down">▼</button>
                </div>
              ` : ''}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-xl group-hover:scale-110 transition-transform inline-block">📚</span>
                  <h5 class="font-bold text-lg text-white truncate">${escapeHtml(list.name)}</h5>
                </div>
                <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                  <span>Created ${escapeHtml(createdDate)}</span>
                  <span class="w-1 h-1 rounded-full bg-gray-700"></span>
                  <span class="${allRead ? 'text-green-500' : hasProgress ? 'text-purple-400' : 'text-gray-500'}">${readCount} / ${itemCount} Read</span>
                </div>
              </div>
            </div>
            <button class="text-gray-600 hover:text-red-400 transition-colors p-1 delete-list-btn ${isListEditMode ? 'hidden' : ''}" data-list-id="${escapeHtml(list.id)}" title="Delete List">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <!-- Progress Bar -->
          <div class="space-y-1.5">
            <div class="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
              <span class="text-gray-500">Progress</span>
              <span class="${allRead ? 'text-green-500' : 'text-purple-400'}">${progressPercent}%</span>
            </div>
            <div class="relative h-2 bg-gray-900/50 rounded-full overflow-hidden border border-white/5">
              <div class="absolute top-0 left-0 h-full ${allRead ? 'bg-green-500' : 'bg-purple-600'} transition-all duration-500 ease-out shadow-[0_0_10px_rgba(147,51,234,0.3)]" style="width: ${progressPercent}%;"></div>
            </div>
          </div>

          <!-- Action Icons -->
          <div class="flex gap-2 items-center mt-2 ${isListEditMode ? 'opacity-50 pointer-events-none' : ''}">
            <button class="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors read-toggle-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    data-current-status="${allRead}"
                    title="${allRead ? 'Mark as unread' : 'Mark as read'}">
              <span class="opacity-70">${allRead ? '↩' : ICONS.READ}</span>
              <span>${allRead ? 'Unread' : 'Read'}</span>
            </button>

            <button class="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 px-3 rounded-lg transition-colors download-list-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    data-list-name="${escapeHtml(list.name)}"
                    title="Download all comics in this list">
              <span class="opacity-70">${ICONS.DOWNLOAD}</span>
              <span>Save</span>
            </button>

            <button class="flex-[1.5] flex items-center justify-center gap-2 ${allRead ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white text-xs font-bold py-2 px-4 rounded-lg transition-all shadow-lg play-list-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    title="${allRead ? 'Restart' : hasProgress ? 'Continue' : 'Play'}">
              <span>${allRead ? '🔄' : '▶'}</span>
              <span>${allRead ? 'Restart' : hasProgress ? 'Resume' : 'Start'}</span>
            </button>
          </div>
        `;

        // Click handler for card (opens detail view)
        listDiv.addEventListener('click', (e) => {
          // Ignore if clicking on buttons
          if (e.target.closest('button')) return;
          if (isListEditMode) return; // Disable detail view in edit mode
          showReadingListDetail(list.id, list.name);
        });

        if (isListEditMode) {
          // Up/Down button handlers
          const upBtn = listDiv.querySelector('.reorder-up-btn');
          const downBtn = listDiv.querySelector('.reorder-down-btn');

          if (upBtn) {
            upBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const prev = listDiv.previousElementSibling;
              if (prev) {
                listsContainer.insertBefore(listDiv, prev);
              }
            });
          }

          if (downBtn) {
            downBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const next = listDiv.nextElementSibling;
              if (next) {
                listsContainer.insertBefore(next, listDiv);
              }
            });
          }
        }

        // Delete button handler
        const deleteBtn = listDiv.querySelector('.delete-list-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete "${list.name}"?`)) {
              await deleteReadingList(list.id);
            }
          });
        }

        // Read/Unread toggle handler
        const readToggleBtn = listDiv.querySelector('.read-toggle-btn');
        if (readToggleBtn) {
          readToggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isCurrentlyRead = readToggleBtn.dataset.currentStatus === 'true';
            const newStatus = !isCurrentlyRead;

            try {
              await global.ReadingLists.markListAsRead(list.id, newStatus);
              await refreshReadingListModal();
            } catch (error) {
              alert('Failed to update reading status. Please try again.');
            }
          });
        }

        // Download handler
        const downloadBtn = listDiv.querySelector('.download-list-btn');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const listId = downloadBtn.dataset.listId;
            const listName = downloadBtn.dataset.listName || 'Unknown List';

            if (typeof global.downloadReadingList === 'function') {
              await global.downloadReadingList(listId, listName, downloadBtn);
            } else {
              console.error('downloadReadingList function not available');
              alert('Download functionality is not available. Please refresh the page.');
            }
          });
        }

        // Play/Continue handler
        const playBtn = listDiv.querySelector('.play-list-btn');
        if (playBtn) {
          playBtn.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Check if library is loaded
            if (!global.library || Object.keys(global.library).length === 0) {
              alert('Library is still loading. Check the status badge at the top - it will show "Ready" when comics are available. Try again in a moment.');
              return;
            }

            try {
              const details = await global.ReadingLists.getReadingListDetails(list.id);

              // Find first unread or in-progress comic
              let firstComic = details.items.find(item => {
                const total = item.totalPages || 0;
                const last = item.lastReadPage || 0;
                return total === 0 || last < total - 1; // Not finished
              });

              // If all read, start from beginning
              if (!firstComic && details.items.length > 0) {
                firstComic = details.items[0];
              }

              if (firstComic) {
                // Find the comic in the library
                const comic = typeof global.getComicById === 'function' ? global.getComicById(firstComic.comicId) : null;
                if (comic && typeof global.openComicViewer === 'function') {
                  global.openComicViewer(comic, { readingListId: list.id, readingListName: list.name });
                  closeReadingListModal(); // Close modal after opening comic
                } else {
                  alert('Could not find comic in library. The comic may have been moved or deleted.');
                }
              }
            } catch (error) {
              console.error('Failed to play reading list:', error);
              alert('Failed to open comic. Please try again.');
            }
          });
        }

        listsContainer.appendChild(listDiv);
      });
    }
  }
}

/**
 * Create a new reading list
 */
async function createReadingList() {
  const name = prompt('Enter a name for your reading list:');

  if (!name || name.trim() === '') {
    return;
  }

  // Use API to create list
  if (typeof global.ReadingLists !== 'undefined' && typeof global.ReadingLists.createReadingList === 'function') {
    try {
      await global.ReadingLists.createReadingList(name.trim(), '', []);

      // Refresh the modal display
      await refreshReadingListModal();
    } catch (error) {
      console.error('[Reading List] Failed to create list:', error);
      alert('Failed to create reading list. Please try again.');
    }
  }
}

/**
 * Delete a reading list by ID
 * @param {string} listId - The ID of the list to delete
 */
async function deleteReadingList(listId) {
  if (!listId) return;

  try {
    // Get base URL
    const baseTag = document.querySelector('base');
    const baseUrl = baseTag && baseTag.href ? new URL(baseTag.href).pathname.replace(/\/$/, '') : '';

    // Call delete API
    const response = await fetch(`${baseUrl}/api/v1/reading-lists/${listId}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    if (data.ok) {
      await refreshReadingListModal();
    } else {
      throw new Error(data.message || 'Failed to delete list');
    }
  } catch (error) {
    console.error('[Reading List] Failed to delete list:', error);
    alert('Failed to delete reading list. Please try again.');
  }
}

/**
 * Show reading list detail view
 * @param {string} listId - The reading list ID
 * @param {string} listName - The reading list name
 */
async function showReadingListDetail(listId, listName) {
  const modalContent = document.getElementById('reading-lists-container').parentElement;
  if (!modalContent) return;

  // Hide main list view
  document.getElementById('reading-lists-container').classList.add('hidden');

  // Create detail view
  const detailView = document.createElement('div');
  detailView.id = 'reading-list-detail-view';
  detailView.className = 'flex-1 overflow-y-auto p-4 sm:p-6';

  detailView.innerHTML = `
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <button id="back-to-lists-btn" class="bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-full transition-all hover:scale-110 shadow-lg" title="Back to lists">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div>
          <h2 class="text-2xl font-bold text-white flex items-center gap-2">
            <span class="text-purple-400">📚</span>
            <span>${escapeHtml(listName)}</span>
          </h2>
          <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-0.5">
            <span>Reading List Detail</span>
            <span class="w-1 h-1 rounded-full bg-gray-700"></span>
            <span id="list-item-count-badge">Loading...</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button id="view-toggle-btn" class="bg-gray-700 hover:bg-gray-600 text-white p-2.5 rounded-lg transition-all shadow-lg" title="Toggle view">
          <span id="view-toggle-icon" class="text-lg">☰</span>
        </button>
        <button id="download-all-list-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg hover:shadow-purple-900/40 flex items-center gap-2">
          <span>⬇</span>
          <span class="hidden sm:inline">Download All</span>
        </button>
        <button id="export-list-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg hover:shadow-blue-900/40 flex items-center gap-2">
          <span>📤</span>
          <span class="hidden sm:inline">Export</span>
        </button>
        <button id="edit-list-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2.5 px-4 rounded-lg transition-all border border-gray-600 shadow-lg flex items-center gap-2">
          <span>✏️</span>
          <span class="hidden sm:inline">Edit</span>
        </button>
        <button id="save-order-btn" class="hidden bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-lg hover:shadow-green-900/40">
          Save Order
        </button>
        <button id="cancel-edit-btn" class="hidden bg-gray-600 hover:bg-gray-700 text-white font-bold py-2.5 px-4 rounded-lg transition-all border border-gray-500">
          Cancel
        </button>
      </div>
    </div>
    <div id="list-detail-comics-container" class="space-y-2">
      <p class="text-sm text-gray-400 text-center py-8 animate-pulse italic">Loading your collection...</p>
    </div>
  `;

  // Insert detail view
  modalContent.appendChild(detailView);

  // Add back button handler
  document.getElementById('back-to-lists-btn').addEventListener('click', hideReadingListDetail);

  // View mode state (detailed or compact)
  let viewMode = localStorage.getItem('readingListViewMode') || 'detailed';

  // Update toggle icon based on current view
  const updateViewToggleIcon = () => {
    const icon = document.getElementById('view-toggle-icon');
    const btn = document.getElementById('view-toggle-btn');
    if (icon && btn) {
      if (viewMode === 'detailed') {
        icon.textContent = '☰';
        btn.title = 'Switch to compact view';
      } else {
        icon.textContent = '▤';
        btn.title = 'Switch to detailed view';
      }
    }
  };

  // Initialize icon
  updateViewToggleIcon();

  // View toggle handler
  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    viewMode = viewMode === 'detailed' ? 'compact' : 'detailed';
    localStorage.setItem('readingListViewMode', viewMode);
    updateViewToggleIcon();
    renderComics();
  });

  // Edit mode state
  let isEditMode = false;
  let originalOrder = [];
  let currentDetails = null;

  // Load comics for this list
  async function renderComics() {
    try {
      const details = await global.ReadingLists.getReadingListDetails(listId);
      currentDetails = details;
      const comicsContainer = document.getElementById('list-detail-comics-container');
      const countBadge = document.getElementById('list-item-count-badge');

      if (!details.items || details.items.length === 0) {
        if (countBadge) countBadge.textContent = '0 items';
        comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
        return;
      }

      if (countBadge) countBadge.textContent = `${details.items.length} item${details.items.length === 1 ? '' : 's'}`;
      originalOrder = details.items.map(item => item.comicId);
      comicsContainer.innerHTML = '';

      // Set container layout based on view mode
      if (viewMode === 'compact') {
        comicsContainer.className = 'space-y-2';
      } else {
        comicsContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4';
      }

      details.items.forEach((item, index) => {
        const comic = typeof global.getComicById === 'function' ? global.getComicById(item.comicId) : null;
        if (!comic) return; // Skip if comic not found in library

        const comicDiv = document.createElement('div');
        comicDiv.dataset.comicId = item.comicId;
        if (isEditMode) comicDiv.classList.add('is-editing');

        // Use display info to get properly formatted comic name (not filename)
        const displayInfo = typeof global.applyDisplayInfoToComic === 'function' ? global.applyDisplayInfoToComic(comic) : {};
        const title = displayInfo.displayTitle || comic.name || 'Unknown';
        const total = item.totalPages || 0;
        const last = item.lastReadPage || 0;
        const progressPercent = total > 0 ? Math.round((last / total) * 100) : 0;

        // Determine status
        let status = 'unread';
        if (total > 0) {
          if (last >= total - 1) status = 'read';
          else if (last > 0) status = 'in-progress';
        } else if (last > 0) {
          status = 'in-progress';
        }

        const isDownloaded = global.downloadedComicIds?.has(comic.id);
        const downloadIndicator = isDownloaded ? '<span class="text-green-400 flex-shrink-0" title="Downloaded">📥</span>' : '';

        // Render based on view mode
        if (viewMode === 'compact') {
          // Compact view: minimal height, no progress bar
          comicDiv.className = 'bg-gray-800/50 p-3 rounded-lg flex items-center gap-3 hover:bg-gray-700 transition-all border border-gray-700/50 hover:border-purple-500/30 group';
          comicDiv.innerHTML = `
            ${isEditMode ? `
              <div class="flex flex-col gap-1 mr-1">
                <button class="reorder-up-btn text-gray-500 hover:text-white p-0.5" title="Move Up">▲</button>
                <button class="reorder-down-btn text-gray-500 hover:text-white p-0.5" title="Move Down">▼</button>
              </div>
            ` : ''}
            <div class="flex-shrink-0 flex items-center justify-center" style="width: 1.5rem; height: 1.5rem;">
              <span class="${status === 'read' ? 'text-green-500' : status === 'in-progress' ? 'text-purple-400' : 'text-gray-600'} text-lg">
                ${status === 'read' ? '●' : status === 'in-progress' ? '◐' : '○'}
              </span>
            </div>
            <div class="flex-1 min-w-0 flex items-center gap-2">
              <p class="text-sm font-medium text-gray-200 truncate group-hover:text-white transition-colors">${escapeHtml(title)}</p>
              ${isDownloaded ? `<span class="text-green-400 flex-shrink-0 opacity-70" title="Downloaded">${ICONS.READ}</span>` : ''}
            </div>
            <div class="flex-shrink-0 text-[10px] font-bold text-gray-500 bg-black/20 px-2 py-0.5 rounded uppercase tracking-tighter">
              ${progressPercent}%
            </div>
            <div class="flex items-center gap-1 ml-2">
              <button class="mark-read-btn ${isEditMode ? 'hidden' : ''} flex-shrink-0 text-gray-500 hover:text-green-400 transition-colors p-1.5 hover:bg-green-500/10 rounded" title="${status === 'read' ? 'Mark as unread' : 'Mark as read'}" data-comic-id="${escapeHtml(item.comicId)}" data-status="${status}">
                <span class="text-lg">${status === 'read' ? '↩' : ICONS.READ}</span>
              </button>
              <button class="download-comic-btn ${isEditMode ? 'hidden' : ''} block sm:hidden flex-shrink-0 text-gray-500 hover:text-blue-400 transition-colors p-1.5 hover:bg-blue-500/10 rounded" title="Download comic" data-comic-id="${escapeHtml(item.comicId)}">
                <span class="text-lg">${ICONS.DOWNLOAD}</span>
              </button>
              <button class="delete-comic-btn ${isEditMode ? 'hidden' : ''} flex-shrink-0 text-gray-600 hover:text-red-400 transition-colors p-1.5 hover:bg-red-500/10 rounded" title="Remove from list" data-comic-id="${escapeHtml(item.comicId)}">
                <span class="text-lg">🗑</span>
              </button>
            </div>
          `;
        } else {
          // Grid view: comic cards with covers
          comicDiv.className = 'comic-card bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-pointer flex flex-col border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';

          const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));
          const coverUrl = comic.thumbnailPath
            ? `${global.API_BASE_URL}/thumbnails/${comic.thumbnailPath}`
            : 'https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover';

          const statusBanner = (status === 'read' && !isLocal)
            ? '<div class="status-banner status-read">Read</div>'
            : (status === 'in-progress' && !isLocal)
            ? '<div class="status-banner status-in-progress">In Progress</div>'
            : '';

          const downloadIndicatorGrid = isDownloaded
            ? `<div class="absolute bottom-2 right-2 bg-gray-900/80 backdrop-blur p-1 rounded text-green-400 z-10" title="Downloaded">${ICONS.READ}</div>`
            : '';

          comicDiv.innerHTML = `
            <div class="relative">
              ${isEditMode ? `
                <div class="absolute top-2 left-2 z-20 flex items-center gap-1 bg-gray-900/80 backdrop-blur p-1.5 rounded-lg shadow-xl">
                  <div class="flex flex-col gap-1">
                    <button class="reorder-up-btn text-gray-400 hover:text-white p-0.5 transition-colors" title="Move Up">▲</button>
                    <button class="reorder-down-btn text-gray-400 hover:text-white p-0.5 transition-colors" title="Move Down">▼</button>
                  </div>
                </div>
              ` : ''}
              ${statusBanner}
              ${!isLocal ? downloadIndicatorGrid : ''}
              <div class="aspect-[2/3] w-full bg-gray-700 overflow-hidden flex items-center justify-center">
                ${comic.thumbnailPath ? 
                  `<img src="${coverUrl}" alt="${escapeHtml(title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">` :
                  (isLocal ? 
                    `<div class="text-purple-500">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>` :
                    `<img src="${coverUrl}" alt="${escapeHtml(title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">`
                  )
                }
              </div>
              <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-900/50">
                <div class="h-full ${status === 'read' ? 'bg-green-500' : 'bg-purple-600'} transition-all duration-500" style="width: ${progressPercent}%;"></div>
              </div>
              ${!isEditMode ? `
                <div class="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  ${!isLocal ? `
                    <button class="mark-read-btn bg-gray-900/80 backdrop-blur p-2 rounded-lg text-gray-400 hover:text-green-400 transition-all shadow-xl" title="${status === 'read' ? 'Mark as unread' : 'Mark as read'}" data-comic-id="${escapeHtml(item.comicId)}" data-status="${status}">
                      ${status === 'read' ? '↩' : ICONS.READ}
                    </button>
                  ` : ''}
                  ${!isLocal ? `
                    <button class="download-comic-btn block sm:hidden bg-gray-900/80 backdrop-blur p-2 rounded-lg text-gray-400 hover:text-blue-400 transition-all shadow-xl" title="Download comic" data-comic-id="${escapeHtml(item.comicId)}">
                      ${ICONS.DOWNLOAD}
                    </button>
                  ` : ''}
                  <button class="delete-comic-btn bg-gray-900/80 backdrop-blur p-2 rounded-lg text-red-500 hover:text-red-400 transition-all shadow-xl" title="Remove from list" data-comic-id="${escapeHtml(item.comicId)}">
                    🗑
                  </button>
                </div>
              ` : ''}
            </div>
            <div class="p-3 flex-grow flex flex-col justify-center min-w-0">
              <p class="text-sm font-bold text-white truncate leading-tight">${escapeHtml(title)}</p>
              <div class="flex items-center gap-1.5 mt-1">
                 <span class="text-[10px] font-bold uppercase tracking-tighter text-gray-500">${progressPercent}% COMPLETE</span>
              </div>
            </div>
          `;
        }

        // Click to open comic (only when not in edit mode)
        if (!isEditMode) {
          comicDiv.style.cursor = 'pointer';
          comicDiv.addEventListener('click', () => {
            if (typeof global.openComicViewer === 'function') {
              global.openComicViewer(comic, { readingListId: listId, readingListName: listName });
              closeReadingListModal();
            }
          });
        }

        // Up/Down button handlers (only in edit mode)
        if (isEditMode) {
          const upBtn = comicDiv.querySelector('.reorder-up-btn');
          const downBtn = comicDiv.querySelector('.reorder-down-btn');

          if (upBtn) {
            upBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const prev = comicDiv.previousElementSibling;
              if (prev) {
                comicsContainer.insertBefore(comicDiv, prev);
              }
            });
          }

          if (downBtn) {
            downBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const next = comicDiv.nextElementSibling;
              if (next) {
                comicsContainer.insertBefore(next, comicDiv);
              }
            });
          }
        }

        // Mark as read/unread button handler
        const markReadBtn = comicDiv.querySelector('.mark-read-btn');
        if (markReadBtn) {
          markReadBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent opening comic

            const currentStatus = markReadBtn.dataset.status;
            const newStatus = currentStatus === 'read' ? 'unread' : 'read';

            try {
              // Call the API to update status
              const response = await fetch(`${global.API_BASE_URL}/api/v1/comics/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comicId: item.comicId, status: newStatus })
              });

              if (!response.ok) throw new Error('Failed to update status');

              // Refresh the view to show updated status
              await renderComics();
            } catch (error) {
              console.error('Failed to update comic status:', error);
              alert('Failed to update comic status. Please try again.');
            }
          });
        }

        // Download button handler
        const downloadBtn = comicDiv.querySelector('.download-comic-btn');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent opening comic

            if (typeof global.downloadComic === 'function') {
              await global.downloadComic(comic, downloadBtn);
            } else {
              console.error('downloadComic function not available');
              alert('Download functionality is not available. Please refresh the page.');
            }
          });
        }

        // Delete button handler
        const deleteBtn = comicDiv.querySelector('.delete-comic-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent opening comic

            const confirmDelete = confirm(`Remove "${title}" from this reading list?`);
            if (!confirmDelete) return;

            try {
              const result = await global.ReadingLists.removeComicsFromList(listId, [item.comicId]);
              if (result.ok) {
                // Refresh detail view
                const comicsContainer = document.getElementById('list-detail-comics-container');
                comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading comics...</p>';

                const details = await global.ReadingLists.getReadingListDetails(listId);
                if (!details.items || details.items.length === 0) {
                  comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
                } else {
                  // Reload the entire detail view to refresh all comics
                  hideReadingListDetail();
                  showReadingListDetail(listId, listName);
                }
              } else {
                alert('Failed to remove comic from list. Please try again.');
              }
            } catch (error) {
              console.error('Failed to delete comic from list:', error);
              alert('Failed to remove comic from list. Please try again.');
            }
          });
        }

        comicsContainer.appendChild(comicDiv);
      });
    } catch (error) {
      console.error('Failed to load reading list details:', error);
      document.getElementById('list-detail-comics-container').innerHTML = '<p class="text-sm text-red-400 text-center py-4">Failed to load comics.</p>';
    }
  }

  // Download All button handler
  const downloadAllBtn = document.getElementById('download-all-list-btn');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      if (typeof global.downloadReadingList === 'function') {
        await global.downloadReadingList(listId, listName, downloadAllBtn);
      } else {
        console.error('downloadReadingList function not available');
        alert('Download functionality is not available. Please refresh the page.');
      }
    });
  }

  // Export button handler
  document.getElementById('export-list-btn').addEventListener('click', async () => {
    try {
      await global.ReadingLists.exportSingleList(listId, listName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export list. Please try again.');
    }
  });

  // Edit button handler
  document.getElementById('edit-list-btn').addEventListener('click', () => {
    isEditMode = true;
    document.getElementById('edit-list-btn').classList.add('hidden');
    document.getElementById('save-order-btn').classList.remove('hidden');
    document.getElementById('cancel-edit-btn').classList.remove('hidden');
    renderComics();
  });

  // Save button handler
  document.getElementById('save-order-btn').addEventListener('click', async () => {
    try {
      const comicsContainer = document.getElementById('list-detail-comics-container');
      const comicDivs = comicsContainer.querySelectorAll('[data-comic-id]');
      const newOrder = Array.from(comicDivs).map(div => div.dataset.comicId);

      const result = await global.ReadingLists.reorderComics(listId, newOrder);
      if (result.ok) {
        isEditMode = false;
        document.getElementById('edit-list-btn').classList.remove('hidden');
        document.getElementById('save-order-btn').classList.add('hidden');
        document.getElementById('cancel-edit-btn').classList.add('hidden');
        renderComics();
      } else {
        alert('Failed to save new order. Please try again.');
      }
    } catch (error) {
      console.error('Failed to save order:', error);
      alert('Failed to save new order. Please try again.');
    }
  });

  // Cancel button handler
  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    isEditMode = false;
    document.getElementById('edit-list-btn').classList.remove('hidden');
    document.getElementById('save-order-btn').classList.add('hidden');
    document.getElementById('cancel-edit-btn').classList.add('hidden');
    renderComics();
  });

  // Initial render
  renderComics();
}

/**
 * Hide reading list detail view and return to main list
 */
function hideReadingListDetail() {
  const detailView = document.getElementById('reading-list-detail-view');
  if (detailView) {
    detailView.remove();
  }

  // Show main list view
  const mainView = document.getElementById('reading-lists-container');
  if (mainView) {
    mainView.classList.remove('hidden');
  }
}

// Helper to estimate library size
function estimateLibrarySize(lib) {
  if (!lib) return 0;
  let count = 0;
  for (const rootKey of Object.keys(lib)) {
    const publishers = lib[rootKey]?.publishers || {};
    for (const publisherName of Object.keys(publishers)) {
      const seriesEntries = publishers[publisherName]?.series || {};
      for (const seriesName of Object.keys(seriesEntries)) {
        const comics = seriesEntries[seriesName];
        if (Array.isArray(comics)) {
          count += comics.length;
        }
      }
    }
  }
  return count;
}

// Add event listeners for reading list modal (after DOM loads)
document.addEventListener('DOMContentLoaded', () => {
  registerRoutes();

  // Close button
  const closeBtn = document.getElementById('reading-list-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeReadingListModal);
  }

  // Create reading list button
  const createBtn = document.getElementById('create-reading-list-btn');
  if (createBtn) {
    createBtn.addEventListener('click', createReadingList);
  }

  // Export All Lists button
  const exportAllBtn = document.getElementById('export-all-lists-btn');
  if (exportAllBtn) {
    exportAllBtn.addEventListener('click', async () => {
      try {
        await global.ReadingLists.exportAllLists();
      } catch (error) {
        alert('Failed to export lists. Please try again.');
      }
    });
  }

  // Import Lists button
  const importBtn = document.getElementById('import-lists-btn');
  const fileInput = document.getElementById('import-file-input');
  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Check for duplicate names
        const existingLists = await global.ReadingLists.fetchReadingLists();
        const existingNames = new Set(existingLists.map(list => list.name.toLowerCase()));

        const listsToImport = Array.isArray(data) ? data : [data];
        const processedLists = [];

        for (const list of listsToImport) {
          if (existingNames.has(list.name.toLowerCase())) {
            const choice = confirm(
              `A reading list named "${list.name}" already exists.\n\n` +
              `Click OK to rename the imported list (will add " (imported)")\n` +
              `Click Cancel to skip this list`
            );

            if (choice) {
              // Rename
              list.name = `${list.name} (imported)`;
              processedLists.push(list);
            }
          } else {
            processedLists.push(list);
          }
        }

        if (processedLists.length === 0) {
          alert('No lists were imported.');
          fileInput.value = '';
          return;
        }

        const result = await global.ReadingLists.importLists(processedLists);
        if (result.ok) {
          alert(`Successfully imported ${processedLists.length} list(s)!`);
          await refreshReadingListModal();
        } else {
          alert('Failed to import lists. Please try again.');
        }
      } catch (error) {
        console.error('Import error:', error);
        alert('Failed to import lists. Please check the file format and try again.');
      }

      fileInput.value = '';
    });
  }

  // Edit Reading Lists button
  const editReadingListsBtn = document.getElementById('edit-reading-lists-btn');
  if (editReadingListsBtn) {
    editReadingListsBtn.addEventListener('click', () => {
      isListEditMode = true;
      refreshReadingListModal();
    });
  }

  // Save Reading Lists order button
  const saveReadingListsOrderBtn = document.getElementById('save-reading-lists-order-btn');
  if (saveReadingListsOrderBtn) {
    saveReadingListsOrderBtn.addEventListener('click', async () => {
      try {
        const listsContainer = document.getElementById('reading-lists-container');
        const listDivs = listsContainer.querySelectorAll('[data-list-id]');
        const listOrder = Array.from(listDivs).map(div => div.dataset.listId);

        // Get base URL
        const baseTag = document.querySelector('base');
        const baseUrl = baseTag && baseTag.href ? new URL(baseTag.href).pathname.replace(/\/$/, '') : '';

        const response = await fetch(`${baseUrl}/api/v1/reading-lists/reorder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listOrder })
        });

        const data = await response.json();
        if (data.ok) {
          isListEditMode = false;
          refreshReadingListModal();
        } else {
          alert('Failed to save reading list order: ' + (data.message || 'Unknown error'));
        }
      } catch (error) {
        console.error('Failed to save reading list order:', error);
        alert('Failed to save reading list order. Please try again.');
      }
    });
  }

  // Cancel Reading Lists edit button
  const cancelReadingListsEditBtn = document.getElementById('cancel-reading-lists-edit-btn');
  if (cancelReadingListsEditBtn) {
    cancelReadingListsEditBtn.addEventListener('click', () => {
      isListEditMode = false;
      refreshReadingListModal();
    });
  }

  // Close modal when clicking outside
  const modal = document.getElementById('reading-list-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeReadingListModal();
      }
    });
  }
});

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initializeApp();
}

export {
  cacheAppConfig,
  loadCachedAppConfig,
  resolveAppConfig,
  showOfflineLibraryUnavailableMessage,
  updateLibraryStatusBadge,
  initEnvironment,
  registerServiceWorker,
  initAppStorage,
  initUIControls,
  loadInitialData,
  initializeApp,
  loadLibraryOfflineFirst,
  fetchLibraryFromServer,
  showUserBadge,
  hideAdminUI,
  openReadingListModal,
  closeReadingListModal,
  refreshReadingListModal,
  createReadingList,
  deleteReadingList,
  showReadingListDetail,
  hideReadingListDetail
};

state.cacheAppConfig = cacheAppConfig;
state.loadCachedAppConfig = loadCachedAppConfig;
state.resolveAppConfig = resolveAppConfig;
state.showOfflineLibraryUnavailableMessage = showOfflineLibraryUnavailableMessage;
state.updateLibraryStatusBadge = updateLibraryStatusBadge;
state.initEnvironment = initEnvironment;
state.registerServiceWorker = registerServiceWorker;
state.initAppStorage = initAppStorage;
state.initUIControls = initUIControls;
state.loadInitialData = loadInitialData;
state.initializeApp = initializeApp;
state.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
state.fetchLibraryFromServer = fetchLibraryFromServer;
state.showUserBadge = showUserBadge;
state.hideAdminUI = hideAdminUI;
state.openReadingListModal = openReadingListModal;
state.closeReadingListModal = closeReadingListModal;
state.refreshReadingListModal = refreshReadingListModal;
state.createReadingList = createReadingList;
state.deleteReadingList = deleteReadingList;
state.showReadingListDetail = showReadingListDetail;
state.hideReadingListDetail = hideReadingListDetail;

if (typeof window !== 'undefined') {
  window.cacheAppConfig = cacheAppConfig;
  window.loadCachedAppConfig = loadCachedAppConfig;
  window.resolveAppConfig = resolveAppConfig;
  window.showOfflineLibraryUnavailableMessage = showOfflineLibraryUnavailableMessage;
  window.updateLibraryStatusBadge = updateLibraryStatusBadge;
  window.initEnvironment = initEnvironment;
  window.registerServiceWorker = registerServiceWorker;
  window.initAppStorage = initAppStorage;
  window.initUIControls = initUIControls;
  window.loadInitialData = loadInitialData;
  window.initializeApp = initializeApp;
  window.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
  window.fetchLibraryFromServer = fetchLibraryFromServer;
  window.showUserBadge = showUserBadge;
  window.hideAdminUI = hideAdminUI;
  window.openReadingListModal = openReadingListModal;
  window.closeReadingListModal = closeReadingListModal;
  window.refreshReadingListModal = refreshReadingListModal;
  window.createReadingList = createReadingList;
  window.deleteReadingList = deleteReadingList;
  window.showReadingListDetail = showReadingListDetail;
  window.hideReadingListDetail = hideReadingListDetail;
}
