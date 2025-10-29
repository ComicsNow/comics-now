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
      this.useServiceWorker = BackgroundDownloadManager.isBackgroundSyncSupported();
      this.syncRegistered = false;
      this.isCollapsed = this.loadCollapsedState();
    }

    /**
     * Load collapsed state from localStorage
     */
    loadCollapsedState() {
      try {
        const saved = localStorage.getItem('download-queue-collapsed');
        return saved === 'true';
      } catch (error) {
        return false;
      }
    }

    /**
     * Save collapsed state to localStorage
     */
    saveCollapsedState(collapsed) {
      try {
        localStorage.setItem('download-queue-collapsed', collapsed.toString());
      } catch (error) {
        console.error('[DOWNLOAD MANAGER] Error saving collapsed state:', error);
      }
    }

    /**
     * Toggle collapsed state
     */
    toggleCollapsed() {
      this.isCollapsed = !this.isCollapsed;
      this.saveCollapsedState(this.isCollapsed);
      this.updateQueueUI();
    }

    /**
     * Check if Background Sync API is supported
     */
    static isBackgroundSyncSupported() {
      return 'serviceWorker' in navigator &&
             'sync' in ServiceWorkerRegistration.prototype;
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

      // Register background sync if supported (Service Worker will handle downloads)
      if (this.useServiceWorker) {
        await this.registerBackgroundSync();
      } else {
        // Fallback to in-page processing
        if (!this.isProcessing) {
          this.processQueue();
        }
      }

      return queueItem;
    }

    /**
     * Register background sync with Service Worker
     */
    async registerBackgroundSync() {
      if (!this.useServiceWorker) return false;

      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('download-comics');
        this.syncRegistered = true;
        console.log('[DOWNLOAD MANAGER] Background sync registered');
        return true;
      } catch (error) {
        console.warn('[DOWNLOAD MANAGER] Background sync registration failed, falling back to in-page:', error);
        this.useServiceWorker = false;
        // Start in-page processing as fallback
        if (!this.isProcessing) {
          this.processQueue();
        }
        return false;
      }
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
     * Restart a failed download
     */
    async restartDownload(comicId) {
      const item = this.persistentQueue.find(i => i.id === comicId);
      if (!item) return false;

      // Reset to pending status
      item.status = 'pending';
      item.progress = 0;
      item.error = null;

      await saveQueueItemToDB(item);
      console.log('[DOWNLOAD MANAGER] Restarting download:', item.displayName);

      this.updateQueueUI();

      // Trigger processing
      if (this.useServiceWorker) {
        await this.registerBackgroundSync();
      } else {
        if (!this.isProcessing) {
          this.processQueue();
        }
      }

      return true;
    }

    /**
     * Pause an active download (in-page downloads only)
     */
    async pauseDownload(comicId) {
      const item = this.persistentQueue.find(i => i.id === comicId);
      if (!item || item.status !== 'downloading') return false;

      // If using Service Worker background sync, can't pause
      if (this.useServiceWorker && this.currentDownload?.id !== comicId) {
        console.warn('[DOWNLOAD MANAGER] Cannot pause Service Worker downloads');
        return false;
      }

      // For in-page downloads, abort the current download
      if (this.currentDownload && this.currentDownload.id === comicId) {
        if (this.abortController) {
          this.abortController.abort();
        }
      }

      item.status = 'paused';
      await saveQueueItemToDB(item);
      console.log('[DOWNLOAD MANAGER] Paused download:', item.displayName);

      this.updateQueueUI();
      return true;
    }

    /**
     * Resume a paused download
     */
    async resumeDownload(comicId) {
      const item = this.persistentQueue.find(i => i.id === comicId);
      if (!item || item.status !== 'paused') return false;

      item.status = 'pending';
      await saveQueueItemToDB(item);
      console.log('[DOWNLOAD MANAGER] Resuming download:', item.displayName);

      this.updateQueueUI();

      // Restart processing
      if (!this.isProcessing) {
        this.processQueue();
      }

      return true;
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
     * Helper function to create action buttons
     */
    createButton(icon, title, colorClass, onClick) {
      const btn = document.createElement('button');
      btn.className = `${colorClass} hover:opacity-80 text-lg px-1`;
      btn.innerHTML = icon;
      btn.title = title;
      btn.onclick = async (e) => {
        e.stopPropagation();
        await onClick();
      };
      return btn;
    }

    /**
     * Update queue UI
     */
    updateQueueUI() {
      if (!downloadQueueDiv) return;

      downloadQueueDiv.innerHTML = '';

      // Don't show anything if queue is empty
      if (this.persistentQueue.length === 0) {
        downloadQueueDiv.classList.add('hidden');
        return;
      }

      downloadQueueDiv.classList.remove('hidden');

      // Create header bar
      const header = document.createElement('div');
      header.className = 'bg-gray-900 text-white p-3 rounded-t shadow flex items-center justify-between cursor-pointer';
      header.onclick = () => this.toggleCollapsed();

      // Header content
      const headerContent = document.createElement('div');
      headerContent.className = 'flex items-center space-x-2';

      // Download icon
      const icon = document.createElement('span');
      icon.textContent = '⬇';
      icon.className = 'text-lg';
      headerContent.appendChild(icon);

      // Title and count
      const title = document.createElement('span');
      title.className = 'font-semibold text-sm';
      const activeCount = this.persistentQueue.filter(i => i.status === 'pending' || i.status === 'downloading').length;
      const totalCount = this.persistentQueue.length;
      title.textContent = `Downloads (${activeCount}/${totalCount})`;
      headerContent.appendChild(title);

      header.appendChild(headerContent);

      // Collapse/expand button
      const collapseBtn = document.createElement('button');
      collapseBtn.className = 'text-gray-400 hover:text-white text-xl';
      collapseBtn.innerHTML = this.isCollapsed ? '▼' : '▲';
      collapseBtn.title = this.isCollapsed ? 'Expand' : 'Collapse';
      header.appendChild(collapseBtn);

      downloadQueueDiv.appendChild(header);

      // If collapsed, only show header
      if (this.isCollapsed) {
        return;
      }

      // Queue content container
      const queueContent = document.createElement('div');
      queueContent.className = 'bg-gray-800 rounded-b shadow max-h-96 overflow-y-auto';

      // Add background sync indicator
      const syncIndicator = document.createElement('div');
      syncIndicator.className = 'p-2 text-xs text-center';

      if (this.useServiceWorker) {
        syncIndicator.className += ' bg-green-900 text-green-300';
        syncIndicator.innerHTML = '✓ Background sync enabled - downloads continue even if you close this tab';
      } else {
        syncIndicator.className += ' bg-yellow-900 text-yellow-300';
        syncIndicator.innerHTML = '⚠ Keep this tab open - background sync not supported in your browser';
      }

      queueContent.appendChild(syncIndicator);

      // Add all queue items
      this.persistentQueue.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'bg-gray-700 text-white p-3 border-b border-gray-600 last:border-b-0 relative';
        wrapper.dataset.comicId = item.id;

        const title = document.createElement('div');
        title.className = 'text-sm pr-16';
        title.textContent = item.displayName || item.comicName;
        wrapper.appendChild(title);

        // Action buttons based on status
        const btnContainer = document.createElement('div');
        btnContainer.className = 'absolute top-2 right-2 flex space-x-1';

        if (item.status === 'downloading') {
          // Pause button (only for in-page downloads)
          if (!this.useServiceWorker || this.currentDownload?.id === item.id) {
            const pauseBtn = this.createButton('⏸', 'Pause', 'text-blue-400',
              () => this.pauseDownload(item.id));
            btnContainer.appendChild(pauseBtn);
          }

          // Cancel button
          const cancelBtn = this.createButton('×', 'Cancel', 'text-red-400',
            () => this.cancelDownload(item.id));
          btnContainer.appendChild(cancelBtn);

        } else if (item.status === 'paused') {
          // Resume button
          const resumeBtn = this.createButton('▶', 'Resume', 'text-green-400',
            () => this.resumeDownload(item.id));
          btnContainer.appendChild(resumeBtn);

          // Cancel button
          const cancelBtn = this.createButton('×', 'Cancel', 'text-red-400',
            () => this.cancelDownload(item.id));
          btnContainer.appendChild(cancelBtn);

        } else if (item.status === 'error') {
          // Restart button
          const restartBtn = this.createButton('↻', 'Restart', 'text-green-400',
            () => this.restartDownload(item.id));
          btnContainer.appendChild(restartBtn);

          // Remove button
          const removeBtn = this.createButton('×', 'Remove', 'text-red-400',
            () => this.cancelDownload(item.id));
          btnContainer.appendChild(removeBtn);

        } else if (item.status === 'pending') {
          // Cancel button only
          const cancelBtn = this.createButton('×', 'Cancel', 'text-red-400',
            () => this.cancelDownload(item.id));
          btnContainer.appendChild(cancelBtn);

        } else if (item.status === 'completed') {
          // Remove button (optional)
          const removeBtn = this.createButton('×', 'Remove', 'text-gray-400',
            () => this.cancelDownload(item.id));
          btnContainer.appendChild(removeBtn);
        }

        wrapper.appendChild(btnContainer);

        // Progress bar
        const bar = document.createElement('div');
        bar.className = 'w-full bg-gray-700 rounded h-2 mt-1';
        const inner = document.createElement('div');

        if (item.status === 'error') {
          inner.className = 'bg-red-500 h-2 rounded';
        } else if (item.status === 'completed') {
          inner.className = 'bg-green-500 h-2 rounded';
        } else if (item.status === 'paused') {
          inner.className = 'bg-yellow-500 h-2 rounded';
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
        } else if (item.status === 'paused') {
          status.textContent = `Paused at ${Math.round(item.progress * 100)}%`;
        } else if (item.status === 'completed') {
          status.textContent = 'Completed';
        } else if (item.status === 'error') {
          status.textContent = `Error: ${item.error || 'Download failed'}`;
        }
        wrapper.appendChild(status);

        queueContent.appendChild(wrapper);
      });

      // Append queue content container
      downloadQueueDiv.appendChild(queueContent);
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
    restartDownload: (comicId) => downloadManager.restartDownload(comicId),
    pauseDownload: (comicId) => downloadManager.pauseDownload(comicId),
    resumeDownload: (comicId) => downloadManager.resumeDownload(comicId),
    clearCompletedDownloads: () => downloadManager.clearCompleted(),
  };

  // ============================================================================
  // SERVICE WORKER MESSAGE LISTENER
  // ============================================================================

  /**
   * Listen for Service Worker messages (progress updates, status changes)
   */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const { type, comicId, progress, status, error } = event.data;

      console.log('[DOWNLOAD] Service Worker message:', type, comicId);

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

          // Refresh library to show checkmark
          if (typeof fetchLibrary === 'function') {
            await fetchLibrary();
          }

          // Refresh downloads info
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

    console.log('[DOWNLOAD] Service Worker message listener registered');
  }

  // ============================================================================
  // NOTIFICATION PERMISSION
  // ============================================================================

  /**
   * Request notification permission for download completion alerts
   */
  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.log('[DOWNLOAD] Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      console.log('[DOWNLOAD] Notification permission already granted');
      return true;
    }

    if (Notification.permission === 'denied') {
      console.log('[DOWNLOAD] Notification permission denied');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      console.log('[DOWNLOAD] Notification permission:', permission);
      return permission === 'granted';
    } catch (error) {
      console.error('[DOWNLOAD] Error requesting notification permission:', error);
      return false;
    }
  }

  // Request notification permission on first download if background sync is supported
  let notificationPermissionRequested = false;

  const originalAddToQueue = downloadManager.addToQueue.bind(downloadManager);
  downloadManager.addToQueue = async function (comic) {
    // Request notification permission on first download
    if (!notificationPermissionRequested && BackgroundDownloadManager.isBackgroundSyncSupported()) {
      notificationPermissionRequested = true;
      await requestNotificationPermission();
    }

    return originalAddToQueue(comic);
  };

  global.OfflineDownloads = OfflineDownloads;
  Object.assign(global, OfflineDownloads);

  // Expose download manager globally
  global.downloadManager = downloadManager;
  global.requestNotificationPermission = requestNotificationPermission;
})(typeof window !== 'undefined' ? window : globalThis);
