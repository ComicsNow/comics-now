import {
  escapeHtml,
  ICONS
} from '../globals.js';
import { isAppOnline } from '../offline/status.js';
import { appGlobal } from './bootstrap.js';
import { closeReadingListModal, deleteReadingList } from './reading-list-actions.js';
import { showReadingListDetail } from './reading-list-detail.js';

let isListEditMode = false;

export function getIsListEditMode() {
  return isListEditMode;
}

export function setIsListEditMode(val) {
  isListEditMode = Boolean(val);
}

/**
 * Refresh the reading list modal display
 */
export async function refreshReadingListModal() {
  const listsContainer = document.getElementById('reading-lists-container');
  if (!listsContainer) return;

  const isOffline = typeof isAppOnline === 'function' ? !isAppOnline() : (typeof navigator !== 'undefined' && navigator && navigator.onLine === false);
  if (isOffline) {
    isListEditMode = false;
  }

  // Handle Edit Mode buttons visibility
  const editBtn = document.getElementById('edit-reading-lists-btn');
  const saveBtn = document.getElementById('save-reading-lists-order-btn');
  const cancelBtn = document.getElementById('cancel-reading-lists-edit-btn');
  const buttonsSection = document.querySelector('#reading-list-modal .mb-6.space-y-2');
  const createBtn = document.getElementById('create-reading-list-btn');
  const importBtn = document.getElementById('import-lists-btn');
  const offlineBadge = document.getElementById('reading-list-offline-badge');

  if (offlineBadge) offlineBadge.classList.toggle('hidden', !isOffline);
  if (editBtn) editBtn.classList.toggle('hidden', isListEditMode || isOffline);
  if (saveBtn) {
    saveBtn.classList.toggle('hidden', !isListEditMode);
    saveBtn.hidden = !isListEditMode;
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !isListEditMode);
    cancelBtn.hidden = !isListEditMode;
  }
  if (createBtn) createBtn.classList.toggle('hidden', isOffline);
  if (importBtn) importBtn.classList.toggle('hidden', isOffline);
  if (buttonsSection) buttonsSection.classList.toggle('hidden', isListEditMode);

  // Show loading state
  listsContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Loading...</p>';

  // Fetch lists from API
  if (typeof appGlobal.ReadingLists !== 'undefined' && typeof appGlobal.ReadingLists.fetchReadingLists === 'function') {
    const lists = await appGlobal.ReadingLists.fetchReadingLists();

    // Populate publisher dropdown
    const pubSelect = document.getElementById('reading-list-publisher-filter');
    if (pubSelect) {
      const allPubs = new Set();
      lists.forEach(l => (l.publishers || []).forEach(p => { if (p) allPubs.add(p); }));
      const currentPub = pubSelect.value;
      pubSelect.innerHTML = '<option value="">All publishers</option>';
      Array.from(allPubs).sort().forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        if (p === currentPub) opt.selected = true;
        pubSelect.appendChild(opt);
      });
    }

    // Wire search/filter inputs once
    const searchEl = document.getElementById('reading-list-search');
    if (searchEl && !searchEl.dataset.rlFilterBound) {
      searchEl.dataset.rlFilterBound = '1';
      const rerender = () => renderFilteredLists(lists, listsContainer);
      searchEl.addEventListener('input', rerender);
      if (pubSelect) pubSelect.addEventListener('change', rerender);
    }

    function renderFilteredLists(allLists, container) {
      const term = (document.getElementById('reading-list-search')?.value || '').trim().toLowerCase();
      const pub  = (document.getElementById('reading-list-publisher-filter')?.value || '').trim();
      const filtered = allLists.filter(l => {
        if (!l) return false;
        if (term && !(l.name || '').toLowerCase().includes(term)) return false;
        if (pub && !(l.publishers || []).includes(pub)) return false;
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = term || pub
          ? '<p class="text-sm text-gray-400 text-center py-4">No lists match your filter.</p>'
          : (isOffline
              ? '<p class="text-sm text-gray-400 text-center py-4">No cached reading lists available offline.</p>'
              : '<p class="text-sm text-gray-400 text-center py-4">No reading lists yet. Create one to get started!</p>');
        return;
      }

      container.innerHTML = '';
      filtered.forEach((list) => {
        const listDiv = document.createElement('div');
        listDiv.className = 'bg-gray-800/50 p-5 rounded-xl border border-gray-700/50 hover:border-purple-500/50 transition-all group cursor-pointer relative flex flex-col gap-3';
        listDiv.dataset.listId = list.id;
        
        if (isListEditMode) {
          listDiv.classList.add('is-editing');
        }

        const itemCount = list.totalComics || 0;
        const readCount = list.readComics || 0;
        const createdDate = list.created ? new Date(list.created).toLocaleDateString() : '';
        const progressPercent = list.progressPercent || 0;
        const baseUrl = (typeof appGlobal !== 'undefined' && appGlobal.API_BASE_URL) ? appGlobal.API_BASE_URL : '';
        const thumbUrl = list.thumbnailPath
          ? `${baseUrl}/thumbnails/${encodeURIComponent(list.thumbnailPath)}`
          : null;

        const allRead = readCount === itemCount && itemCount > 0;
        const hasProgress = readCount > 0;

        listDiv.innerHTML = `
          <div class="flex justify-between items-start gap-2">
            <div class="flex items-start gap-3.5 flex-1 min-w-0">
              ${isListEditMode ? `
                <div class="flex flex-col gap-1 self-center">
                  <button class="reorder-up-btn text-gray-500 hover:text-white p-0.5" title="Move Up">▲</button>
                  <button class="reorder-down-btn text-gray-500 hover:text-white p-0.5" title="Move Down">▼</button>
                </div>
              ` : ''}

              <div class="relative w-14 h-20 sm:w-16 sm:h-22 shrink-0 rounded-lg overflow-hidden bg-gray-950 border border-gray-700/60 shadow group-hover:border-purple-500/50 transition-all">
                ${thumbUrl ? `
                  <img src="${thumbUrl}" alt="${escapeHtml(list.name)}" class="w-full h-full object-cover object-top opacity-85 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" loading="lazy">
                  <div class="absolute inset-0 bg-gradient-to-t from-gray-950/70 via-transparent to-transparent"></div>
                ` : `
                  <div class="w-full h-full flex items-center justify-center text-xl bg-purple-950/40 text-purple-400">📚</div>
                `}
              </div>

              <div class="flex-1 min-w-0 self-center">
                <div class="flex items-center gap-2 mb-1">
                  <h5 class="font-bold text-base sm:text-lg text-white truncate group-hover:text-purple-300 transition-colors">${escapeHtml(list.name)}</h5>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">
                  <span>Created ${escapeHtml(createdDate)}</span>
                  <span class="w-1 h-1 rounded-full bg-gray-600"></span>
                  <span class="${allRead ? 'text-green-500' : hasProgress ? 'text-purple-400' : 'text-gray-400'}">${readCount} / ${itemCount} Read</span>
                  ${list.seriesCount ? `
                    <span class="w-1 h-1 rounded-full bg-gray-600"></span>
                    <span class="text-purple-300/80">${list.seriesCount} ${list.seriesCount === 1 ? 'series' : 'series'}</span>
                  ` : ''}
                </div>
                ${list.description ? `<p class="text-xs text-gray-400 line-clamp-1 mt-0.5">${escapeHtml(list.description)}</p>` : ''}
              </div>
            </div>
            <button class="text-gray-600 hover:text-red-400 transition-colors p-1 delete-list-btn ${!isListEditMode || isOffline ? 'hidden' : ''}" data-list-id="${escapeHtml(list.id)}" title="Delete List" ${!isListEditMode || isOffline ? 'hidden' : ''}>
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <div class="space-y-1.5">
            <div class="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
              <span class="text-gray-500">Progress</span>
              <span class="${allRead ? 'text-green-500' : 'text-purple-400'}">${progressPercent}%</span>
            </div>
            <div class="relative h-2 bg-gray-900/50 rounded-full overflow-hidden border border-white/5">
              <div class="absolute top-0 left-0 h-full ${allRead ? 'bg-green-500' : 'bg-purple-600'} transition-all duration-500 ease-out shadow-[0_0_10px_rgba(147,51,234,0.3)]" style="width: ${progressPercent}%;"></div>
            </div>
          </div>

          <div class="flex gap-1 sm:gap-1.5 items-stretch mt-2 w-full max-w-full ${isListEditMode ? 'opacity-50 pointer-events-none' : ''}">
            ${isOffline ? '' : `
              <button class="flex-1 min-w-0 h-[38px] flex items-center justify-center gap-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold px-1 rounded-lg transition-colors read-toggle-btn"
                      data-list-id="${escapeHtml(list.id)}"
                      data-current-status="${allRead}"
                      title="${allRead ? 'Mark as unread' : 'Mark as read'}">
                <span class="opacity-70 inline-flex items-center justify-center w-3.5 h-3.5 shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0">${allRead ? '↩' : ICONS.READ}</span>
                <span>${allRead ? 'Unread' : 'Read'}</span>
              </button>
            `}

            <button class="flex-1 min-w-0 h-[38px] flex items-center justify-center gap-1 bg-gray-700 hover:bg-purple-900/60 hover:text-purple-300 text-white text-xs font-bold px-1 rounded-lg transition-colors dag-list-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    data-list-name="${escapeHtml(list.name)}"
                    title="View Continuity DAG">
              <span class="inline-flex items-center justify-center w-3.5 h-3.5 shrink-0 text-xs leading-none">🔀</span>
              <span>DAG</span>
            </button>

            <button class="flex-1 min-w-0 h-[38px] flex items-center justify-center gap-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold px-1 rounded-lg transition-colors download-list-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    data-list-name="${escapeHtml(list.name)}"
                    title="Download all comics in this list">
              <span class="opacity-70 inline-flex items-center justify-center w-3.5 h-3.5 shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:shrink-0">${ICONS.DOWNLOAD}</span>
              <span>Save</span>
            </button>

            <button class="flex-1 min-w-0 h-[38px] flex items-center justify-center gap-1 ${allRead ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white text-xs font-bold px-1 rounded-lg transition-all shadow-lg play-list-btn"
                    data-list-id="${escapeHtml(list.id)}"
                    title="${allRead ? 'Restart' : hasProgress ? 'Continue' : 'Play'}">
              <span class="inline-flex items-center justify-center w-3.5 h-3.5 shrink-0 text-xs leading-none">${allRead ? '🔄' : '▶'}</span>
              <span>${allRead ? 'Restart' : hasProgress ? 'Resume' : 'Start'}</span>
            </button>
          </div>
        `;

        listDiv.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          if (isListEditMode) return;
          showReadingListDetail(list.id, list.name);
        });

        if (isListEditMode) {
          const upBtn = listDiv.querySelector('.reorder-up-btn');
          const downBtn = listDiv.querySelector('.reorder-down-btn');

          if (upBtn) {
            upBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const prev = listDiv.previousElementSibling;
              if (prev) listsContainer.insertBefore(listDiv, prev);
            });
          }

          if (downBtn) {
            downBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const next = listDiv.nextElementSibling;
              if (next) listsContainer.insertBefore(next, listDiv);
            });
          }
        }

        const deleteBtn = listDiv.querySelector('.delete-list-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete "${list.name}"?`)) {
              await deleteReadingList(list.id);
            }
          });
        }

        const readToggleBtn = listDiv.querySelector('.read-toggle-btn');
        if (readToggleBtn) {
          readToggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isCurrentlyRead = readToggleBtn.dataset.currentStatus === 'true';
            try {
              await appGlobal.ReadingLists.markListAsRead(list.id, !isCurrentlyRead);
              await refreshReadingListModal();
            } catch (error) {
              alert('Failed to update reading status. Please try again.');
            }
          });
        }

        const dagBtn = listDiv.querySelector('.dag-list-btn');
        if (dagBtn) {
          dagBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showReadingListDetail(list.id, list.name, 'dag');
          });
        }

        const downloadBtn = listDiv.querySelector('.download-list-btn');
        if (downloadBtn) {
          downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const listId = downloadBtn.dataset.listId;
            const listName = downloadBtn.dataset.listName || 'Unknown List';

            if (typeof appGlobal.downloadReadingList === 'function') {
              await appGlobal.downloadReadingList(listId, listName, downloadBtn);
            } else {
              console.error('downloadReadingList function not available');
              alert('Download functionality is not available. Please refresh the page.');
            }
          });
        }

        const playBtn = listDiv.querySelector('.play-list-btn');
        if (playBtn) {
          playBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (!offline && (!appGlobal.library || Object.keys(appGlobal.library).length === 0)) {
              alert('Library is still loading. Check the status badge at the top - it will show "Ready" when comics are available. Try again in a moment.');
              return;
            }

            try {
              const details = await appGlobal.ReadingLists.getReadingListDetails(list.id);
              if (!details || !details.items || details.items.length === 0) {
                alert('No comics in this reading list.');
                return;
              }

              let firstComic = details.items.find(item => {
                const total = item.totalPages || 0;
                const last = item.lastReadPage || 0;
                return total === 0 || last < total - 1;
              });

              if (!firstComic && details.items.length > 0) {
                firstComic = details.items[0];
              }

              if (firstComic) {
                let comic = typeof appGlobal.getComicById === 'function' ? appGlobal.getComicById(firstComic.comicId) : null;
                if (!comic && typeof appGlobal.getOfflineComicRecordById === 'function') {
                  try {
                    const offlineRec = await appGlobal.getOfflineComicRecordById(firstComic.comicId);
                    if (offlineRec && offlineRec.comicInfo) comic = offlineRec.comicInfo;
                  } catch (recErr) {}
                }

                if (comic && typeof appGlobal.openComicViewer === 'function') {
                  appGlobal.openComicViewer(comic, { readingListId: list.id, readingListName: list.name });
                  closeReadingListModal();
                } else {
                  alert('Could not find comic in library. The comic may have been moved or deleted, or needs to be downloaded for offline reading.');
                }
              }
            } catch (error) {
              console.error('Failed to play reading list:', error);
              alert('Failed to open comic. Please try again.');
            }
          });
        }

        container.appendChild(listDiv);
      });
    }

    renderFilteredLists(lists, listsContainer);
  }
}
