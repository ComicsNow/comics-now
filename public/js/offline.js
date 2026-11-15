import { state, global as canonicalGlobal } from './globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

async function initializeOfflineFeatures() {
  const OfflineDB = global.OfflineDB;
  const OfflineStatus = global.OfflineStatus;
  const OfflineDownloads = global.OfflineDownloads;

  if (!OfflineDB || !OfflineStatus || !OfflineDownloads) {
    return;
  }

  // Initialize downloadedComicIds early to ensure offline reading works from any view
  try {
    if (typeof OfflineDB.getAllDownloadedComicIds === 'function') {
      await OfflineDB.getAllDownloadedComicIds();
    }
  } catch (error) {
    console.error('[OFFLINE] Failed to initialize downloaded comic IDs:', error);
  }

  if (typeof window !== 'undefined') {
    const syncIfDirtyAndOnline = async () => {
      const online = typeof OfflineStatus.isAppOnline === 'function'
        ? OfflineStatus.isAppOnline()
        : navigator.onLine !== false;
      if (!online) return;
      const dirty = typeof OfflineStatus.hasPendingOfflineSync === 'function'
        ? await OfflineStatus.hasPendingOfflineSync()
        : true;
      if (dirty) {
        OfflineStatus.enhancedBackgroundSync().catch(() => {});
      }
    };

    global.addEventListener('online', () => {
      OfflineStatus.setLastKnownOnlineState?.(true);
      OfflineStatus.stopConnectivityProbe?.();
      OfflineStatus.updateOfflineIndicator();
      syncIfDirtyAndOnline();

      if (typeof global.fetchLibraryFromServer === 'function') {
        global.fetchLibraryFromServer().catch(() => {});
      }
    });

    global.addEventListener('offline', () => {
      OfflineStatus.markAppOffline?.();
      OfflineStatus.updateOfflineIndicator();
      if (typeof OfflineStatus.checkServerConnectivity === 'function') {
        OfflineStatus.checkServerConnectivity().catch(() => {});
      }
    });

    const handleResume = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof OfflineStatus.isAppOnline === 'function' && !OfflineStatus.isAppOnline()) {
        OfflineStatus.checkServerConnectivity?.().catch(() => {});
      } else {
        syncIfDirtyAndOnline();
      }
    };

    const handlePause = () => {
      OfflineStatus.stopConnectivityProbe?.();
      OfflineStatus.cancelOfflineSyncRetry?.();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          handlePause();
        } else {
          handleResume();
        }
      });
      document.addEventListener('freeze', handlePause);
      document.addEventListener('resume', handleResume);
    }

    global.addEventListener('focus', handleResume);
    global.addEventListener('pagehide', handlePause);
    global.addEventListener('pageshow', (event) => {
      if (event?.persisted) {
        handleResume();
      }
    });

    global.addEventListener('storage', (event) => {
      const dirtyKey = OfflineStatus.OFFLINE_SYNC_DIRTY_KEY || 'comicsNow_offlineSyncDirty';
      if (event?.key === dirtyKey && event?.newValue === '1') {
        syncIfDirtyAndOnline();
      }
    });

    const onDOMReady = () => {
      OfflineStatus.updateOfflineIndicator();
      if (typeof OfflineStatus.isAppOnline === 'function' && !OfflineStatus.isAppOnline()) {
        OfflineStatus.scheduleConnectivityProbe?.();
      } else {
        syncIfDirtyAndOnline();
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMReady);
    } else {
      onDOMReady();
    }
  }
}

export {
  initializeOfflineFeatures
};

state.initializeOfflineFeatures = initializeOfflineFeatures;

if (typeof window !== 'undefined') {
  window.initializeOfflineFeatures = initializeOfflineFeatures;
}

// Auto-initialize on load
initializeOfflineFeatures();

