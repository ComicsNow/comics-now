(function (global) {
  'use strict';

  /**
   * Rebuilds and exposes the OfflineDownloads namespace from globally available functions.
   * This file must load after all other download-*.js files.
   */

  const downloadManager = global.downloadManager;

  const OfflineDownloads = {
    renderDownloadQueue: global.renderDownloadQueue,
    fetchWithProgress: global.fetchWithProgress,
    refreshDownloadsInfo: global.refreshDownloadsInfo,
    downloadComic: global.downloadComic,
    downloadSeries: global.downloadSeries,
    downloadReadingList: global.downloadReadingList,
    downloadManager: global.downloadManager,
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
      const db = global.OfflineDB || {};
      const fn = db.deleteOfflineComic || global.deleteOfflineComic;
      return fn ? fn(comicId) : null;
    },
  };

  global.OfflineDownloads = OfflineDownloads;
  Object.assign(global, OfflineDownloads);

})(typeof window !== 'undefined' ? window : globalThis);
