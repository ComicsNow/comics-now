import { state } from '../globals.js';
import { OfflineDB } from './db-namespace.js';

/**
 * Listen for Service Worker messages (progress updates, status changes)
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    const { type, comicId, progress, status, error } = event.data;
    const downloadManager = state.downloadManager || window.downloadManager;
    
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
        if (OfflineDB && typeof OfflineDB.getAllDownloadedComicIds === 'function') {
          await OfflineDB.getAllDownloadedComicIds();
        } else if (comicId) {
          const idSet = state.downloadedComicIds || window.downloadedComicIds;
          if (idSet) {
            idSet.add(comicId);
          }
        }

        // Re-render to show download checkmarks
        const applyFilterAndRender = state.applyFilterAndRender || window.applyFilterAndRender;
        if (typeof applyFilterAndRender === 'function') {
          applyFilterAndRender();
        }

        // Refresh downloads info in settings
        const refreshDownloadsInfo = state.refreshDownloadsInfo || window.refreshDownloadsInfo;
        if (typeof refreshDownloadsInfo === 'function') {
          await refreshDownloadsInfo();
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
export async function requestNotificationPermission() {
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

// Expose to state and global scope for transition compatibility
state.requestNotificationPermission = requestNotificationPermission;

if (typeof window !== 'undefined') {
  window.requestNotificationPermission = requestNotificationPermission;
}
