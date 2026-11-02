import {
  state,
  global as canonicalGlobal,
  escapeHtml,
  createErrorMessage,
  getRelativePath,
  rootFolderListContainer
} from '../globals.js';
import { isAppOnline } from '../offline/status.js';
import { loadLibraryOfflineFirst } from './library-loader.js';

export const appGlobal = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const APP_CONFIG_STORAGE_KEY = 'comics-now-app-config';

export function cacheAppConfig(config) {
  if (!config || typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('[cacheAppConfig]', error);
  }
}

export function loadCachedAppConfig() {
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

export function resolveAppConfig() {
  if (appGlobal.APP_CONFIG && typeof appGlobal.APP_CONFIG === 'object') {
    cacheAppConfig(appGlobal.APP_CONFIG);
    return appGlobal.APP_CONFIG;
  }

  const cached = loadCachedAppConfig();
  if (cached) {
    appGlobal.APP_CONFIG = cached;
    return cached;
  }

  return null;
}

export function showOfflineLibraryUnavailableMessage() {
  const offline = typeof isAppOnline === 'function' ? !isAppOnline() : navigator.onLine === false;
  const message = offline
    ? 'Offline library unavailable. Connect to the server while online at least once to sync your comics for offline use.'
    : 'Unable to load the comics library. Check that the server is running and reachable.';

  if (typeof appGlobal.showRootFolderList === 'function') {
    appGlobal.showRootFolderList({ force: true });
  }

  if (rootFolderListContainer) {
    rootFolderListContainer.innerHTML = createErrorMessage(message);
  }
}

// --- LIBRARY STATUS TRACKING ---
appGlobal.libraryReady = false;
appGlobal.libraryLoadedAt = null;

/**
 * Phase 1: Environment and configuration setup
 */
export function initEnvironment() {
  const config = resolveAppConfig() || { baseUrl: '/', libraries: [] };
  appGlobal.APP_CONFIG = config;

  // 1) Work out the base URL the server mounted us at (no trailing slash)
  appGlobal.API_BASE_URL = (config.baseUrl || '').replace(/\/$/, '');
  
  // Store library names for display mapping
  appGlobal.LIBRARY_NAMES = {};
  appGlobal.configuredRootFolders = [];

  if (Array.isArray(config.libraries)) {
    config.libraries.forEach(lib => {
      if (typeof lib === 'object' && lib.id && lib.name) {
        appGlobal.LIBRARY_NAMES[lib.id] = lib.name;
        appGlobal.configuredRootFolders.push(lib.id);
      }
    });
  }

  // 2) Keep <base> tag in sync (with trailing slash)
  const baseEl = document.querySelector('base');
  if (baseEl) baseEl.href = `${appGlobal.API_BASE_URL}/`;

  return config;
}

/**
 * Phase 2: Service worker registration
 */
export async function registerServiceWorker(config) {
  // 3) Register the service worker for this mount
  if ('serviceWorker' in navigator) {
    if (location.port === '5173') {
      // Vite dev server - unregister to avoid caching during development
      const regs = await navigator.serviceWorker.getRegistrations();
      regs.forEach(reg => reg.unregister());
    } else {
      try {
        const registration = await navigator.serviceWorker.register(`${appGlobal.API_BASE_URL}/service-worker.js`, {
          scope: `${appGlobal.API_BASE_URL}/`,
          updateViaCache: 'none'
        });
        registration.update();
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                console.log('[SW] Service worker updated and active.');
              }
            });
          }
        });
      } catch (error) {
        console.warn('[SW] Registration failed:', error);
      }
    }
  }
}

/**
 * Phase 3: Storage and database initialization
 */
export async function initAppStorage() {
  // 4) App init - prioritize offline data
  if (typeof appGlobal.openOfflineDB === 'function') {
    await appGlobal.openOfflineDB();
  }
  if (typeof appGlobal.getDeviceLibraries === 'function') {
    try {
      await appGlobal.getDeviceLibraries();
    } catch (_) {}
  }

  // Initialize download queue and resume any pending downloads
  if (typeof appGlobal.initializeDownloadQueue === 'function') {
    try {
      await appGlobal.initializeDownloadQueue();
    } catch (error) {
      console.error('[APP] Failed to initialize download queue:', error);
    }
  }

  // Initialize JWT token capture for Cloudflare Access authentication
  // This enables background downloads to work with authentication enabled
  if (typeof appGlobal.initializeJWTCapture === 'function') {
    try {
      await appGlobal.initializeJWTCapture(30 * 60 * 1000); // Refresh every 30 minutes
    } catch (error) {
      console.error('[APP] Failed to initialize JWT capture:', error);
    }
  }
}

/**
 * Phase 4: UI controls initialization
 */
export function initUIControls() {
  if (typeof appGlobal.initializeLibraryUIControls === 'function') {
    appGlobal.initializeLibraryUIControls();
  }
  if (typeof appGlobal.initializeViewerUIControls === 'function') {
    appGlobal.initializeViewerUIControls();
  }
  if (typeof appGlobal.initializeProgressTracking === 'function') {
    appGlobal.initializeProgressTracking();
  }
  if (typeof appGlobal.initComicsDefaults === 'function') {
    appGlobal.initComicsDefaults();
  }
}

/**
 * Phase 5: Initial data loading
 */
export async function loadInitialData() {
  // 4.5) Load manga mode preference early
  try {
    const response = await fetch(`${appGlobal.API_BASE_URL}/api/v1/manga-mode-preference`);
    const data = await response.json();
    if (response.ok && data.ok) {
      appGlobal.mangaModePreference = data.mangaMode;
    }
  } catch (error) {
    console.warn('[initializeApp:mangaModePreference]', error);
  }

  // 5) Load library from cache first, then sync with server
  await loadLibraryOfflineFirst();

  // 6) Pre-fetch reading lists for smart filter integration
  if (appGlobal.LibrarySmartLists && typeof appGlobal.LibrarySmartLists.fetchAndCacheReadingLists === 'function') {
    appGlobal.LibrarySmartLists.fetchAndCacheReadingLists().catch(err => console.warn('[loadInitialData:readingLists]', err));
  }
}

export async function initializeApp() {
  appGlobal._isAppInitializing = true;
  try {
    const config = initEnvironment();
    await registerServiceWorker(config);
    await initAppStorage();
    initUIControls();
    await loadInitialData();

    if (appGlobal.router) {
      appGlobal.router.navigate(getRelativePath() + appGlobal.location.search, false);
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
    appGlobal._isAppInitializing = false;
  }
}
