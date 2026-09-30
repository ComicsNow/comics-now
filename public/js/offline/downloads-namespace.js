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
    // If a Background Fetch is still running from a previous session, mark it
    // active so the sequential pump won't start a second one.
    await downloadManager.reconnectBackgroundFetches();
    // Start the next pending item (one at a time). Interrupted downloads were
    // left 'paused' by loadQueue and wait for the user's Start All.
    downloadManager.pump();
  },
  cancelDownload: (comicId) => downloadManager ? downloadManager.cancelDownload(comicId) : null,
  restartDownload: (comicId) => downloadManager ? downloadManager.restartDownload(comicId) : null,
  pauseDownload: (comicId) => downloadManager ? downloadManager.pauseDownload(comicId) : null,
  resumeDownload: (comicId) => downloadManager ? downloadManager.resumeDownload(comicId) : null,
  pauseAllDownloads: () => downloadManager ? downloadManager.pauseAll() : null,
  startAllDownloads: () => downloadManager ? downloadManager.startAll() : null,
  cancelAllDownloads: () => downloadManager ? downloadManager.cancelAll() : null,
  retryAllFailedDownloads: () => downloadManager ? downloadManager.retryAllFailed() : null,
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
