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
      // Ensure comic has userId before adding to queue
      if (!comic.userId && typeof getCurrentUserId === "function") {
        comic.userId = getCurrentUserId();
      }

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
        return true;
      } catch (error) {
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
        }
        this.currentDownload = null;
      }

      // Remove from persistent queue
      this.persistentQueue = this.persistentQueue.filter(item => item.id !== comicId);
      await removeQueueItemFromDB(comicId);

      this.updateQueueUI();
    }

    /**
     * Stop everything: abort the in-flight download and drop every pending /
     * errored item from the queue. Confirms with the user first.
     */
    async stopAllDownloads() {
      const total = this.persistentQueue.length;
      if (total === 0) return;
      const ok = window.confirm(`Stop all downloads and clear the queue (${total} item${total === 1 ? '' : 's'})?`);
      if (!ok) return;

      // Abort whatever's currently downloading.
      if (this.abortController) {
        try { this.abortController.abort(); } catch (_) {}
        this.abortController = null;
      }
      this.currentDownload = null;

      // Drop everything from the persistent queue + IndexedDB.
      const ids = this.persistentQueue.map(i => i.id);
      this.persistentQueue = [];
      for (const id of ids) {
        try { await removeQueueItemFromDB(id); } catch (_) {}
      }
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

      this.updateQueueUI();
      return cleared;
    }

    /**
     * Process download queue (one at a time, sequential)
     */
    async processQueue() {
      if (this.isProcessing) {
        return;
      }

      this.isProcessing = true;

      while (this.persistentQueue.length > 0) {
        // Find next pending item
        const nextItem = this.persistentQueue.find(item => item.status === 'pending');
        if (!nextItem) break;

        this.currentDownload = nextItem;
        nextItem.status = 'downloading';
        await saveQueueItemToDB(nextItem);
        this.updateQueueUI();


        try {
          await this.downloadComic(nextItem);
          nextItem.status = 'completed';
          nextItem.progress = 1;
        } catch (error) {
          if (error.name === 'AbortError') {
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
      let lastSavedProgress = 0;
      let lastUIUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if (total) {
          const progress = received / total;
          queueItem.progress = progress;

          const now = Date.now();
          if (progress - lastSavedProgress >= 0.05 || now - lastUIUpdate >= 800) {
            await saveQueueItemToDB(queueItem);
            this.updateQueueUI();
            lastSavedProgress = progress;
            lastUIUpdate = now;
          }
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
      btn.className = `${colorClass} hover:opacity-80 text-2xl p-2 min-w-[44px] min-h-[44px] flex items-center justify-center`;
      btn.innerHTML = icon;
      btn.title = title;
      btn.onclick = async (e) => {
        e.stopPropagation();
        await onClick();
      };
      return btn;
    }

    /**
     * One-time install of touch listeners on the download queue container so
     * we can pause UI rebuilds while the user is mid-gesture. Idempotent.
     */
    _installQueueTouchTracking() {
      if (!downloadQueueDiv || downloadQueueDiv._touchTrackingInstalled) return;
      downloadQueueDiv._touchTrackingInstalled = true;

      const onStart = () => {
        downloadQueueDiv._userTouching = true;
      };
      const onEnd = () => {
        downloadQueueDiv._userTouching = false;
        if (downloadQueueDiv._pendingUpdate) {
          downloadQueueDiv._pendingUpdate = false;
          // Defer to next frame so any final scroll inertia commits first.
          requestAnimationFrame(() => this.updateQueueUI());
        }
      };

      downloadQueueDiv.addEventListener('touchstart', onStart, { passive: true });
      downloadQueueDiv.addEventListener('touchend', onEnd, { passive: true });
      downloadQueueDiv.addEventListener('touchcancel', onEnd, { passive: true });
    }

    /**
     * Update queue UI
     */
    updateQueueUI() {
      if (!downloadQueueDiv) return;

      // Mobile scroll fix: rebuilding innerHTML mid-touch kills an in-flight
      // scroll gesture because the touched DOM node disappears. While the
      // user is touching the panel, mark the update as pending and re-run it
      // once their finger lifts.
      if (downloadQueueDiv._userTouching) {
        downloadQueueDiv._pendingUpdate = true;
        return;
      }
      this._installQueueTouchTracking();

      const prevScroll = downloadQueueDiv.querySelector('.download-queue-scroll');
      const savedScrollTop = prevScroll ? prevScroll.scrollTop : 0;

      downloadQueueDiv.innerHTML = '';

      // Hide download queue on desktop devices
      if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
        downloadQueueDiv.classList.add('hidden');
        return;
      }

      // Don't show anything if queue is empty
      if (this.persistentQueue.length === 0) {
        downloadQueueDiv.classList.add('hidden');
        return;
      }

      downloadQueueDiv.classList.remove('hidden');

      // Calculate counts
      const activeCount = this.persistentQueue.filter(i => i.status === 'pending' || i.status === 'downloading').length;
      const totalCount = this.persistentQueue.length;

      // If collapsed, show as a small pill button — reset container to auto-width so the pill isn't floating inside a wide bordered box
      if (this.isCollapsed) {
        downloadQueueDiv.className = 'fixed bottom-16 right-4 sm:bottom-8 sm:right-8 z-40';

        const iconButton = document.createElement('button');
        iconButton.className = 'bg-gray-900 hover:bg-gray-800 text-white px-3 py-2 rounded-full shadow-lg flex items-center space-x-2 transition-colors ring-1 ring-white/10';
        iconButton.onclick = () => this.toggleCollapsed();
        iconButton.title = 'Show download queue';

        const icon = document.createElement('span');
        icon.innerHTML = ICONS.DOWNLOAD;
        icon.className = 'text-lg w-5 h-5';
        iconButton.appendChild(icon);

        const count = document.createElement('span');
        count.textContent = `(${activeCount}/${totalCount})`;
        count.className = 'text-sm font-medium';
        iconButton.appendChild(count);

        downloadQueueDiv.appendChild(iconButton);
        return;
      }

      // Expanded state — restore full container styling
      downloadQueueDiv.className = 'fixed bottom-16 right-4 sm:bottom-8 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl';

      // Create header bar
      const header = document.createElement('div');
      header.className = 'relative bg-gray-900/95 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-between cursor-pointer border-b border-white/5';
      header.onclick = () => this.toggleCollapsed();

      // Thin gradient accent line at the top
      const accent = document.createElement('div');
      accent.className = 'absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-500/60 to-transparent';
      header.appendChild(accent);

      // Header content (icon + title)
      const headerContent = document.createElement('div');
      headerContent.className = 'flex items-center gap-2.5';

      // Download icon (SVG, matches toolbar style)
      const iconWrap = document.createElement('span');
      iconWrap.className = 'inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-500/15 text-purple-300';
      iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>';
      headerContent.appendChild(iconWrap);

      // Title with monospaced counter
      const titleGroup = document.createElement('div');
      titleGroup.className = 'flex items-baseline gap-2';
      const titleLabel = document.createElement('span');
      titleLabel.className = 'text-sm font-semibold tracking-wide';
      titleLabel.textContent = 'Downloads';
      const counter = document.createElement('span');
      counter.className = 'text-xs font-mono text-gray-400';
      counter.textContent = `${activeCount}/${totalCount}`;
      titleGroup.appendChild(titleLabel);
      titleGroup.appendChild(counter);
      headerContent.appendChild(titleGroup);

      header.appendChild(headerContent);

      // Right-side action group (Stop All + Collapse)
      const actionGroup = document.createElement('div');
      actionGroup.className = 'flex items-center gap-1';

      const stopAllBtn = document.createElement('button');
      stopAllBtn.className = 'text-red-400 hover:text-red-300 p-1 rounded-md hover:bg-red-500/10 transition-colors';
      stopAllBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"/></svg>';
      stopAllBtn.title = 'Stop all downloads';
      stopAllBtn.onclick = (e) => {
        e.stopPropagation();
        this.stopAllDownloads();
      };
      actionGroup.appendChild(stopAllBtn);

      const collapseBtn = document.createElement('button');
      collapseBtn.className = 'text-gray-400 hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors';
      collapseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>';
      collapseBtn.title = 'Collapse';
      actionGroup.appendChild(collapseBtn);

      header.appendChild(actionGroup);

      downloadQueueDiv.appendChild(header);

      // Queue content container
      const queueContent = document.createElement('div');
      queueContent.className = 'bg-gray-900/95 backdrop-blur-sm download-queue-scroll';

      // Background sync indicator (compact pill row)
      const syncIndicator = document.createElement('div');
      syncIndicator.className = 'px-4 py-2 text-[11px] flex items-center gap-2 border-b border-white/5';

      const syncDot = document.createElement('span');
      syncDot.className = 'inline-block w-1.5 h-1.5 rounded-full';
      const syncText = document.createElement('span');

      if (this.useServiceWorker) {
        syncDot.classList.add('bg-emerald-400');
        syncText.className = 'text-emerald-300/90';
        syncText.textContent = 'Background sync on — downloads continue if you close this tab';
      } else {
        syncDot.classList.add('bg-amber-400');
        syncText.className = 'text-amber-300/90';
        syncText.textContent = 'Keep this tab open — background sync unavailable';
      }

      syncIndicator.appendChild(syncDot);
      syncIndicator.appendChild(syncText);
      queueContent.appendChild(syncIndicator);

      const STATUS_STYLES = {
        downloading: { dot: 'bg-blue-400 animate-pulse',     bar: 'from-blue-500 to-purple-500',     label: 'Downloading' },
        pending:     { dot: 'bg-gray-400',                    bar: 'from-gray-500 to-gray-400',       label: 'Waiting' },
        paused:      { dot: 'bg-amber-400',                   bar: 'from-amber-500 to-amber-400',     label: 'Paused' },
        completed:   { dot: 'bg-emerald-400',                 bar: 'from-emerald-500 to-emerald-400', label: 'Completed' },
        error:       { dot: 'bg-rose-400',                    bar: 'from-rose-500 to-rose-400',       label: 'Failed' }
      };

      // Items list
      const list = document.createElement('div');
      list.className = 'p-2 space-y-1.5';

      this.persistentQueue.forEach(item => {
        const styles = STATUS_STYLES[item.status] || STATUS_STYLES.pending;
        const pct = Math.round((item.progress || 0) * 100);

        const wrapper = document.createElement('div');
        wrapper.className = 'group relative bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-white/5 rounded-xl px-3 py-2.5 transition-colors';
        wrapper.dataset.comicId = item.id;

        // Top row: status dot + title + actions
        const topRow = document.createElement('div');
        topRow.className = 'flex items-start gap-2';

        const dot = document.createElement('span');
        dot.className = `mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`;
        topRow.appendChild(dot);

        const title = document.createElement('div');
        title.className = 'flex-1 min-w-0 text-[13px] leading-snug text-gray-100 truncate';
        title.title = item.displayName || item.comicName;
        title.textContent = item.displayName || item.comicName;
        topRow.appendChild(title);

        // Action buttons based on status
        const btnContainer = document.createElement('div');
        btnContainer.className = 'flex items-center gap-1 -mr-1 opacity-70 group-hover:opacity-100 transition-opacity';

        if (item.status === 'downloading') {
          if (!this.useServiceWorker || this.currentDownload?.id === item.id) {
            btnContainer.appendChild(this.createButton('⏸', 'Pause', 'text-blue-400',
              () => this.pauseDownload(item.id)));
          }
          btnContainer.appendChild(this.createButton('×', 'Cancel', 'text-rose-400',
            () => this.cancelDownload(item.id)));
        } else if (item.status === 'paused') {
          btnContainer.appendChild(this.createButton('▶', 'Resume', 'text-emerald-400',
            () => this.resumeDownload(item.id)));
          btnContainer.appendChild(this.createButton('×', 'Cancel', 'text-rose-400',
            () => this.cancelDownload(item.id)));
        } else if (item.status === 'error') {
          btnContainer.appendChild(this.createButton('↻', 'Restart', 'text-emerald-400',
            () => this.restartDownload(item.id)));
          btnContainer.appendChild(this.createButton('×', 'Remove', 'text-rose-400',
            () => this.cancelDownload(item.id)));
        } else if (item.status === 'pending') {
          btnContainer.appendChild(this.createButton('×', 'Cancel', 'text-rose-400',
            () => this.cancelDownload(item.id)));
        } else if (item.status === 'completed') {
          btnContainer.appendChild(this.createButton('×', 'Remove', 'text-gray-400',
            () => this.cancelDownload(item.id)));
        }

        topRow.appendChild(btnContainer);
        wrapper.appendChild(topRow);

        // Progress bar
        const bar = document.createElement('div');
        bar.className = 'w-full bg-white/5 rounded-full h-1 mt-2 overflow-hidden';
        const inner = document.createElement('div');
        inner.className = `h-full rounded-full bg-gradient-to-r ${styles.bar} transition-all duration-300`;
        inner.style.width = `${pct}%`;
        bar.appendChild(inner);
        wrapper.appendChild(bar);

        // Status row: label · percent / error
        const statusRow = document.createElement('div');
        statusRow.className = 'flex items-center justify-between mt-1.5 text-[11px]';
        const statusLeft = document.createElement('span');
        statusLeft.className = 'text-gray-400';
        if (item.status === 'error') {
          statusLeft.classList.remove('text-gray-400');
          statusLeft.classList.add('text-rose-300');
          statusLeft.textContent = item.error || 'Download failed';
        } else {
          statusLeft.textContent = styles.label;
        }
        const statusRight = document.createElement('span');
        statusRight.className = 'font-mono text-gray-500';
        if (item.status === 'completed') {
          statusRight.textContent = '100%';
        } else if (item.status === 'error') {
          statusRight.textContent = '';
        } else {
          statusRight.textContent = `${pct}%`;
        }
        statusRow.appendChild(statusLeft);
        statusRow.appendChild(statusRight);
        wrapper.appendChild(statusRow);

        list.appendChild(wrapper);
      });

      queueContent.appendChild(list);

      // Append queue content container
      downloadQueueDiv.appendChild(queueContent);
      queueContent.scrollTop = savedScrollTop;
    }

    /**
     * Show the download queue (even if empty)
     * This is called when user explicitly opens the downloads panel
     */
    showQueue() {
      if (!downloadQueueDiv) return;

      // Expand if collapsed
      if (this.isCollapsed) {
        this.isCollapsed = false;
        this.saveCollapsedState(false);
      }

      // If queue is empty, show empty state message
      if (this.persistentQueue.length === 0) {
        downloadQueueDiv.className = 'fixed bottom-16 right-4 sm:bottom-8 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl';
        downloadQueueDiv.innerHTML = `
          <div class="relative bg-gray-900/95 backdrop-blur-sm">
            <div class="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-500/60 to-transparent"></div>
            <div class="px-4 py-3 flex items-center justify-between border-b border-white/5">
              <div class="flex items-center gap-2.5">
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-500/15 text-purple-300">
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                  </svg>
                </span>
                <span class="text-sm font-semibold text-white tracking-wide">Downloads</span>
              </div>
              <button type="button" data-close="downloads" class="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-white/5" aria-label="Close downloads">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="px-6 py-10 bg-gray-900/95 flex flex-col items-center text-center">
              <span class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 ring-1 ring-white/5 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/>
                </svg>
              </span>
              <p class="text-sm font-medium text-gray-200">No active downloads</p>
              <p class="mt-1 text-xs text-gray-500">Comics you queue will appear here.</p>
            </div>
          </div>
        `;
        const closeBtn = downloadQueueDiv.querySelector('[data-close="downloads"]');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            downloadQueueDiv.classList.add('hidden');
          });
        }
      } else {
        // Queue has items, show normal UI
        this.updateQueueUI();
      }
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
      // Block downloads on desktop devices
      if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
        alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
        return false;
      }

      // Skip if already downloaded
      if (global.downloadedComicIds?.has(comic.id)) {
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

    // Block downloads on desktop devices
    if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
      alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
      return false;
    }

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

      // Confirmation before kicking off a bulk download (library / publisher /
      // series). The button's data attributes and the comic list together tell
      // us scope and size — surface both in the prompt.
      const queueable = comicsToDownload.filter(c => !global.downloadedComicIds?.has(c.id));
      if (queueable.length === 0) {
        alert('All comics in this selection are already downloaded.');
        return false;
      }
      const ds = btn.dataset || {};
      let scopeLabel = '';
      if (ds.seriesName) scopeLabel = `series "${ds.seriesName}"`;
      else if (ds.publisher) scopeLabel = `publisher "${ds.publisher}"`;
      else if (ds.rootFolder) scopeLabel = `library "${ds.rootFolder.split('/').filter(Boolean).pop() || ds.rootFolder}"`;
      const promptMsg = scopeLabel
        ? `Queue ${queueable.length} comic${queueable.length === 1 ? '' : 's'} from ${scopeLabel} for download?`
        : `Queue ${queueable.length} comic${queueable.length === 1 ? '' : 's'} for download?`;
      if (!window.confirm(promptMsg)) {
        return false;
      }

      btn._origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
             viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
          <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="text-xs">Queueing...</span>`;

      // Add queueable comics (already filtered above to skip downloaded).
      let queuedCount = 0;
      for (const comic of queueable) {
        await downloadManager.addToQueue(comic);
        queuedCount++;
      }

      // Update button to show queued
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs">${queuedCount} queued</span>`;


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

  /**
   * Download all comics in a reading list
   * @param {number} listId - The reading list ID
   * @param {string} listName - The reading list name (for user feedback)
   * @param {HTMLElement} btn - The button element to update
   */
  async function downloadReadingList(listId, listName, btn) {
    if (!btn) return;

    // Block downloads on desktop devices
    if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
      alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
      return false;
    }

    // Check if library is loaded
    if (!global.library || Object.keys(global.library).length === 0) {
      alert('Library is still loading. Please wait a moment and try again.');
      return false;
    }

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
      // Fetch reading list details
      if (typeof global.ReadingLists?.getReadingListDetails !== 'function') {
        throw new Error('Reading list API not available');
      }

      const listDetails = await global.ReadingLists.getReadingListDetails(listId);
      if (!listDetails || !listDetails.items || listDetails.items.length === 0) {
        throw new Error('Reading list is empty or not found');
      }

      // Convert comic IDs to full comic objects
      const comicsToDownload = [];
      for (const item of listDetails.items) {
        if (typeof global.getComicById === 'function') {
          const comic = global.getComicById(item.comicId);
          if (comic) {
            comicsToDownload.push(comic);
          } else {
          }
        }
      }

      if (comicsToDownload.length === 0) {
        throw new Error('No comics found in library. They may have been moved or deleted.');
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


      // Re-enable button and revert after delay
      setTimeout(() => {
        btn.disabled = false;
        if (btn._origHtml) {
          btn.innerHTML = btn._origHtml;
        }
      }, 3000);

    } catch (error) {
      console.error('[DOWNLOAD] Reading list download error:', error);
      alert('Failed to queue reading list for download: ' + error.message);
      btn.disabled = false;
      if (btn._origHtml) {
        btn.innerHTML = btn._origHtml;
      }
    }
  }

  const OfflineDownloads = {
    renderDownloadQueue,
    fetchWithProgress,
    refreshDownloadsInfo,
    downloadComic,
    downloadSeries,
    downloadReadingList,
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

  // ============================================================================
  // NOTIFICATION PERMISSION
  // ============================================================================

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
