import {
  state,
  escapeHtml,
  ICONS
} from '../globals.js';
import { appGlobal } from './bootstrap.js';

export function createReadingListComicCard({
  item,
  comic,
  listId,
  listName,
  isEditMode,
  isOffline,
  viewMode,
  comicsContainer,
  renderComics,
  hideReadingListDetail,
  showReadingListDetail
}) {
  const comicDiv = document.createElement('div');
  comicDiv.dataset.comicId = item.comicId;
  if (isEditMode) comicDiv.classList.add('is-editing');

  // Use display info to get properly formatted comic name (not filename)
  const displayInfo = typeof appGlobal.applyDisplayInfoToComic === 'function' ? appGlobal.applyDisplayInfoToComic(comic) : {};
  const title = displayInfo.displayTitle || comic.name || 'Unknown';
  const total = item.totalPages || 0;
  const last = item.lastReadPage || 0;
  const progressPercent = total > 0 ? Math.round((last / total) * 100) : 0;

  // Determine status
  let status = 'unread';
  if (total > 0) {
    if (last >= total - 1) status = 'read';
    else if (last > 0) status = 'in-progress';
  } else if (last > 0) {
    status = 'in-progress';
  }

  const isDownloaded = Boolean(
    (appGlobal.downloadedComicIds && appGlobal.downloadedComicIds.has(comic.id)) ||
    (state.downloadedComicIds && state.downloadedComicIds.has(comic.id)) ||
    (typeof window !== 'undefined' && window.downloadedComicIds && window.downloadedComicIds.has(comic.id))
  );

  // Render based on view mode
  if (viewMode === 'compact') {
    comicDiv.className = 'bg-gray-800/60 p-3 sm:p-3.5 rounded-xl flex items-start gap-3 hover:bg-gray-800/90 transition-all border border-gray-700/60 hover:border-purple-500/40 group';
    comicDiv.innerHTML = `
      ${isEditMode ? `
        <div class="flex flex-col gap-1 self-center shrink-0 mr-1">
          <button class="reorder-up-btn text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors" title="Move Up">▲</button>
          <button class="reorder-down-btn text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition-colors" title="Move Down">▼</button>
        </div>
      ` : ''}

      <div class="flex-1 min-w-0 flex flex-col gap-1.5">
        <div class="comic-title-line flex items-center gap-2">
          <h4 class="text-sm sm:text-base font-bold text-gray-100 group-hover:text-purple-300 transition-colors truncate">
            ${escapeHtml(title)}
          </h4>
        </div>

        <div class="comic-progress-line flex items-center gap-2 text-xs">
          <span class="inline-flex items-center text-sm ${status === 'read' ? 'text-green-500' : status === 'in-progress' ? 'text-purple-400' : 'text-gray-500'}" title="${status}">
            ${status === 'read' ? '●' : status === 'in-progress' ? '◐' : '○'}
          </span>
          ${status === 'read' ? `
            <span class="comic-completed-badge inline-flex items-center gap-1 text-green-400 font-bold bg-green-950/70 border border-green-700/60 px-1.5 py-0.5 rounded text-[11px]" title="Book Completed">
              <span>✓</span>
              <span>Completed</span>
            </span>
          ` : ''}
          <span class="font-bold text-[11px] uppercase tracking-wide ${status === 'read' ? 'text-green-400' : status === 'in-progress' ? 'text-purple-400' : 'text-gray-400'}">
            ${progressPercent}% read
          </span>
          ${total > 0 ? `<span class="text-gray-500 text-[11px]">• Page ${last > 0 ? last + 1 : 0} of ${total}</span>` : ''}
        </div>

        ${!isEditMode ? `
          <div class="comic-actions-line flex items-center gap-2 mt-1 pt-1.5 border-t border-gray-700/40">
            ${status === 'in-progress' ? `
              <button class="resume-comic-btn bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition-colors flex items-center gap-1.5 shadow" data-comic-id="${escapeHtml(item.comicId)}" title="Resume from page ${last + 1}">
                <span>▶</span>
                <span>Resume</span>
              </button>
            ` : `
              <button class="read-comic-btn ${status === 'read' ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-purple-600 hover:bg-purple-500 text-white'} text-xs font-bold py-1.5 px-3 rounded-lg transition-colors flex items-center gap-1.5 shadow" data-comic-id="${escapeHtml(item.comicId)}" title="Read comic">
                <span>▶</span>
                <span>Read</span>
              </button>
            `}
            <button class="mark-read-btn bg-gray-700/80 hover:bg-gray-600 text-gray-300 hover:text-green-400 text-xs font-bold py-1.5 px-2.5 rounded-lg transition-colors flex items-center gap-1.5 border border-gray-600/60" title="${status === 'read' ? 'Mark as unread' : 'Mark as read'}" data-comic-id="${escapeHtml(item.comicId)}" data-status="${status}">
              <span>${status === 'read' ? '↩' : ICONS.READ}</span>
              <span class="hidden sm:inline">${status === 'read' ? 'Mark Unread' : 'Mark Read'}</span>
            </button>
            <button class="download-comic-btn ${isDownloaded ? 'bg-green-950/60 hover:bg-green-900/60 text-green-400 hover:text-green-300 border-green-700/60' : 'bg-gray-700/80 hover:bg-gray-600 text-gray-300 hover:text-blue-400 border-gray-600/60'} text-xs font-bold py-1.5 px-2.5 rounded-lg transition-colors flex items-center gap-1.5 border" title="${isDownloaded ? 'Delete from device' : 'Download comic'}" data-comic-id="${escapeHtml(item.comicId)}" data-is-downloaded="${isDownloaded}">
              <span>${isDownloaded ? ICONS.READ : ICONS.DOWNLOAD}</span>
              <span class="hidden sm:inline">${isDownloaded ? 'Downloaded' : 'Download'}</span>
            </button>
          </div>
        ` : ''}
      </div>

      ${isEditMode ? `
        <button class="delete-comic-btn ${isOffline ? 'hidden' : ''} self-center shrink-0 text-red-400 hover:text-red-300 transition-colors p-2 hover:bg-red-500/10 rounded-lg ml-auto" title="Remove from list" data-comic-id="${escapeHtml(item.comicId)}">
          <span class="text-lg">🗑</span>
        </button>
      ` : ''}
    `;
  } else {
    comicDiv.className = 'comic-card bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-pointer flex flex-col border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';

    const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));
    const coverUrl = comic.thumbnailPath
      ? `${appGlobal.API_BASE_URL}/thumbnails/${comic.thumbnailPath}`
      : 'https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover';

    const statusBanner = (status === 'read' && !isLocal)
      ? '<div class="status-banner status-read">Read</div>'
      : (status === 'in-progress' && !isLocal)
      ? '<div class="status-banner status-in-progress">In Progress</div>'
      : '';

    comicDiv.innerHTML = `
      <div class="relative">
        ${isEditMode ? `
          <div class="absolute top-2 left-2 z-20 flex items-center gap-1 bg-gray-900/90 backdrop-blur p-1 rounded-lg shadow-xl">
            <div class="flex flex-col gap-0.5">
              <button class="reorder-up-btn text-gray-400 hover:text-white p-0.5 transition-colors" title="Move Up">▲</button>
              <button class="reorder-down-btn text-gray-400 hover:text-white p-0.5 transition-colors" title="Move Down">▼</button>
            </div>
          </div>
          <button class="delete-comic-btn absolute top-2 right-2 z-20 bg-gray-900/90 backdrop-blur p-1.5 rounded-lg text-red-500 hover:text-red-400 transition-all shadow-xl ${isOffline ? 'hidden' : ''}" title="Remove from list" data-comic-id="${escapeHtml(item.comicId)}">
            🗑
          </button>
        ` : `
          ${!isLocal ? `
            <button class="mark-read-btn absolute top-2 left-2 z-10 bg-gray-900/80 backdrop-blur p-1.5 rounded-lg text-gray-300 hover:text-green-400 transition-all shadow-lg" title="${status === 'read' ? 'Mark as unread' : 'Mark as read'}" data-comic-id="${escapeHtml(item.comicId)}" data-status="${status}">
              ${status === 'read' ? '↩' : ICONS.READ}
            </button>
            <button class="download-comic-btn absolute top-2 right-2 z-10 bg-gray-900/80 backdrop-blur p-1.5 rounded-lg ${isDownloaded ? 'text-green-400 hover:text-green-300' : 'text-gray-300 hover:text-blue-400'} transition-all shadow-lg" title="${isDownloaded ? 'Delete from device' : 'Download comic'}" data-comic-id="${escapeHtml(item.comicId)}" data-is-downloaded="${isDownloaded}">
              ${isDownloaded ? ICONS.READ : ICONS.DOWNLOAD}
            </button>
          ` : ''}
        `}
        ${statusBanner}
        <div class="aspect-2/3 w-full bg-gray-700 overflow-hidden flex items-center justify-center">
          ${comic.thumbnailPath ? 
            `<img src="${coverUrl}" alt="${escapeHtml(title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">` :
            (isLocal ? 
              `<div class="text-purple-500">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>` :
              `<img src="${coverUrl}" alt="${escapeHtml(title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">`
            )
          }
        </div>
        <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-900/50">
          <div class="h-full ${status === 'read' ? 'bg-green-500' : 'bg-purple-600'} transition-all duration-500" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
      <div class="p-3 grow flex flex-col justify-between min-w-0 gap-2">
        <div>
          <p class="text-sm font-bold text-white truncate leading-tight">${escapeHtml(title)}</p>
          <div class="flex items-center gap-1.5 mt-1">
            <span class="text-[10px] font-bold uppercase tracking-tighter text-gray-500">${progressPercent}% COMPLETE</span>
          </div>
        </div>
        ${!isEditMode ? `
          <div class="flex items-center gap-1.5 pt-1 mt-auto">
            ${status === 'in-progress' ? `
              <button class="resume-comic-btn w-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold py-1.5 px-2 rounded-md transition-colors flex items-center justify-center gap-1 shadow" data-comic-id="${escapeHtml(item.comicId)}" title="Resume from page ${last + 1}">
                <span>▶</span>
                <span>Resume</span>
              </button>
            ` : `
              <button class="read-comic-btn w-full ${status === 'read' ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-purple-600 hover:bg-purple-500 text-white'} text-xs font-bold py-1.5 px-3 rounded-md transition-colors flex items-center justify-center gap-1.5 shadow" data-comic-id="${escapeHtml(item.comicId)}" title="Read comic">
                <span>▶</span>
                <span>Read</span>
              </button>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  function openComicReader(comicToOpen, startPage = null) {
    if (typeof startPage === 'number') {
      try {
        sessionStorage.setItem(`progress_${comicToOpen.id}`, String(startPage));
      } catch (err) {}
    } else {
      try {
        sessionStorage.removeItem(`progress_${comicToOpen.id}`);
      } catch (err) {}
    }

    const openViewer = (typeof window !== 'undefined' && window.openComicViewer) ||
                       (typeof state !== 'undefined' && state.openComicViewer) ||
                       (typeof appGlobal !== 'undefined' && appGlobal.openComicViewer);
    const closeModal = (typeof window !== 'undefined' && window.closeReadingListModal) ||
                       (typeof state !== 'undefined' && state.closeReadingListModal) ||
                       (typeof appGlobal !== 'undefined' && appGlobal.closeReadingListModal);

    if (typeof openViewer === 'function') {
      openViewer(comicToOpen, { readingListId: listId, readingListName: listName });
      if (typeof closeModal === 'function') {
        closeModal();
      }
    }
  }

  if (!isEditMode) {
    comicDiv.style.cursor = 'pointer';
    comicDiv.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openComicReader(comic);
    });
  }

  if (isEditMode) {
    const upBtn = comicDiv.querySelector('.reorder-up-btn');
    const downBtn = comicDiv.querySelector('.reorder-down-btn');

    if (upBtn) {
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const prev = comicDiv.previousElementSibling;
        if (prev) comicsContainer.insertBefore(comicDiv, prev);
      });
    }

    if (downBtn) {
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = comicDiv.nextElementSibling;
        if (next) comicsContainer.insertBefore(next, comicDiv);
      });
    }
  }

  comicDiv.querySelectorAll('.read-comic-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openComicReader(comic, 0);
    });
  });

  comicDiv.querySelectorAll('.resume-comic-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openComicReader(comic, null);
    });
  });

  const markReadBtn = comicDiv.querySelector('.mark-read-btn');
  if (markReadBtn) {
    markReadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const currentStatus = markReadBtn.dataset.status;
      const newStatus = currentStatus === 'read' ? 'unread' : 'read';

      if (isOffline) {
        if (typeof appGlobal.updateOfflineReadStatus === 'function') {
          try {
            await appGlobal.updateOfflineReadStatus(item.comicId, newStatus);
            await renderComics();
          } catch (err) {
            console.warn('Failed to update offline read status:', err);
          }
          return;
        }
        alert('Updating status is not available while offline.');
        return;
      }

      try {
        const response = await fetch(`${appGlobal.API_BASE_URL}/api/v1/comics/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comicId: item.comicId, status: newStatus })
        });
        if (!response.ok) throw new Error('Failed to update status');
        await renderComics();
      } catch (error) {
        console.error('Failed to update comic status:', error);
        alert('Failed to update comic status. Please try again.');
      }
    });
  }

  const downloadBtn = comicDiv.querySelector('.download-comic-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isCurrentlyDownloaded = downloadBtn.dataset.isDownloaded === 'true' ||
        Boolean(
          (appGlobal.downloadedComicIds && appGlobal.downloadedComicIds.has(comic.id)) ||
          (state.downloadedComicIds && state.downloadedComicIds.has(comic.id)) ||
          (typeof window !== 'undefined' && window.downloadedComicIds && window.downloadedComicIds.has(comic.id))
        );

      if (isCurrentlyDownloaded) {
        if (confirm(`Delete "${title}" from your device?`)) {
          downloadBtn.disabled = true;
          const deleteFn = appGlobal.deleteOfflineComic || window.deleteOfflineComic || state.deleteOfflineComic;
          if (typeof deleteFn === 'function') {
            await deleteFn(comic.id);
          } else {
            console.warn('deleteOfflineComic function not available');
          }
          appGlobal.downloadedComicIds?.delete(comic.id);
          state.downloadedComicIds?.delete(comic.id);
          if (typeof window !== 'undefined' && window.downloadedComicIds) {
            window.downloadedComicIds.delete(comic.id);
          }
          await renderComics();
        }
      } else {
        if (typeof appGlobal.downloadComic === 'function') {
          await appGlobal.downloadComic(comic, downloadBtn);
        } else if (typeof window.downloadSeries === 'function') {
          window.downloadSeries([comic], downloadBtn);
        } else {
          console.error('downloadComic function not available');
          alert('Download functionality is not available. Please refresh the page.');
        }
      }
    });
  }

  const deleteBtn = comicDiv.querySelector('.delete-comic-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isOffline) {
        alert('Reading list editing is not available while offline.');
        return;
      }

      if (!confirm(`Remove "${title}" from this reading list?`)) return;

      try {
        const result = await appGlobal.ReadingLists.removeComicsFromList(listId, [item.comicId]);
        if (result.ok) {
          const containerEl = document.getElementById('list-detail-comics-container');
          containerEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading comics...</p>';

          const details = await appGlobal.ReadingLists.getReadingListDetails(listId);
          if (!details.items || details.items.length === 0) {
            containerEl.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
          } else {
            hideReadingListDetail();
            showReadingListDetail(listId, listName);
          }
        } else {
          alert('Failed to remove comic from list. Please try again.');
        }
      } catch (error) {
        console.error('Failed to delete comic from list:', error);
        alert('Failed to remove comic from list. Please try again.');
      }
    });
  }

  return comicDiv;
}
