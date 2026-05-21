import { state } from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
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
    global.addEventListener('online', () => {
      OfflineStatus.updateOfflineIndicator();
      OfflineStatus.scheduleOfflineProgressSync(true);
      OfflineStatus.syncOfflineStatuses().catch(error => {
        
      });

      if (typeof global.fetchLibraryFromServer === 'function') {
        global.fetchLibraryFromServer().catch(error => {
          
        });
      }
    });

    global.addEventListener('offline', () => {
      OfflineStatus.updateOfflineIndicator();
    });

    // Note: Since DOMContentLoaded might have already fired, we check document.readyState
    const onDOMReady = () => {
      OfflineStatus.updateOfflineIndicator();
      setInterval(() => OfflineStatus.updateOfflineIndicator(), 5000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMReady);
    } else {
      onDOMReady();
    }

    setInterval(() => {
      if (navigator.onLine !== false) {
        OfflineStatus.enhancedBackgroundSync().catch(error => {
          
        });
      }
    }, 2 * 60 * 1000);
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

