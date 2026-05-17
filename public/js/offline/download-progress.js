(function (global) {
  'use strict';

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
    const db = global.OfflineDB || {};
    if (!db.getAllDownloadedComics) {
      console.warn('[DOWNLOADS INFO] OfflineDB not ready');
      return;
    }

    if (!global.downloadsInfoDiv) return;

    global.downloadsInfoDiv.innerHTML = 'Calculating...';
    let downloadedComics = [];
    try {
      downloadedComics = await db.getAllDownloadedComics();
    } catch (err) {
      console.error('[DOWNLOADS INFO] Failed to calculate downloads:', err);
      global.downloadsInfoDiv.innerHTML = '<div class="text-red-400 text-sm">Error calculating downloads. Please refresh.</div>';
      return;
    }
    let totalSize = 0;
    
    // Clear and prepare container
    global.downloadsInfoDiv.innerHTML = '';
    const list = document.createElement('ul');

    downloadedComics.forEach(comic => {
      totalSize += comic.fileBlob?.size || 0;
      const comicInfo = comic.comicInfo || {};
      const info = typeof global.applyDisplayInfoToComic === 'function' ? global.applyDisplayInfoToComic(comicInfo) : comicInfo;
      const displayName = info.displayTitle || comicInfo.name || 'Unknown Comic';

      const li = document.createElement('li');
      li.className = 'text-sm flex justify-between items-center';

      const nameSpan = document.createElement('span');
      nameSpan.title = displayName;
      nameSpan.textContent = displayName;
      li.appendChild(nameSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-download-btn text-red-500 hover:text-red-700';
      deleteBtn.dataset.id = comic.id;
      deleteBtn.dataset.name = displayName;
      deleteBtn.textContent = 'Delete';
      li.appendChild(deleteBtn);

      list.appendChild(li);
    });

    const summary = document.createElement('div');
    summary.innerHTML = `
      <p><strong>${downloadedComics.length}</strong> comics downloaded.</p>
      <p><strong>Total size:</strong> ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>
    `;
    
    const listWrapper = document.createElement('div');
    listWrapper.className = 'mt-4 max-h-48 overflow-y-auto';
    listWrapper.appendChild(list);
    
    global.downloadsInfoDiv.appendChild(summary);
    global.downloadsInfoDiv.appendChild(listWrapper);

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
          console.log(`[DOWNLOADS INFO] Starting deletion of comic: ${comicName} (${id})`);
          target.disabled = true;
          target.textContent = 'Deleting...';

          const db = global.OfflineDB || {};
          const deleteFn = db.deleteOfflineComic || global.deleteOfflineComic;
          const cleanupFn = db.forceStorageCleanup || global.forceStorageCleanup;

          if (deleteFn) {
            await deleteFn(id);
            console.log(`[DOWNLOADS INFO] Successfully called deleteOfflineComic for: ${id}`);
          } else {
            throw new Error('deleteOfflineComic function not found in global scope');
          }

          if (cleanupFn) {
            try {
              await cleanupFn();
            } catch (e) {
              console.warn('[DOWNLOADS INFO] forceStorageCleanup failed (non-critical):', e);
            }
          }

          if (typeof global.fetchLibrary === 'function') {
            try {
              await global.fetchLibrary();
            } catch (e) {
              console.warn('[DOWNLOADS INFO] fetchLibrary failed (non-critical):', e);
            }
          }
          
          console.log(`[DOWNLOADS INFO] Refreshing UI after deletion of: ${id}`);
          await refreshDownloadsInfo();
        } catch (error) {
          console.error('[DOWNLOADS INFO] Error deleting comic:', error);
          alert('Failed to delete comic. Please try again.');
          target.disabled = false;
          target.textContent = 'Delete';
        }
      });
    });
  }

  global.fetchWithProgress = fetchWithProgress;
  global.refreshDownloadsInfo = refreshDownloadsInfo;

})(typeof window !== 'undefined' ? window : globalThis);
