(function (global) {
  'use strict';

  const OfflineDB = global.OfflineDB || {};

  /**
   * Listen for Service Worker messages (progress updates, status changes)
   */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const { type, comicId, progress, status, error } = event.data;
      const downloadManager = global.downloadManager;
      
      if (!downloadManager) return;

      // Reload queue from IndexedDB to get latest state
      await downloadManager.loadQueue();

      // Find the item in queue
      const item = downloadManager.persistentQueue.find(i => i.id === comicId);

      if (item) {
        // Update item based on message type
        if (type === 'download-progress' && typeof progress !== 'undefined') {
          item.progress = progress;
        } else if (type === 'download-status' && status) {
          item.status = status;
        } else if (type === 'download-complete') {
          item.status = 'completed';
          item.progress = 1;

          // Sync downloadedComicIds from IndexedDB — the SW saved the comic there
          // but downloadedComicIds in the page context was never updated
          if (typeof OfflineDB !== 'undefined' && typeof OfflineDB.getAllDownloadedComicIds === 'function') {
            await OfflineDB.getAllDownloadedComicIds();
          } else if (comicId && global.downloadedComicIds) {
            global.downloadedComicIds.add(comicId);
          }

          // Re-render to show download checkmarks
          if (typeof applyFilterAndRender === 'function') {
            applyFilterAndRender();
          }

          // Refresh downloads info in settings
          if (typeof global.refreshDownloadsInfo === 'function') {
            await global.refreshDownloadsInfo();
          }
        } else if (type === 'download-error' && error) {
          item.status = 'error';
          item.error = error;
        }

        // Update UI
        downloadManager.updateQueueUI();
      }
    });
  }

  /**
   * Request notification permission for download completion alerts
   */
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('[DOWNLOAD] Error requesting notification permission:', error);
      return false;
    }
  }

  global.requestNotificationPermission = requestNotificationPermission;

})(typeof window !== 'undefined' ? window : globalThis);
