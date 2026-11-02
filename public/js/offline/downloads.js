import { state } from '../globals.js';
import * as DownloadHistory from './download-history.js';
import {
  startBackgroundFetch,
  reconnectBackgroundFetches,
  handleServiceWorkerMessage,
  abortBackgroundFetch,
  saveDownloadedComic,
  downloadComicItem
} from './downloads/fetcher.js';
import {
  pruneExpiredHistoryFromDB,
  loadQueueFromDB,
  addComicToQueue,
  cancelComicDownload,
  stopAllComicDownloads,
  restartComicDownload,
  pauseComicDownload,
  resumeComicDownload,
  pauseAllDownloads,
  startAllDownloads,
  cancelAllDownloads,
  retryAllFailedDownloads,
  changeQueuePriority,
  clearCompletedItems,
  processDownloadQueue
} from './downloads/queue.js';
import {
  createActionButton,
  installQueueTouchTracking
} from './downloads/ui-helpers.js';
import {
  updateDownloadQueueUI,
  showDownloadQueue
} from './downloads/ui.js';

export class BackgroundDownloadManager {
  constructor() {
    this.isProcessing = false;
    this.currentDownload = null;
    this.abortController = null;
    this.persistentQueue = [];
    this.partialData = new Map();
    this.activeDownloadId = null;
    this.useServiceWorker = BackgroundDownloadManager.isBackgroundSyncSupported();
    this.useBackgroundFetch = BackgroundDownloadManager.isBackgroundFetchSupported();
    this.syncRegistered = false;
    this.isCollapsed = this.loadCollapsedState();
    this.activeTab = 'in-progress';
    this.explicitlyOpen = false;
  }

  static isBackgroundFetchSupported() {
    return typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof ServiceWorkerRegistration !== 'undefined' &&
      'backgroundFetch' in ServiceWorkerRegistration.prototype;
  }

  static isBackgroundSyncSupported() {
    return typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof ServiceWorkerRegistration !== 'undefined' &&
      'sync' in ServiceWorkerRegistration.prototype;
  }

  async startBackgroundFetch(queueItem) {
    return startBackgroundFetch(this, queueItem);
  }

  async pump() {
    if (this.useBackgroundFetch) {
      if (this.activeDownloadId) return;
      const next = this.persistentQueue.find(i => i.status === 'pending');
      if (!next) return;
      this.activeDownloadId = next.id;
      try {
        await this.startBackgroundFetch(next);
      } catch (_) {
        this.useBackgroundFetch = false;
        this.activeDownloadId = null;
        if (!this.isProcessing) this.processQueue();
      }
    } else if (!this.isProcessing) {
      this.processQueue();
    }
  }

  async reconnectBackgroundFetches() {
    return reconnectBackgroundFetches(this);
  }

  async handleServiceWorkerMessage(data) {
    return handleServiceWorkerMessage(this, data);
  }

  getPartitioned(now = Date.now()) {
    return DownloadHistory.partitionDownloads(this.persistentQueue, now);
  }

  async pruneExpiredHistory(now = Date.now()) {
    return pruneExpiredHistoryFromDB(this, now);
  }

  loadCollapsedState() {
    try {
      const saved = localStorage.getItem('download-queue-collapsed');
      return saved === 'true';
    } catch (_) {
      return false;
    }
  }

  saveCollapsedState(collapsed) {
    try {
      localStorage.setItem('download-queue-collapsed', collapsed.toString());
    } catch (error) {
      console.error('[DOWNLOAD MANAGER] Error saving collapsed state:', error);
    }
  }

  toggleCollapsed() {
    this.isCollapsed = !this.isCollapsed;
    this.saveCollapsedState(this.isCollapsed);
    this.updateQueueUI();
  }

  async loadQueue() {
    return loadQueueFromDB(this);
  }

  async addToQueue(comic) {
    return addComicToQueue(this, comic);
  }

  async registerBackgroundSync() {
    if (!this.useServiceWorker) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('download-comics');
      this.syncRegistered = true;
      return true;
    } catch (_) {
      this.useServiceWorker = false;
      if (!this.isProcessing) {
        this.processQueue();
      }
      return false;
    }
  }

  async _abortBackgroundFetch(comicId) {
    return abortBackgroundFetch(this, comicId);
  }

  async cancelDownload(comicId) {
    return cancelComicDownload(this, comicId);
  }

  async stopAllDownloads() {
    return stopAllComicDownloads(this);
  }

  async restartDownload(comicId) {
    return restartComicDownload(this, comicId);
  }

  async pauseDownload(comicId) {
    return pauseComicDownload(this, comicId);
  }

  async resumeDownload(comicId) {
    return resumeComicDownload(this, comicId);
  }

  async pauseAll() {
    return pauseAllDownloads(this);
  }

  async startAll() {
    return startAllDownloads(this);
  }

  async cancelAll() {
    return cancelAllDownloads(this);
  }

  async retryAllFailed() {
    return retryAllFailedDownloads(this);
  }

  async changePriority(comicId, newPriority) {
    return changeQueuePriority(this, comicId, newPriority);
  }

  async clearCompleted() {
    return clearCompletedItems(this);
  }

  async processQueue() {
    return processDownloadQueue(this);
  }

  async downloadComic(queueItem) {
    return downloadComicItem(this, queueItem);
  }

  async saveComic(comic, blob) {
    return saveDownloadedComic(comic, blob);
  }

  createButton(icon, title, colorClass, onClick) {
    return createActionButton(icon, title, colorClass, onClick);
  }

  _installQueueTouchTracking() {
    return installQueueTouchTracking(this);
  }

  updateQueueUI() {
    return updateDownloadQueueUI(this);
  }

  showQueue() {
    return showDownloadQueue(this);
  }
}

export const downloadManager = new BackgroundDownloadManager();

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event && event.data;
    if (data && (data.type === 'download-complete' || data.type === 'download-error' || data.type === 'download-aborted')) {
      downloadManager.handleServiceWorkerMessage(data);
    }
  });
}

export function renderDownloadQueue() {
  if (downloadManager) {
    downloadManager.updateQueueUI();
  }
}

state.renderDownloadQueue = renderDownloadQueue;
if (typeof window !== 'undefined') {
  window.renderDownloadQueue = renderDownloadQueue;
}

let notificationPermissionRequested = false;

const originalAddToQueue = downloadManager.addToQueue.bind(downloadManager);
downloadManager.addToQueue = async function (comic) {
  const requestNotificationPermission = state.requestNotificationPermission || window.requestNotificationPermission;
  if (!notificationPermissionRequested && BackgroundDownloadManager.isBackgroundSyncSupported()) {
    notificationPermissionRequested = true;
    if (typeof requestNotificationPermission === 'function') {
      await requestNotificationPermission();
    }
  }

  return originalAddToQueue(comic);
};

state.downloadManager = downloadManager;
if (typeof window !== 'undefined') {
  window.downloadManager = downloadManager;
}
