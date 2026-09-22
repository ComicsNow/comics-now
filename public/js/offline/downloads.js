import { state, ICONS, encodePath, downloadQueueDiv } from '../globals.js';
import { isDesktopDevice } from '../utils/device-detection.js';

// ============================================================================
// BACKGROUND DOWNLOAD MANAGER
// ============================================================================

export class BackgroundDownloadManager {
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
    return typeof navigator !== 'undefined' &&
           'serviceWorker' in navigator &&
           typeof ServiceWorkerRegistration !== 'undefined' &&
           'sync' in ServiceWorkerRegistration.prototype;
  }

  /**
   * Load queue from IndexedDB on initialization
   */
  async loadQueue() {
    try {
      const db = state.OfflineDB || window.OfflineDB || {};
      if (db.getQueueFromDB) {
        this.persistentQueue = await db.getQueueFromDB();
      }
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
    const getCurrentUserId = state.getCurrentUserId || window.getCurrentUserId;
    const applyDisplayInfoToComic = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;

    // Ensure comic has userId before adding to queue
    if (!comic.userId && typeof getCurrentUserId === "function") {
      comic.userId = getCurrentUserId();
    }

    const displayInfo = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(comic) : comic;
    const queueItem = {
      id: comic.id,
      comicPath: comic.path,
      comicName: comic.name || 'Comic',
      displayName: displayInfo.displayTitle || comic.name || 'Comic',
      status: 'pending',
      progress: 0,
      priority: this.persistentQueue.length, // Add to end
      addedAt: Date.now(),
      comic: comic // Store full comic object for download
    };

    this.persistentQueue.push(queueItem);
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveQueueItemToDB) {
      await db.saveQueueItemToDB(queueItem);
    }

    // Update UI
    this.updateQueueUI();

    // Register background sync if supported (Service Worker will handle downloads)
    if (this.useServiceWorker) {
      await this.registerBackgroundSync();
      // Explicitly trigger SW to start downloading immediately just in case sync is delayed
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'start-downloads' });
      }
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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.removeQueueItemFromDB) {
      await db.removeQueueItemFromDB(comicId);
    }

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
    const db = state.OfflineDB || window.OfflineDB || {};
    for (const id of ids) {
      try { 
        if (db.removeQueueItemFromDB) {
          await db.removeQueueItemFromDB(id);
        }
      } catch (_) {}
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

    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveQueueItemToDB) {
      await db.saveQueueItemToDB(item);
    }

    this.updateQueueUI();

    // Trigger processing
    if (this.useServiceWorker) {
      await this.registerBackgroundSync();
      // Explicitly trigger SW to start downloading immediately
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'start-downloads' });
      }
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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveQueueItemToDB) {
      await db.saveQueueItemToDB(item);
    }

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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveQueueItemToDB) {
      await db.saveQueueItemToDB(item);
    }

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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.updateQueuePriorities) {
      await db.updateQueuePriorities(this.persistentQueue);
    }

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
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.clearCompletedQueueItems) {
      await db.clearCompletedQueueItems();
    }
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
      const db = state.OfflineDB || window.OfflineDB || {};
      if (db.saveQueueItemToDB) {
        await db.saveQueueItemToDB(nextItem);
      }
      this.updateQueueUI();


      try {
        await this.downloadComic(nextItem);
        nextItem.status = 'completed';
        nextItem.progress = 1;
      } catch (error) {
        if (error.name === 'AbortError') {
          // Remove from queue, don't mark as error
          if (db.removeQueueItemFromDB) {
            await db.removeQueueItemFromDB(nextItem.id);
          }
          this.persistentQueue = this.persistentQueue.filter(item => item.id !== nextItem.id);
        } else {
          console.error('[DOWNLOAD MANAGER] Download failed:', nextItem.displayName, error);
          nextItem.status = 'error';
          nextItem.error = error.message || 'Download failed';
          if (db.saveQueueItemToDB) {
            await db.saveQueueItemToDB(nextItem);
          }
        }
      }

      this.currentDownload = null;
      this.updateQueueUI();

      // Remove completed items after 3 seconds
      if (nextItem.status === 'completed') {
        setTimeout(async () => {
          if (db.removeQueueItemFromDB) {
            await db.removeQueueItemFromDB(nextItem.id);
          }
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

    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const url = `${apiBaseUrl}/api/v1/comics/download?path=${encodeURIComponent(encodePath(comic.path))}`;

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

    const db = state.OfflineDB || window.OfflineDB || {};

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
          if (db.saveQueueItemToDB) {
            await db.saveQueueItemToDB(queueItem);
          }
          this.updateQueueUI();
          lastSavedProgress = progress;
          lastUIUpdate = now;
        }
      }
    }

    const blob = new Blob(chunks);
    
    // Fetch guided view data to cache it
    try {
      const guidedViewUrl = `${apiBaseUrl}/api/v1/comics/${encodeURIComponent(comic.id)}/guided-view`;
      const gvRes = await fetch(guidedViewUrl, { credentials: 'include' });
      if (gvRes.ok && 'caches' in window) {
        const cache = await caches.open('comics-now-downloads');
        await cache.put(guidedViewUrl, gvRes);
      }
    } catch (gvErr) {
      console.error('[DOWNLOAD MANAGER] Guided view fetch failed:', gvErr);
    }

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

    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveComicToDB) {
      await db.saveComicToDB(comicRecord, blob);
    }

    const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds || new Set();
    downloadedComicIds.add(comic.id);
    state.downloadedComicIds = downloadedComicIds;
    if (typeof window !== 'undefined') {
      window.downloadedComicIds = downloadedComicIds;
    }

    // Refresh library to show checkmark
    const fetchLibrary = state.fetchLibrary || window.fetchLibrary;
    if (typeof fetchLibrary === 'function') {
      await fetchLibrary();
    }

    // Refresh downloads info
    const refreshDownloadsInfo = state.refreshDownloadsInfo || window.refreshDownloadsInfo;
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
      iconButton.className = 'brutalist-btn btn-cyan px-3 py-1.5 flex items-center space-x-2 transition-all';
      iconButton.onclick = () => this.toggleCollapsed();
      iconButton.title = 'Show download queue';

      const icon = document.createElement('span');
      icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>';
      icon.className = 'inline-flex items-center justify-center';
      iconButton.appendChild(icon);

      const count = document.createElement('span');
      count.textContent = `Downloads (${activeCount}/${totalCount})`;
      count.className = 'text-xs font-mono font-bold uppercase tracking-wider';
      iconButton.appendChild(count);

      downloadQueueDiv.appendChild(iconButton);
      return;
    }

    // Expanded state — restore full container styling
    downloadQueueDiv.className = 'fixed bottom-0 right-4 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] dl-queue-container';

    // Create header bar
    const header = document.createElement('div');
    header.className = 'modal-header';

    // Header content: icon
    const dlIcon = document.createElement('div');
    dlIcon.className = 'dl-icon';
    dlIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    header.appendChild(dlIcon);

    // Title text
    const titleLabel = document.createElement('span');
    titleLabel.className = 'modal-title';
    titleLabel.textContent = 'Downloads';
    header.appendChild(titleLabel);

    // Counter badge
    const counter = document.createElement('span');
    counter.className = 'modal-count';
    counter.textContent = `${activeCount} / ${totalCount}`;
    header.appendChild(counter);

    // Actions group
    const actionGroup = document.createElement('div');
    actionGroup.className = 'header-actions';

    // Stop all button
    const stopAllBtn = document.createElement('button');
    stopAllBtn.type = 'button';
    stopAllBtn.className = 'ha';
    stopAllBtn.title = 'Stop all downloads';
    stopAllBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    stopAllBtn.onclick = (e) => {
      e.stopPropagation();
      this.stopAllDownloads();
    };
    actionGroup.appendChild(stopAllBtn);

    // Collapse button
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ha';
    collapseBtn.title = 'Collapse';
    collapseBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
    collapseBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleCollapsed();
    };
    actionGroup.appendChild(collapseBtn);

    header.appendChild(actionGroup);
    downloadQueueDiv.appendChild(header);

    // Queue content container
    const queueContent = document.createElement('div');
    queueContent.className = 'download-queue-scroll';

    // Dynamic Sync Notice
    const syncIndicator = document.createElement('div');
    const syncText = document.createElement('p');
    syncIndicator.innerHTML = '<svg viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

    if (this.useServiceWorker) {
      syncIndicator.className = 'sync-notice sync-active';
      syncText.textContent = 'Background sync on — downloads continue if you close this tab';
    } else {
      syncIndicator.className = 'sync-notice sync-warning';
      syncText.textContent = 'Keep this tab open — background sync unavailable';
    }

    syncIndicator.appendChild(syncText);
    queueContent.appendChild(syncIndicator);

    // Items list
    const list = document.createElement('div');
    list.className = 'item-list';

    this.persistentQueue.forEach(item => {
      const pct = Math.round((item.progress || 0) * 100);

      const wrapper = document.createElement('div');
      wrapper.className = 'item';
      wrapper.dataset.comicId = item.id;

      // Top row: status dot + title + actions
      const topRow = document.createElement('div');
      topRow.className = 'item-top';

      const dot = document.createElement('span');
      let statusDotClass = 'dot-pending';
      let statusLabel = 'Waiting';

      if (item.status === 'downloading') {
        statusDotClass = 'dot-active';
        statusLabel = 'Downloading…';
      } else if (item.status === 'paused') {
        statusDotClass = 'dot-paused';
        statusLabel = 'Paused';
      } else if (item.status === 'error') {
        statusDotClass = 'dot-error';
        statusLabel = item.error || 'Download failed';
      } else if (item.status === 'completed') {
        statusDotClass = 'dot-completed';
        statusLabel = 'Completed';
      }

      dot.className = `status-dot ${statusDotClass}`;
      topRow.appendChild(dot);

      const title = document.createElement('span');
      title.className = 'item-name';
      title.title = item.displayName || item.comicName;
      title.textContent = item.displayName || item.comicName;
      topRow.appendChild(title);

      // Cancel button
      const cancelBtn = document.createElement('div');
      cancelBtn.className = 'cancel';
      cancelBtn.title = (item.status === 'completed' || item.status === 'error') ? 'Remove' : 'Cancel';
      cancelBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        this.cancelDownload(item.id);
      };
      topRow.appendChild(cancelBtn);
      wrapper.appendChild(topRow);

      // Progress bar
      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      wrapper.appendChild(track);

      // Status row: label + percent
      const statusRow = document.createElement('div');
      statusRow.className = 'item-status';

      const labelSpan = document.createElement('span');
      labelSpan.className = `status-label${item.status === 'error' ? ' status-error' : ''}`;
      labelSpan.textContent = statusLabel;
      statusRow.appendChild(labelSpan);

      const pctSpan = document.createElement('span');
      let pctClass = 'status-pct';
      if (item.status === 'completed') pctClass += ' pct-completed';
      else if (item.status === 'error') pctClass += ' pct-error';
      pctSpan.className = pctClass;
      
      if (item.status === 'completed') {
        pctSpan.textContent = '100%';
      } else if (item.status === 'error') {
        pctSpan.textContent = 'Failed';
      } else {
        pctSpan.textContent = `${pct}%`;
      }
      statusRow.appendChild(pctSpan);
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
      downloadQueueDiv.className = 'fixed bottom-0 right-4 sm:right-8 z-40 w-[22rem] max-w-[calc(100vw-2rem)] dl-queue-container';
      downloadQueueDiv.innerHTML = `
        <div class="handle"></div>
        <div class="modal-header">
          <div class="dl-icon">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <span class="modal-title">Downloads</span>
          <span class="modal-count">0 / 0</span>
          <div class="header-actions">
            <button type="button" data-close="downloads" class="ha" aria-label="Close downloads">
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="empty-state-dl">
          <span class="empty-icon">
            <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"/></svg>
          </span>
          <p class="empty-title">No active downloads</p>
          <p class="empty-subtitle">Comics you queue will appear here.</p>
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
export const downloadManager = new BackgroundDownloadManager();

// ============================================================================
// LEGACY SUPPORT & COMPATIBILITY
// ============================================================================

// Legacy compatibility function - delegates to download manager
export function renderDownloadQueue() {
  // Delegate to download manager's UI
  if (downloadManager) {
    downloadManager.updateQueueUI();
  }
}

// Expose legacy API on state & global scope
state.renderDownloadQueue = renderDownloadQueue;
if (typeof window !== 'undefined') {
  window.renderDownloadQueue = renderDownloadQueue;
}

// Request notification permission on first download if background sync is supported
let notificationPermissionRequested = false;

const originalAddToQueue = downloadManager.addToQueue.bind(downloadManager);
downloadManager.addToQueue = async function (comic) {
  const requestNotificationPermission = state.requestNotificationPermission || window.requestNotificationPermission;
  // Request notification permission on first download
  if (!notificationPermissionRequested && BackgroundDownloadManager.isBackgroundSyncSupported()) {
    notificationPermissionRequested = true;
    if (typeof requestNotificationPermission === 'function') {
      await requestNotificationPermission();
    }
  }

  return originalAddToQueue(comic);
};

// Expose download manager to state and global window
state.downloadManager = downloadManager;
if (typeof window !== 'undefined') {
  window.downloadManager = downloadManager;
}
