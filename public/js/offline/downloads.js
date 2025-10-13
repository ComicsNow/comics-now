(function (global) {
  'use strict';

  const OfflineDB = global.OfflineDB || {};
  const {
    saveComicToDB,
    getAllDownloadedComics,
    deleteOfflineComic,
    forceStorageCleanup,
  } = OfflineDB;

  function renderDownloadQueue() {
    if (!downloadQueueDiv) return;
    downloadQueueDiv.innerHTML = '';
    downloadQueue.forEach(item => {
      const wrapper = document.createElement('div');
      wrapper.className = 'bg-gray-800 text-white p-2 rounded shadow';

      const title = document.createElement('div');
      title.className = 'text-sm';
      title.textContent = item.displayName || item.name;
      wrapper.appendChild(title);

      const bar = document.createElement('div');
      bar.className = 'w-full bg-gray-700 rounded h-2 mt-1';
      const inner = document.createElement('div');
      inner.className = item.error ? 'bg-red-500 h-2 rounded' : 'bg-blue-500 h-2 rounded';
      inner.style.width = `${Math.round(item.progress * 100)}%`;
      bar.appendChild(inner);
      wrapper.appendChild(bar);

      downloadQueueDiv.appendChild(wrapper);
    });
    downloadQueueDiv.classList.toggle('hidden', downloadQueue.length === 0);
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

  async function downloadComic(comic, btn) {
    const restore = () => {
      if (!btn) return;
      btn.disabled = false;
      btn.innerHTML = btn._origHtml || btn.innerHTML;
    };

    const displayInfo = applyDisplayInfoToComic(comic);
    const queueItem = {
      id: comic.id,
      name: comic.name || 'Comic',
      displayName: displayInfo.displayTitle,
      progress: 0,
    };
    downloadQueue.push(queueItem);
    renderDownloadQueue();

    try {
      if (btn) {
        btn._origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 animate-spin"
               viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" stroke-width="4" opacity=".25"/>
            <path d="M4 12a8 8 0 018-8" stroke-width="4" stroke-linecap="round"/>
          </svg>`;
      }

      const url = `${API_BASE_URL}/api/v1/comics/download?path=${encodeURIComponent(encodePath(comic.path))}`;
      const blob = await fetchWithProgress(url, progress => {
        queueItem.progress = progress;
        renderDownloadQueue();
      });

      const comicRecord = {
        ...comic,
        progress: { ...(comic.progress || {}) },
        downloadedAt: Date.now(),
      };
      await saveComicToDB(comicRecord, blob);

      if (!global.downloadedComicIds) global.downloadedComicIds = new Set();
      global.downloadedComicIds.add(comic.id);

      if (btn) {
        const check = document.createElement('div');
        check.className = 'download-btn absolute top-2 right-2 text-green-400 pointer-events-none';
        check.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"/>
          </svg>`;
        btn.replaceWith(check);
        if (typeof fetchLibrary === 'function') {
          await fetchLibrary();
        }
      }

      await refreshDownloadsInfo();
      queueItem.progress = 1;
      return true;
    } catch (error) {
      
      alert('Saving for offline failed.');
      queueItem.error = true;
      queueItem.progress = 1;
      return false;
    } finally {
      renderDownloadQueue();
      setTimeout(() => {
        const idx = downloadQueue.indexOf(queueItem);
        if (idx !== -1) downloadQueue.splice(idx, 1);
        renderDownloadQueue();
      }, 2000);
      restore();
    }
  }

  async function downloadSeries(comics, btn) {
    if (!btn) return;
    btn._origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 animate-spin"
           viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="4" opacity=".25"/>
        <path d="M4 12a8 8 0 018-8" stroke-width="4" stroke-linecap="round"/>
      </svg>`;

    try {
      let comicsToDownload = [];

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

      for (const comic of comicsToDownload) {
        if (!downloadedComicIds.has(comic.id)) {
          const success = await downloadComic(comic);
          if (!success) throw new Error('Comic download failed');
        }
      }

      const check = document.createElement('div');
      check.className = 'download-btn absolute top-2 right-2 text-green-400 pointer-events-none';
      check.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>`;
      btn.replaceWith(check);
      if (typeof fetchLibrary === 'function') {
        await fetchLibrary();
      }
      await refreshDownloadsInfo();
    } catch (error) {
      
      alert('Series download failed.');
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
  };

  global.OfflineDownloads = OfflineDownloads;
  Object.assign(global, OfflineDownloads);
})(typeof window !== 'undefined' ? window : globalThis);
