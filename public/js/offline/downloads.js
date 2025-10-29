(function (global) {
  'use strict';

  const OfflineDB = global.OfflineDB || {};
  const {
    saveComicToDB,
    getAllDownloadedComics,
    deleteOfflineComic,
    forceStorageCleanup,
    saveQueueItemToDB,
    getQueueFromDB,
    removeQueueItemFromDB,
    updateQueuePriorities,
    clearCompletedQueueItems,
  } = OfflineDB;

  // ============================================================================
  // BACKGROUND DOWNLOAD MANAGER
  // ============================================================================

  class BackgroundDownloadManager {
    constructor() {
      this.isProcessing = false;
      this.currentDownload = null;
      this.abortController = null;
      this.persistentQueue = []; // Mirrors IndexedDB queue
    }

    /**
     * Load queue from IndexedDB on initialization
     */
    async loadQueue() {
      try {
        this.persistentQueue = await getQueueFromDB();
        console.log('[DOWNLOAD MANAGER] Loaded', this.persistentQueue.length, 'items from queue');
        return this.persistentQueue;
      } catch (error) {
        console.error('[DOWNLOAD MANAGER] Error loading queue:', error);
        return [];
      }
    }

    /**
     * Add comic to download queue
     */
    async addToQueue(comic) {
      const displayInfo = applyDisplayInfoToComic(comic);
      const queueItem = {
        id: comic.id,
        comicPath: comic.path,
        comicName: comic.name || 'Comic',
        displayName: displayInfo.displayTitle,
        status: 'pending',
        progress: 0,
        priority: this.persistentQueue.length, // Add to end
        addedAt: Date.now(),
        comic: comic // Store full comic object for download
      };

      this.persistentQueue.push(queueItem);
      await saveQueueItemToDB(queueItem);
      console.log('[DOWNLOAD MANAGER] Added to queue:', queueItem.displayName);

      // Update UI
      this.updateQueueUI();

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }

      return queueItem;
    }

    /**
     * Remove comic from queue and cancel if currently downloading
     */
    async cancelDownload(comicId) {
      // If currently downloading, abort it
      if (this.currentDownload && this.currentDownload.id === comicId) {
        if (this.abortController) {
          this.abortController.abort();
          console.log('[DOWNLOAD MANAGER] Aborted current download:', comicId);
        }
        this.currentDownload = null;
      }

      // Remove from persistent queue
      this.persistentQueue = this.persistentQueue.filter(item => item.id !== comicId);
      await removeQueueItemFromDB(comicId);
      console.log('[DOWNLOAD MANAGER] Cancelled download:', comicId);

      this.updateQueueUI();
    }

    /**
     * Change priority of a queue item (reorder)
     */
    async changePriority(comicId, newPriority) {
      const item = this.persistentQueue.find(i => i.id === comicId);
      if (!item) return false;

      // Remove from current position
      const oldIndex = this.persistentQueue.indexOf(item);
      this.persistentQueue.splice(oldIndex, 1);

      // Insert at new position
      this.persistentQueue.splice(newPriority, 0, item);

      // Update all priorities
      await updateQueuePriorities(this.persistentQueue);
      console.log('[DOWNLOAD MANAGER] Changed priority for:', comicId);

      this.updateQueueUI();
      return true;
    }

    /**
     * Clear completed and error items from queue
     */
    async clearCompleted() {
      const beforeCount = this.persistentQueue.length;
      this.persistentQueue = this.persistentQueue.filter(
        item => item.status !== 'completed' && item.status !== 'error'
      );
      await clearCompletedQueueItems();
      const cleared = beforeCount - this.persistentQueue.length;
      console.log('[DOWNLOAD MANAGER] Cleared', cleared, 'completed items');

      this.updateQueueUI();
      return cleared;
    }

    /**
     * Process download queue (one at a time, sequential)
     */
    async processQueue() {
      if (this.isProcessing) {
        console.log('[DOWNLOAD MANAGER] Already processing queue');
        return;
      }

      this.isProcessing = true;
      console.log('[DOWNLOAD MANAGER] Started processing queue');

      while (this.persistentQueue.length > 0) {
        // Find next pending item
        const nextItem = this.persistentQueue.find(item => item.status === 'pending');
        if (!nextItem) break;

        this.currentDownload = nextItem;
        nextItem.status = 'downloading';
        await saveQueueItemToDB(nextItem);
        this.updateQueueUI();

        console.log('[DOWNLOAD MANAGER] Downloading:', nextItem.displayName);

        try {
          await this.downloadComic(nextItem);
          nextItem.status = 'completed';
          nextItem.progress = 1;
          console.log('[DOWNLOAD MANAGER] Completed:', nextItem.displayName);
        } catch (error) {
          if (error.name === 'AbortError') {
            console.log('[DOWNLOAD MANAGER] Download cancelled:', nextItem.displayName);
            // Remove from queue, don't mark as error
            await removeQueueItemFromDB(nextItem.id);
            this.persistentQueue = this.persistentQueue.filter(item => item.id !== nextItem.id);
          } else {
            console.error('[DOWNLOAD MANAGER] Download failed:', nextItem.displayName, error);
            nextItem.status = 'error';
            nextItem.error = error.message || 'Download failed';
            await saveQueueItemToDB(nextItem);
          }
        }

        this.currentDownload = null;
        this.updateQueueUI();

        // Remove completed items after 3 seconds
        if (nextItem.status === 'completed') {
          setTimeout(async () => {
            await removeQueueItemFromDB(nextItem.id);
            this.persistentQueue = this.persistentQueue.filter(item => item.id !== nextItem.id);
            this.updateQueueUI();
          }, 3000);
        }
      }

      this.isProcessing = false;
      console.log('[DOWNLOAD MANAGER] Finished processing queue');
    }

    /**
     * Download a single comic with progress tracking
     */
    async downloadComic(queueItem) {
      const comic = queueItem.comic;
      if (!comic) {
        throw new Error('Comic data not found in queue item');
      }

      // Create AbortController for cancellation
      this.abortController = new AbortController();

      const url = `${API_BASE_URL}/api/v1/comics/download?path=${encodeURIComponent(encodePath(comic.path))}`;

      // Fetch with progress tracking
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        signal: this.abortController.signal
      });

      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body?.getReader();

      if (!reader) {
        const blob = await res.blob();
        queueItem.progress = 1;
        await this.saveComic(comic, blob);
        return;
      }

      let received = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if (total) {
          queueItem.progress = received / total;
          await saveQueueItemToDB(queueItem);
          this.updateQueueUI();
        }
      }

      const blob = new Blob(chunks);
      await this.saveComic(comic, blob);
      this.abortController = null;
    }

    /**
     * Save downloaded comic to IndexedDB
     */
    async saveComic(comic, blob) {
      const comicRecord = {
        ...comic,
        progress: { ...(comic.progress || {}) },
        downloadedAt: Date.now(),
      };

      await saveComicToDB(comicRecord, blob);

      if (!global.downloadedComicIds) global.downloadedComicIds = new Set();
      global.downloadedComicIds.add(comic.id);

      // Refresh library to show checkmark
      if (typeof fetchLibrary === 'function') {
        await fetchLibrary();
      }

      // Refresh downloads info
      if (typeof refreshDownloadsInfo === 'function') {
        await refreshDownloadsInfo();
      }
    }

    /**
     * Update queue UI
     */
    updateQueueUI() {
      if (!downloadQueueDiv) return;

      downloadQueueDiv.innerHTML = '';

      this.persistentQueue.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'bg-gray-800 text-white p-2 rounded shadow mb-2 relative';
        wrapper.dataset.comicId = item.id;

        const title = document.createElement('div');
        title.className = 'text-sm pr-6';
        title.textContent = item.displayName || item.comicName;
        wrapper.appendChild(title);

        // Cancel button
        if (item.status === 'pending' || item.status === 'downloading') {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'absolute top-2 right-2 text-red-400 hover:text-red-600';
          cancelBtn.innerHTML = '×';
          cancelBtn.title = 'Cancel download';
          cancelBtn.onclick = async (e) => {
            e.stopPropagation();
            await this.cancelDownload(item.id);
          };
          wrapper.appendChild(cancelBtn);
        }

        // Progress bar
        const bar = document.createElement('div');
        bar.className = 'w-full bg-gray-700 rounded h-2 mt-1';
        const inner = document.createElement('div');

        if (item.status === 'error') {
          inner.className = 'bg-red-500 h-2 rounded';
        } else if (item.status === 'completed') {
          inner.className = 'bg-green-500 h-2 rounded';
        } else {
          inner.className = 'bg-blue-500 h-2 rounded';
        }

        inner.style.width = `${Math.round(item.progress * 100)}%`;
        bar.appendChild(inner);
        wrapper.appendChild(bar);

        // Status text
        const status = document.createElement('div');
        status.className = 'text-xs text-gray-400 mt-1';
        if (item.status === 'pending') {
          status.textContent = 'Waiting...';
        } else if (item.status === 'downloading') {
          status.textContent = `Downloading... ${Math.round(item.progress * 100)}%`;
        } else if (item.status === 'completed') {
          status.textContent = 'Completed';
        } else if (item.status === 'error') {
          status.textContent = `Error: ${item.error || 'Download failed'}`;
        }
        wrapper.appendChild(status);

        downloadQueueDiv.appendChild(wrapper);
      });

      downloadQueueDiv.classList.toggle('hidden', this.persistentQueue.length === 0);
    }
  }

  // Create global download manager instance
  const downloadManager = new BackgroundDownloadManager();

  // ============================================================================
  // LEGACY SUPPORT & COMPATIBILITY
  // ============================================================================

  // Legacy compatibility function - delegates to download manager
  function renderDownloadQueue() {
    // Delegate to download manager's UI
    if (downloadManager) {
      downloadManager.updateQueueUI();
    }
  }

  async function fetchWithProgress(url, onProgress) {
    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const blob = await res.blob();
      onProgress?.(1);
      return blob;
    }
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        onProgress?.(received / total);
      }
    }
    return new Blob(chunks);
  }

  async function refreshDownloadsInfo() {
    if (!downloadsInfoDiv) return;

    downloadsInfoDiv.innerHTML = 'Calculating...';
    const downloadedComics = await getAllDownloadedComics();
    let totalSize = 0;
    let content = '<ul>';
    downloadedComics.forEach(comic => {
      totalSize += comic.fileBlob?.size || 0;
      const comicInfo = comic.comicInfo || {};
      const info = applyDisplayInfoToComic(comicInfo);
      const displayName = info.displayTitle || comicInfo.name || 'Unknown Comic';
      const escapedName = displayName
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      content += `<li class="text-sm flex justify-between items-center">` +
        `<span title="${escapedName}">${escapedName}</span>` +
        `<button class="delete-download-btn text-red-500 hover:text-red-700" data-id="${comic.id}" data-name="${escapedName}">Delete</button>` +
        `</li>`;
    });
    content += '</ul>';

    downloadsInfoDiv.innerHTML = `
      <p><strong>${downloadedComics.length}</strong> comics downloaded.</p>
      <p><strong>Total size:</strong> ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>
      <div class="mt-4 max-h-48 overflow-y-auto">${content}</div>
    `;

    document.querySelectorAll('.delete-download-btn').forEach(btn => {
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        const id = target.dataset.id;
        const comicName = target.dataset.name || target.closest('li')?.querySelector('span')?.textContent || 'comic';

        if (!confirm(`Delete "${comicName}" from offline storage?`)) {
          return;
        }

        try {
          target.disabled = true;
          target.textContent = 'Deleting...';

          await deleteOfflineComic(id);
          await forceStorageCleanup();
          if (typeof fetchLibrary === 'function') {
            await fetchLibrary();
          }
          await refreshDownloadsInfo();
        } catch (error) {
          
          alert('Failed to delete comic. Please try again.');
          target.disabled = false;
          target.textContent = 'Delete';
        }
      });
    });
  }

  /**
   * Download a comic using the background download manager
   * @param {Object} comic - Comic object
   * @param {HTMLElement} btn - Download button element
   * @returns {Promise<boolean>}
   */
  async function downloadComic(comic, btn) {
    try {
      // Skip if already downloaded
      if (global.downloadedComicIds?.has(comic.id)) {
        console.log('[DOWNLOAD] Comic already downloaded:', comic.id);
        return true;
      }

      // Update button UI immediately
      if (btn) {
        btn._origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
               viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
            <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="text-xs">Queued</span>`;
      }

      // Add to background download queue
      await downloadManager.addToQueue(comic);

      console.log('[DOWNLOAD] Added to queue:', comic.name);
      return true;
    } catch (error) {
      console.error('[DOWNLOAD] Error adding to queue:', error);

      // Restore button on error
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn._origHtml || btn.innerHTML;
      }

      alert('Failed to add comic to download queue.');
      return false;
    }
  }

  /**
   * Download all comics in a series using the background download manager
   * @param {Array|Object} comics - Array of comics or series object
   * @param {HTMLElement} btn - Download button element
   */
  async function downloadSeries(comics, btn) {
    if (!btn) return;

    btn._origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
           viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
        <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="text-xs">Queueing...</span>`;

    try {
      let comicsToDownload = [];

      // Handle different input formats
      if (Array.isArray(comics)) {
        comicsToDownload = comics;
      } else if (comics && comics._hasDetails === false) {
        const { dataset } = btn;
        if (!dataset.rootFolder || !dataset.publisher || !dataset.seriesName) {
          throw new Error('Missing series information for download');
        }
        if (typeof getSeriesComics === 'function') {
          comicsToDownload = await getSeriesComics(dataset.rootFolder, dataset.publisher, dataset.seriesName);
        } else {
          throw new Error('Cannot load series details - getSeriesComics not available');
        }
      } else {
        throw new Error('Invalid comics data format');
      }

      // Add all comics to queue (skip already downloaded)
      let queuedCount = 0;
      for (const comic of comicsToDownload) {
        if (!global.downloadedComicIds?.has(comic.id)) {
          await downloadManager.addToQueue(comic);
          queuedCount++;
        }
      }

      // Update button to show queued
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs">${queuedCount} queued</span>`;

      console.log('[DOWNLOAD] Added', queuedCount, 'comics from series to queue');

      // Re-enable button after queueing
      setTimeout(() => {
        btn.disabled = false;
      }, 2000);

    } catch (error) {
      console.error('[DOWNLOAD] Series download error:', error);
      alert('Failed to queue series for download.');
      btn.disabled = false;
      btn.innerHTML = btn._origHtml;
    }
  }

  const OfflineDownloads = {
    renderDownloadQueue,
    fetchWithProgress,
    refreshDownloadsInfo,
    downloadComic,
    downloadSeries,
    downloadManager, // Expose the download manager
    initializeDownloadQueue: async () => {
      await downloadManager.loadQueue();
      downloadManager.processQueue(); // Resume processing if items in queue
    },
    cancelDownload: (comicId) => downloadManager.cancelDownload(comicId),
    clearCompletedDownloads: () => downloadManager.clearCompleted(),
  };

  global.OfflineDownloads = OfflineDownloads;
  Object.assign(global, OfflineDownloads);

  // Expose download manager globally
  global.downloadManager = downloadManager;
})(typeof window !== 'undefined' ? window : globalThis);
