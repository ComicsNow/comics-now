(function (global) {
  'use strict';

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
      window.addEventListener('online', () => {
        OfflineStatus.updateOfflineIndicator();
        OfflineStatus.scheduleOfflineProgressSync(true);
        OfflineStatus.syncOfflineStatuses().catch(error => {
          
        });

        if (typeof global.fetchLibraryFromServer === 'function') {
          global.fetchLibraryFromServer().catch(error => {
            
          });
        }
      });

      window.addEventListener('offline', () => {
        OfflineStatus.updateOfflineIndicator();
      });

      document.addEventListener('DOMContentLoaded', () => {
        OfflineStatus.updateOfflineIndicator();
        setInterval(() => OfflineStatus.updateOfflineIndicator(), 5000);
      });

      setInterval(() => {
        if (navigator.onLine !== false) {
          OfflineStatus.enhancedBackgroundSync().catch(error => {
            
          });
        }
      }, 2 * 60 * 1000);
    }
  }

  global.initializeOfflineFeatures = initializeOfflineFeatures;
  initializeOfflineFeatures();
})(typeof window !== 'undefined' ? window : globalThis);
