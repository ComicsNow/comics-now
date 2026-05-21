import { state } from '../globals.js';
import { fetchWithProgress, refreshDownloadsInfo } from './download-progress.js';
import { downloadComic, downloadSeries, downloadReadingList } from './download-actions.js';
import { downloadManager, renderDownloadQueue } from './downloads.js';

export const OfflineDownloads = {
  renderDownloadQueue,
  fetchWithProgress,
  refreshDownloadsInfo,
  downloadComic,
  downloadSeries,
  downloadReadingList,
  downloadManager,
  initializeDownloadQueue: async () => {
    if (!downloadManager) {
      console.error('[OFFLINE DOWNLOADS] Cannot initialize: downloadManager not found');
      return;
    }
    await downloadManager.loadQueue();
    // If items exist in queue, resume processing
    if (downloadManager.persistentQueue.length > 0) {
      if (downloadManager.useServiceWorker) {
        await downloadManager.registerBackgroundSync();
        // Explicitly trigger SW to resume
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'start-downloads' });
        }
      } else {
        downloadManager.processQueue();
      }
    }
  },
  cancelDownload: (comicId) => downloadManager ? downloadManager.cancelDownload(comicId) : null,
  restartDownload: (comicId) => downloadManager ? downloadManager.restartDownload(comicId) : null,
  pauseDownload: (comicId) => downloadManager ? downloadManager.pauseDownload(comicId) : null,
  resumeDownload: (comicId) => downloadManager ? downloadManager.resumeDownload(comicId) : null,
  clearCompletedDownloads: () => downloadManager ? downloadManager.clearCompleted() : null,
  deleteOfflineComic: (comicId) => {
    const db = state.OfflineDB || window.OfflineDB || {};
    const fn = db.deleteOfflineComic || state.deleteOfflineComic || window.deleteOfflineComic;
    return fn ? fn(comicId) : null;
  },
};

// Expose on state & window for transitional compatibility
state.OfflineDownloads = OfflineDownloads;
Object.assign(state, OfflineDownloads);

if (typeof window !== 'undefined') {
  window.OfflineDownloads = OfflineDownloads;
  Object.assign(window, OfflineDownloads);
}
