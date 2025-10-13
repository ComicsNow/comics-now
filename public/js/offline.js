(function (global) {
  'use strict';

  function initializeOfflineFeatures() {
    const OfflineDB = global.OfflineDB;
    const OfflineStatus = global.OfflineStatus;
    const OfflineDownloads = global.OfflineDownloads;

    if (!OfflineDB || !OfflineStatus || !OfflineDownloads) {
      
      return;
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
