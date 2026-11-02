import { state } from '../globals.js';
import {
  PROGRESS_SYNC_DEBOUNCE_MS,
  scheduleOfflineProgressSync,
  syncOfflineProgress,
  updateLibraryProgress,
  findComicInLibraryById,
  enhancedBackgroundSync
} from './status/progress-sync.js';
import {
  saveStatusToDB,
  updateOfflineReadStatus,
  updateOfflineSeriesStatus,
  mergeOfflineStatusesIntoLibrary,
  syncOfflineStatuses
} from './status/db-sync.js';

export {
  PROGRESS_SYNC_DEBOUNCE_MS,
  scheduleOfflineProgressSync,
  syncOfflineProgress,
  updateLibraryProgress,
  findComicInLibraryById,
  enhancedBackgroundSync,
  saveStatusToDB,
  updateOfflineReadStatus,
  updateOfflineSeriesStatus,
  mergeOfflineStatusesIntoLibrary,
  syncOfflineStatuses
};

let lastKnownOnlineState = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
let activeProbePromise = null;

export function setLastKnownOnlineState(val) {
  lastKnownOnlineState = Boolean(val);
}

export function isAppOnline() {
  if (lastKnownOnlineState === true) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine) return true;
  return false;
}

export async function checkServerConnectivity({ timeout = 3000, force = false } = {}) {
  if (activeProbePromise && !force) return activeProbePromise;

  activeProbePromise = (async () => {
    const apiBaseUrl = state.API_BASE_URL || (typeof window !== 'undefined' ? window.API_BASE_URL : '') || '';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller && typeof setTimeout === 'function' ? setTimeout(() => controller.abort(), timeout) : null;

    try {
      const url = `${apiBaseUrl}/api/v1/health?_t=${Date.now()}`;
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller?.signal
      });

      if (res && (res.ok || res.status === 200)) {
        const wasOffline = lastKnownOnlineState === false;
        lastKnownOnlineState = true;
        updateOfflineIndicator();
        if (wasOffline && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event('online'));
        }
        return true;
      }
    } catch (err) {
      // Network probe failed
    } finally {
      if (timeoutId && typeof clearTimeout === 'function') clearTimeout(timeoutId);
      activeProbePromise = null;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      lastKnownOnlineState = false;
      updateOfflineIndicator();
    }
    return false;
  })();

  return activeProbePromise;
}

export function updateOfflineIndicator() {
  const offlineIndicator = typeof document !== 'undefined' ? document.getElementById('offline-indicator') : null;
  const navOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  
  let isOffline = navOffline;
  if (lastKnownOnlineState === true && navOffline) {
    isOffline = false;
    checkServerConnectivity();
  } else if (lastKnownOnlineState === false) {
    isOffline = true;
  } else if (lastKnownOnlineState === true && !navOffline) {
    isOffline = false;
  }
  
  if (offlineIndicator) {
    if (isOffline) {
      offlineIndicator.classList.remove('hidden');
    } else {
      offlineIndicator.classList.add('hidden');
    }
  }
  
  if (typeof document !== 'undefined' && document.body && document.body.classList) {
    document.body.classList.toggle('is-offline', isOffline);
  }
  return isOffline;
}

export const OfflineStatus = {
  get PROGRESS_SYNC_DEBOUNCE_MS() {
    return typeof PROGRESS_SYNC_DEBOUNCE_MS !== 'undefined' ? PROGRESS_SYNC_DEBOUNCE_MS : 400;
  },
  scheduleOfflineProgressSync: (...args) => (typeof scheduleOfflineProgressSync === 'function' ? scheduleOfflineProgressSync(...args) : undefined),
  syncOfflineProgress: (...args) => (typeof syncOfflineProgress === 'function' ? syncOfflineProgress(...args) : undefined),
  syncOfflineStatuses: (...args) => (typeof syncOfflineStatuses === 'function' ? syncOfflineStatuses(...args) : undefined),
  updateLibraryProgress: (...args) => (typeof updateLibraryProgress === 'function' ? updateLibraryProgress(...args) : undefined),
  updateOfflineReadStatus: (...args) => (typeof updateOfflineReadStatus === 'function' ? updateOfflineReadStatus(...args) : undefined),
  updateOfflineSeriesStatus: (...args) => (typeof updateOfflineSeriesStatus === 'function' ? updateOfflineSeriesStatus(...args) : undefined),
  findComicInLibraryById: (...args) => (typeof findComicInLibraryById === 'function' ? findComicInLibraryById(...args) : undefined),
  updateOfflineIndicator,
  mergeOfflineStatusesIntoLibrary: (...args) => (typeof mergeOfflineStatusesIntoLibrary === 'function' ? mergeOfflineStatusesIntoLibrary(...args) : undefined),
  enhancedBackgroundSync: (...args) => (typeof enhancedBackgroundSync === 'function' ? enhancedBackgroundSync(...args) : undefined),
  saveStatusToDB: (...args) => (typeof saveStatusToDB === 'function' ? saveStatusToDB(...args) : undefined),
  setLastKnownOnlineState,
  isAppOnline,
  checkServerConnectivity
};

state.OfflineStatus = OfflineStatus;
Object.assign(state, OfflineStatus);

if (typeof window !== 'undefined') {
  window.OfflineStatus = OfflineStatus;
  Object.assign(window, OfflineStatus);
}
