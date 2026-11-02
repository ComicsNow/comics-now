import {
  state,
  actions,
  clearElement,
  render,
  html,
  raw,
  ICONS,
  escapeHtml,
  showView,
  createEmptyMessage,
  createLoadingMessage,
  getRelativePath,
  comicListDiv,
  comicAlphaFilter,
  comicListTitleH2,
  smartListContainer,
  applyDisplayInfoToComic
} from '../../globals.js';

import { getComicStatus, updateFilterButtonCounts } from '../status.js';
import { updateBreadcrumb } from '../breadcrumb.js';
import * as Data from '../data.js';
import * as SmartLists from '../smartlists.js';
import { renderAlphaFilter, applyFilterAndRender } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto } from '../smart-filters.js';
import { toggleReadStatus } from '../../progress.js';

const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : (typeof globalThis !== 'undefined' ? globalThis.__COMICS_STORE__?.actions : null);
const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};

const safeHtml = (typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__isRawHtml) out += v.html;
      else if (v && typeof v === 'object' && typeof v.toHTML === 'function') out += v.toHTML();
      else out += (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

const safeRaw = (typeof raw === 'function' && raw.length > 0) ? raw : (v) => ({
  __isRawHtml: true,
  html: String(v ?? '')
});
const API_BASE_URL = state.API_BASE_URL || window.API_BASE_URL || '';

export async function showComicList(seriesName) {
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     let navPath = `/series/${encodeURIComponent(seriesName)}`;
     if (state.currentPublisher) navPath += `?publisher=${encodeURIComponent(state.currentPublisher)}`;
     if (state.currentRootFolder) navPath += (state.currentPublisher ? '&' : '?') + `rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  if (state.currentView !== 'comics' || state.currentSeries !== seriesName) {
    state.activeAlphaFilter = 'All';
  }
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('comics', { series: seriesName });
  } else {
    state.currentView = 'comics';
    state.currentSeries = seriesName;
  }
  if (typeof window !== 'undefined') {
    window.currentView = state.currentView;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  showView(comicListDiv);
  mountSmartFilterHostInto(comicListDiv);

  if (comicListTitleH2) {
    comicListTitleH2.textContent = seriesName;
  }

  const libLabelComic = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || (state.currentRootFolder && window.LIBRARY_NAMES[state.currentRootFolder.replace(/[\\\/]+$/, '')]))) || (state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() : '') || state.currentRootFolder || '';
  updateBreadcrumb([
    { label: 'Libraries', action: () => (state.showRootFolderList || window.showRootFolderList)?.({ force: true }) },
    ...(libLabelComic ? [{ label: libLabelComic, action: () => (state.showPublisherList || window.showPublisherList)?.(state.currentRootFolder, { force: true }) }] : []),
    { label: state.currentPublisher, action: () => (state.showSeriesList || window.showSeriesList)?.(state.currentPublisher, { force: true }) },
    { label: seriesName },
  ]);

  // Show loading message while fetching comics
  const container = document.getElementById('comic-list-container');
  if (container) {
    renderContent(container, createLoadingMessage('Loading comics...'));
  }

  const targetSeries = seriesName;

  try {
    // Use lazy loading to get series comics
    const comicsData = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, targetSeries);

    if (state.currentSeries !== targetSeries || state.currentView !== 'comics') {
      return;
    }

    const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
    const scoped = state.activeSmartFilter ? comicsData.filter(matchesScope) : comicsData;

    let comicsToRender = scoped;
    const isInbox = state.currentRootFolder === 'Smart Inbox';
    if (isInbox) {
      if (state.activeFilter === 'unread') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'successful');
      } else if (state.activeFilter === 'in-progress') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'failed');
      } else if (state.activeFilter === 'read') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'pending');
      }
    } else {
      if (state.activeFilter === 'in-progress') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'in-progress');
      } else if (state.activeFilter === 'read') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'read');
      } else if (state.activeFilter === 'unread') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'unread');
      }
    }

    renderAlphaFilter(comicAlphaFilter, comicsToRender, renderComicCards, 'comics');

  } catch (error) {
    if (container) {
      renderContent(container, safeHtml`<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading comics. Please try again.</div>`);
    }
  }
}

export function renderComicCards(comicsToRender, viewType, targetContainer) {
  let container;
  if (targetContainer) {
    container = targetContainer;
  } else if (viewType === 'search') {
    container = document.getElementById('search-results-container');
  } else if (viewType === 'smart-list') {
    container = smartListContainer || document.getElementById('smart-list-container');
  } else {
    container = document.getElementById('comic-list-container');
  }

  if (!container) return;

  clear(container);
  if (comicsToRender.length === 0) {
    let msg;
    if (!viewType && state.activeFilter === 'in-progress') {
      msg = 'No comics in progress.';
    } else if (!viewType && state.activeFilter === 'read') {
      msg = 'No comics read.';
    } else if (!viewType && state.activeFilter === 'unread') {
      msg = 'No unread comics.';
    } else {
      msg = 'No comics found.';
    }
    renderContent(container, createEmptyMessage(msg));
    if (!viewType) {
      const backToLibrariesBtn = document.createElement('button');
      backToLibrariesBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
      backToLibrariesBtn.textContent = '← Libraries';
      backToLibrariesBtn.addEventListener('click', () => (state.showRootFolderList || window.showRootFolderList)?.({ force: true }));
      container.appendChild(backToLibrariesBtn);

      const backToPublisherBtn = document.createElement('button');
      backToPublisherBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
      backToPublisherBtn.textContent = '← Publisher';
      backToPublisherBtn.addEventListener('click', () => (state.showPublisherList || window.showPublisherList)?.(state.currentRootFolder));
      container.appendChild(backToPublisherBtn);

      const backToSeriesBtn = document.createElement('button');
      backToSeriesBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
      backToSeriesBtn.textContent = '← Series';
      backToSeriesBtn.addEventListener('click', () => (state.showSeriesList || window.showSeriesList)?.(state.currentPublisher, { force: true }));
      container.appendChild(backToSeriesBtn);
    }
    return;
  }
  comicsToRender.forEach((comic, index) => {
    const card = document.createElement('div');
    card.className = 'comic-card bg-gray-800 rounded-lg shadow-lg cursor-pointer flex flex-col border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    
    const progress = comic.progress || {};
    const trackedTotalPages = Math.max(0, Number(progress.totalPages) || 0);
    const lastRead = Math.max(0, Number(progress.lastReadPage) || 0);

    const displayInfo = applyDisplayInfoToComic(comic);
    const displayTitle = displayInfo.displayTitle;
    const subtitleText = displayInfo.subtitle;

    const derivedTotalPages = (() => {
      if (trackedTotalPages > 0) return trackedTotalPages;
      const directTotal = Number(comic.totalPages);
      if (!Number.isNaN(directTotal) && directTotal > 0) return directTotal;
      const pageCount = Number(comic.pageCount);
      if (!Number.isNaN(pageCount) && pageCount > 0) return pageCount;
      return 0;
    })();

    const pageCountLabel = derivedTotalPages > 0 ? `p.${derivedTotalPages}` : '';
    const altText = displayInfo.altText;

    const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));

    let bannerHtml = '';
    let isRead = false;

    if (trackedTotalPages > 0) {
      isRead = lastRead >= trackedTotalPages - 1;
      const isInProgress = lastRead > 0 && !isRead;
      if (!isLocal) {
        if (isRead) {
          bannerHtml = `<div class="status-banner status-read">Read</div>`;
        } else if (isInProgress) {
          bannerHtml = `<div class="status-banner status-in-progress">In Progress</div>`;
        }
      }
    }

    // Add manga mode banner
    const mangaBannerHtml = (comic.mangaMode && !isLocal) ? `<div class="status-banner status-manga">Manga</div>` : '';

    const progressPercent = trackedTotalPages > 0 ? (lastRead / trackedTotalPages) * 100 : 0;

    const isInbox = state.currentRootFolder === 'Smart Inbox';
    const isComicDownloaded = state.downloadedComicIds?.has?.(comic.id) || false;
    const downloadIcon = isComicDownloaded ? ICONS.READ : ICONS.DOWNLOAD;
    
    // Don't show download button for local/device or inbox comics
    const downloadButtonHtml = (isLocal || isInbox) ? '' : `<button class="download-btn absolute top-2 right-2 ${isComicDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}" 
          data-comic-id="${comic.id}" 
          data-is-downloaded="${isComicDownloaded}"
          title="${isComicDownloaded ? 'Delete from device' : 'Download comic'}">
        ${downloadIcon}
      </button>`;

    // Add the read/unread toggle button HTML
    const toggleStatusIcon = isRead
      ? ICONS.READ
      : ICONS.UNREAD;

    const toggleStatusButtonHtml = (isLocal || isInbox) ? '' : `
      <button class="status-toggle-btn absolute top-2 left-2 ${isRead ? 'text-green-400' : 'text-gray-400'} hover:text-white" title="Toggle Read Status" data-comic-id="${comic.id}" data-current-status="${isRead ? 'read' : 'unread'}">
        ${toggleStatusIcon}
      </button>
    `;

    const titleIconHtml = '';

    let coverHtml = '';
    if (comic.thumbnailPath) {
      coverHtml = `<img src="${API_BASE_URL}/thumbnails/${comic.thumbnailPath}" alt="${escapeHtml(altText)}" class="comic-cover-image" loading="lazy">`;
    } else if (isLocal) {
      coverHtml = `
        <div class="comic-cover-image flex items-center justify-center bg-gray-900 text-purple-500">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
      `;
    } else {
      coverHtml = `<img src="https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover" alt="${escapeHtml(altText)}" class="comic-cover-image" loading="lazy">`;
    }

    renderContent(card, safeHtml`
      <div class="relative">
        ${safeRaw(bannerHtml)}
        ${safeRaw(mangaBannerHtml)}
        ${safeRaw(downloadButtonHtml)}
        ${safeRaw(toggleStatusButtonHtml)}
        ${safeRaw(coverHtml)}
        ${safeRaw(pageCountLabel ? `<div class="page-count-badge">${pageCountLabel}</div>` : '')}
      </div>
      <div class="p-2 grow flex flex-col justify-between">
        <div>
          <p class="text-sm font-semibold text-white truncate">${safeRaw(titleIconHtml)}${displayTitle}</p>
          ${safeRaw(subtitleText ? `<p class="text-xs text-gray-300 truncate">${escapeHtml(subtitleText)}</p>` : '')}
        </div>
      </div>
      <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-700 rounded-b-lg">${safeRaw(progressPercent > 0 ? `<div class="${isRead ? 'bg-green-500' : 'bg-purple-500'} h-full rounded-b-lg transition-all duration-300" style="width: ${progressPercent}%;"></div>` : '')}</div>
    `);

    // Store comic data on the card element for context menu access
    card._comicData = comic;

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;

    if (!isInbox) {
      card.addEventListener('contextmenu', (e) => {
        if (typeof window.showComicContextMenu === 'function') {
          window.showComicContextMenu(e, comic);
        }
      });

      // Long-press for mobile
      card.addEventListener('touchstart', (e) => {
        contextMenuShown = false;
        longPressTimer = setTimeout(() => {
          if (typeof window.showComicContextMenu === 'function') {
            contextMenuShown = true;
            window.showComicContextMenu(e, comic);
          }
        }, 500); // 500ms long press
      });

      card.addEventListener('touchend', (e) => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        // Prevent click if context menu was just shown
        if (contextMenuShown) {
          e.preventDefault();
          e.stopPropagation();
          contextMenuShown = false;
        }
      });

      card.addEventListener('touchmove', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
    }

    card.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof Element) {
        const interactiveButton = target.closest('button.download-btn, button.status-toggle-btn');
        if (interactiveButton) {
          return;
        }
      }

      if (target.closest(".download-btn") || target.closest(".status-toggle-btn")) return;
      if (typeof window.openComicViewer === "function") window.openComicViewer(comic);
    });
    card.classList.add('cursor-pointer');
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete "${displayTitle}" from your device?`)) {
            downloadBtn.disabled = true;
            if (typeof window.deleteOfflineComic === 'function') {
              await window.deleteOfflineComic(comic.id);
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries?.([comic], downloadBtn);
        }
      });
    }
    // Attach handler for read/unread toggle button on individual comic
    const statusBtn = card.querySelector('.status-toggle-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!statusBtn.disabled) {
          toggleReadStatus(statusBtn);
        }
      });
    }
    container.appendChild(card);
  });
}
