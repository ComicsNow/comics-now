import {
  state,
  escapeHtml,
  getComicById
} from '../globals.js';
import { renderReadingListDAG } from '../reading-list-dag.js';
import { isAppOnline } from '../offline/status.js';
import { appGlobal } from './bootstrap.js';
import { hideReadingListDetail } from './reading-list-actions.js';
import { createReadingListComicCard } from './reading-list-detail-cards.js';

/**
 * Show reading list detail view
 * @param {string} listId - The reading list ID
 * @param {string} listName - The reading list name
 * @param {string|null} initialViewMode - Optional initial view mode ('detailed', 'compact', 'dag')
 */
export async function showReadingListDetail(listId, listName, initialViewMode = null) {
  const modal = document.getElementById('reading-list-modal');
  const overviewEl = document.getElementById('reading-lists-overview');
  const mainListsContainer = document.getElementById('reading-lists-container');
  const modalBody = document.getElementById('reading-list-modal-body');
  const modalContent = modalBody || overviewEl?.parentElement || mainListsContainer?.parentElement?.parentElement || mainListsContainer?.parentElement;
  if (!modalContent) return;

  const modalContainer = modal?.querySelector('.bg-gray-800');
  const isOffline = typeof isAppOnline === 'function' ? !isAppOnline() : (typeof navigator !== 'undefined' && navigator && navigator.onLine === false);

  let viewMode = initialViewMode || localStorage.getItem('readingListViewMode') || 'detailed';
  let isEditMode = false;

  if (modalContainer) {
    if (viewMode === 'dag') {
      modalContainer.classList.remove('max-w-3xl');
      modalContainer.classList.add('max-w-6xl', 'w-full', 'h-[92vh]');
    } else {
      modalContainer.classList.remove('max-w-6xl', 'h-[92vh]');
      modalContainer.classList.add('max-w-3xl');
    }
  }

  if (overviewEl) overviewEl.classList.add('hidden');
  if (mainListsContainer) mainListsContainer.classList.add('hidden');

  const existingDetail = document.getElementById('reading-list-detail-view');
  if (existingDetail) existingDetail.remove();

  const detailView = document.createElement('div');
  detailView.id = 'reading-list-detail-view';
  detailView.className = 'flex-1 overflow-y-auto p-4 sm:p-6';

  detailView.innerHTML = `
    <div class="mb-5 flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-gray-700/60">
      <div class="flex items-center gap-3 min-w-0">
        <button id="back-to-lists-btn" class="shrink-0" title="Back to reading lists">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div class="min-w-0">
          <h2 class="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 truncate">
            <span class="text-purple-400 shrink-0">📚</span>
            <span class="truncate">${escapeHtml(listName)}</span>
          </h2>
          <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
            <span>Reading List Detail</span>
            <span class="w-1 h-1 rounded-full bg-gray-600"></span>
            <span id="list-item-count-badge">Loading...</span>
            ${isOffline ? '<span class="w-1 h-1 rounded-full bg-gray-600"></span><span class="text-amber-400 font-semibold">Offline</span>' : ''}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
        <div class="view-mode-segmented-control flex items-center bg-gray-900/80 p-1 rounded-lg border border-gray-700/80 text-xs shadow-inner">
          <button id="view-mode-grid-btn" class="segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'detailed' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}" title="Grid View">
            <span>⊞</span>
            <span class="hidden sm:inline">Grid</span>
          </button>
          <button id="view-mode-compact-btn" class="segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'compact' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}" title="Compact List View">
            <span>☰</span>
            <span class="hidden sm:inline">List</span>
          </button>
          <button id="view-mode-dag-btn" class="segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'dag' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}" title="Interactive Continuity DAG">
            <span>🔀</span>
            <span class="hidden sm:inline">DAG</span>
          </button>
        </div>

        <button id="download-all-list-btn" class="bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 font-semibold py-2 px-3 rounded-lg transition-all shadow-sm flex items-center gap-1.5 text-xs">
          <span>⬇</span>
          <span class="hidden sm:inline">Download</span>
        </button>
        <button id="export-list-btn" class="bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 font-semibold py-2 px-3 rounded-lg transition-all shadow-sm flex items-center gap-1.5 text-xs">
          <span>📤</span>
          <span class="hidden sm:inline">Export</span>
        </button>
        <button id="edit-list-btn" class="bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 font-semibold py-2 px-3 rounded-lg transition-all shadow-sm flex items-center gap-1.5 text-xs ${isOffline || viewMode === 'dag' ? 'hidden' : ''}">
          <span>✏️</span>
          <span class="hidden sm:inline">Edit</span>
        </button>
      </div>
    </div>

    <div id="reading-list-edit-actions" class="hidden flex items-center justify-between bg-gray-800/80 p-2.5 rounded-xl border border-gray-700/60 mb-4 shadow-md" hidden>
      <div class="flex items-center gap-2">
        <button id="save-order-btn" class="hidden bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-all shadow-lg hover:shadow-green-900/40 text-xs flex items-center gap-1.5" hidden>
          <span>💾</span>
          <span>Save Order</span>
        </button>
        <button id="cancel-edit-btn" class="hidden bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-3 rounded-lg transition-all border border-gray-500 text-xs flex items-center gap-1.5" hidden>
          <span>✕</span>
          <span>Cancel</span>
        </button>
      </div>
      <span class="text-[11px] text-gray-400 italic hidden sm:inline">Use ▲/▼ or drag to reorder reading list</span>
    </div>

    <div id="list-detail-comics-container" class="space-y-2">
      <p class="text-sm text-gray-400 text-center py-8 animate-pulse italic">Loading your collection...</p>
    </div>
  `;

  modalContent.appendChild(detailView);
  document.getElementById('back-to-lists-btn').addEventListener('click', hideReadingListDetail);

  const updateViewModeControls = () => {
    const gridBtn = document.getElementById('view-mode-grid-btn');
    const compactBtn = document.getElementById('view-mode-compact-btn');
    const dagBtn = document.getElementById('view-mode-dag-btn');
    const editBtn = document.getElementById('edit-list-btn');
    const editActionsBar = document.getElementById('reading-list-edit-actions');
    const saveBtn = document.getElementById('save-order-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');

    if (gridBtn) gridBtn.className = `segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'detailed' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}`;
    if (compactBtn) compactBtn.className = `segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'compact' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}`;
    if (dagBtn) dagBtn.className = `segmented-btn px-2.5 py-1.5 rounded-md font-bold transition-all flex items-center gap-1 ${viewMode === 'dag' ? 'active-view-mode bg-purple-600 text-white shadow' : 'text-gray-300 hover:text-white'}`;

    if (modalContainer) {
      if (viewMode === 'dag') {
        modalContainer.classList.remove('max-w-3xl');
        modalContainer.classList.add('max-w-6xl', 'w-full', 'h-[92vh]');
      } else {
        modalContainer.classList.remove('max-w-6xl', 'h-[92vh]');
        modalContainer.classList.add('max-w-3xl');
      }
    }

    if (editBtn) {
      if (isEditMode || viewMode === 'dag' || isOffline) {
        editBtn.classList.add('hidden');
      } else {
        editBtn.classList.remove('hidden');
      }
    }
    if (editActionsBar) {
      if (isEditMode) {
        editActionsBar.classList.remove('hidden');
        editActionsBar.hidden = false;
      } else {
        editActionsBar.classList.add('hidden');
        editActionsBar.hidden = true;
      }
    }
    if (saveBtn) {
      if (isEditMode) {
        saveBtn.classList.remove('hidden');
        saveBtn.hidden = false;
      } else {
        saveBtn.classList.add('hidden');
        saveBtn.hidden = true;
      }
    }
    if (cancelBtn) {
      if (isEditMode) {
        cancelBtn.classList.remove('hidden');
        cancelBtn.hidden = false;
      } else {
        cancelBtn.classList.add('hidden');
        cancelBtn.hidden = true;
      }
    }
  };

  const exitEditMode = () => {
    isEditMode = false;
    const editBtn = document.getElementById('edit-list-btn');
    const editActionsBar = document.getElementById('reading-list-edit-actions');
    const saveBtn = document.getElementById('save-order-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (editBtn) editBtn.classList.toggle('hidden', viewMode === 'dag' || isOffline);
    if (editActionsBar) {
      editActionsBar.classList.add('hidden');
      editActionsBar.hidden = true;
    }
    if (saveBtn) {
      saveBtn.classList.add('hidden');
      saveBtn.hidden = true;
    }
    if (cancelBtn) {
      cancelBtn.classList.add('hidden');
      cancelBtn.hidden = true;
    }
  };

  document.getElementById('view-mode-grid-btn')?.addEventListener('click', () => {
    if (viewMode === 'detailed') return;
    exitEditMode();
    viewMode = 'detailed';
    localStorage.setItem('readingListViewMode', viewMode);
    updateViewModeControls();
    renderComics();
  });

  document.getElementById('view-mode-compact-btn')?.addEventListener('click', () => {
    if (viewMode === 'compact') return;
    exitEditMode();
    viewMode = 'compact';
    localStorage.setItem('readingListViewMode', viewMode);
    updateViewModeControls();
    renderComics();
  });

  document.getElementById('view-mode-dag-btn')?.addEventListener('click', () => {
    if (viewMode === 'dag') return;
    exitEditMode();
    viewMode = 'dag';
    localStorage.setItem('readingListViewMode', viewMode);
    updateViewModeControls();
    renderComics();
  });

  async function renderComics() {
    try {
      const details = await appGlobal.ReadingLists.getReadingListDetails(listId);
      const comicsContainer = document.getElementById('list-detail-comics-container');
      const countBadge = document.getElementById('list-item-count-badge');

      if (!details.items || details.items.length === 0) {
        if (countBadge) countBadge.textContent = '0 items';
        comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No comics in this list.</p>';
        return;
      }

      if (countBadge) countBadge.textContent = `${details.items.length} item${details.items.length === 1 ? '' : 's'}`;
      comicsContainer.innerHTML = '';

      if (viewMode === 'dag') {
        comicsContainer.className = 'w-full h-full';
        comicsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-8 animate-pulse italic">Generating Continuity DAG...</p>';
        const dagData = await (appGlobal.ReadingLists?.fetchReadingListDAG ? appGlobal.ReadingLists.fetchReadingListDAG(listId, details) : null);
        renderReadingListDAG(comicsContainer, dagData, { listId, listName });
        return;
      }

      comicsContainer.className = viewMode === 'compact'
        ? 'space-y-2'
        : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4';

      for (let index = 0; index < details.items.length; index++) {
        const item = details.items[index];
        let comic = (typeof getComicById === 'function' ? getComicById(item.comicId) : null) ||
                    (typeof appGlobal.getComicById === 'function' ? appGlobal.getComicById(item.comicId) : null) ||
                    (typeof window !== 'undefined' && typeof window.getComicById === 'function' ? window.getComicById(item.comicId) : null) ||
                    (typeof state !== 'undefined' && typeof state.getComicById === 'function' ? state.getComicById(item.comicId) : null);
        if (!comic && typeof appGlobal.getOfflineComicRecordById === 'function') {
          try {
            const offlineRec = await appGlobal.getOfflineComicRecordById(item.comicId);
            if (offlineRec && offlineRec.comicInfo) {
              comic = offlineRec.comicInfo;
            }
          } catch (e) {}
        }
        if (!comic) continue;

        const comicDiv = createReadingListComicCard({
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
        });

        comicsContainer.appendChild(comicDiv);
      }
    } catch (error) {
      console.error('Failed to load reading list details:', error);
      document.getElementById('list-detail-comics-container').innerHTML = isOffline
        ? '<p class="text-sm text-gray-400 text-center py-8">Reading list details are not cached for offline viewing. Please open this list while online to cache it.</p>'
        : '<p class="text-sm text-red-400 text-center py-4">Failed to load comics.</p>';
    }
  }

  const downloadAllBtn = document.getElementById('download-all-list-btn');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      if (typeof appGlobal.downloadReadingList === 'function') {
        await appGlobal.downloadReadingList(listId, listName, downloadAllBtn);
      } else {
        console.error('downloadReadingList function not available');
        alert('Download functionality is not available. Please refresh the page.');
      }
    });
  }

  document.getElementById('export-list-btn').addEventListener('click', async () => {
    try {
      await appGlobal.ReadingLists.exportSingleList(listId, listName);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export list. Please try again.');
    }
  });

  document.getElementById('edit-list-btn').addEventListener('click', () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      alert('Reading list editing is not available while offline.');
      return;
    }
    isEditMode = true;
    updateViewModeControls();
    renderComics();
  });

  document.getElementById('save-order-btn').addEventListener('click', async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      alert('Reading list editing is not available while offline.');
      return;
    }
    try {
      const comicsContainer = document.getElementById('list-detail-comics-container');
      const comicDivs = comicsContainer.querySelectorAll('[data-comic-id]');
      const newOrder = Array.from(comicDivs).map(div => div.dataset.comicId);

      const result = await appGlobal.ReadingLists.reorderComics(listId, newOrder);
      if (result.ok) {
        exitEditMode();
        renderComics();
      } else {
        alert('Failed to save new order. Please try again.');
      }
    } catch (error) {
      console.error('Failed to save order:', error);
      alert('Failed to save new order. Please try again.');
    }
  });

  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    exitEditMode();
    renderComics();
  });

  await renderComics();
}
