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
  getRelativePath,
  publisherListDiv,
  publisherTitleH2,
  publisherAlphaFilter,
  publisherListContainer
} from '../../globals.js';

import {
  updateFilterButtonCounts,
  filterPublishersByActiveFilter,
  getPublisherStatusCounts,
  statusCountsMatchFilter
} from '../status.js';

import { updateBreadcrumb, makeCountChips } from '../breadcrumb.js';
import * as Data from '../data.js';
import { renderAlphaFilter, applyFilterAndRender } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto } from '../smart-filters.js';
import { showSeriesList, renderPublisherStoryArcs, renderPublisherReadingLists } from './series.js';

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

const API_BASE_URL = state.API_BASE_URL || (typeof window !== 'undefined' && window.API_BASE_URL) || '';

export function showPublisherList(rootFolder, options = {}) {
  const force = Boolean(options.force);
  
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     const navPath = `/library?rootFolder=${encodeURIComponent(rootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  const normalizedPath = rootFolder ? rootFolder.replace(/[\\\/]+$/, '') : '';
  const actualKey = state.library?.[rootFolder] ? rootFolder : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
  const rootData = actualKey ? state.library[actualKey] : null;

  if (!state.library || !rootData) {
    (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true });
    return;
  }

  if (state.currentView !== 'publishers') {
    state.activeAlphaFilter = 'All';
  }
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('publishers', { folder: actualKey, publisher: null, series: null });
  } else {
    state.currentView = 'publishers';
    state.currentRootFolder = actualKey;
    state.currentPublisher = null;
    state.currentSeries = null;
  }
  if (typeof window !== 'undefined') {
    window.currentView = 'publishers';
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  const publishers = rootData ? rootData.publishers : {};
  const publishersToRender = filterPublishersByActiveFilter(publishers);
  const publisherNames = Object.keys(publishersToRender);

  if (publisherNames.length === 1 && !force && state.activeSmartFilter !== 'story-arc' && state.activeSmartFilter !== 'reading-list') {
    state.currentPublisher = publisherNames[0];
    if (typeof window !== 'undefined') window.currentPublisher = state.currentPublisher;
    showSeriesList(publisherNames[0]);
    return;
  }

  showView(publisherListDiv);
  mountSmartFilterHostInto(publisherListDiv);

  const folderLabel = (typeof window !== 'undefined' && window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || state.currentRootFolder;
  if (publisherTitleH2) {
    publisherTitleH2.textContent = folderLabel;
  }

  updateBreadcrumb([
    { label: 'Libraries', action: () => (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true }) },
    { label: folderLabel }
  ]);

  const existingStoryArcFilter = document.getElementById('story-arcs-status-filter');
  if (existingStoryArcFilter && state.activeSmartFilter !== 'story-arc') existingStoryArcFilter.remove();
  const existingReadingListFilter = document.getElementById('reading-lists-status-filter');
  if (existingReadingListFilter && state.activeSmartFilter !== 'reading-list') existingReadingListFilter.remove();

  if (state.activeSmartFilter === 'reading-list') {
    if (publisherAlphaFilter) clear(publisherAlphaFilter);
    renderPublisherReadingLists(null, publisherListContainer);
    return;
  }

  if (state.activeSmartFilter === 'story-arc') {
    if (publisherAlphaFilter) clear(publisherAlphaFilter);
    renderPublisherStoryArcs(null, publisherListContainer);
    return;
  }

  if (publisherListContainer) {
    publisherListContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
  }
  renderAlphaFilter(publisherAlphaFilter, publishersToRender, renderPublisherCards, 'publishers');
}

export function renderPublisherCards(publishersToShow) {
  if (publisherListContainer) {
    publisherListContainer.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
  }
  clear(publisherListContainer);
  const publishers = Object.keys(publishersToShow).sort();
  if (publishers.length === 0) {
    const msg = state.activeSmartFilter === 'story-arc'
      ? 'No publishers with story arcs found.'
      : state.activeSmartFilter === 'reading-list'
        ? 'No publishers with reading lists found.'
        : state.activeFilter === 'in-progress'
          ? 'No publishers in progress.'
          : state.activeFilter === 'read'
            ? 'No publishers read.'
            : state.activeFilter === 'unread'
              ? 'No unread publishers.'
              : 'No publishers found.';
    renderContent(publisherListContainer, createEmptyMessage(msg));
    const backBtn = document.createElement('button');
    backBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backBtn.textContent = '← Libraries';
    backBtn.addEventListener('click', () => (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true }));
    publisherListContainer.appendChild(backBtn);
    return;
  }
  for (const publisher of publishers) {
    const publisherData = publishersToShow[publisher] || {};
    const counts = getPublisherStatusCounts(publisherData);
    if (!statusCountsMatchFilter(counts)) {
      continue;
    }

    const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' && window.LibrarySmartLists) || {};
    const getReadingLists = state.getReadingListsForPublisher || (typeof window !== 'undefined' && window.getReadingListsForPublisher) || SmartLists.getReadingListsForPublisher;
    const pubReadingLists = typeof getReadingLists === 'function' ? getReadingLists(publisher) : [];
    const readingListCount = pubReadingLists.length;

    const getStoryArcs = state.getStoryArcsForPublisher || (typeof window !== 'undefined' && window.getStoryArcsForPublisher) || SmartLists.getStoryArcsForPublisher;
    const pubStoryArcs = typeof getStoryArcs === 'function' ? getStoryArcs(publisher) : [];
    const storyArcCount = pubStoryArcs.length;

    let countsChips = makeCountChips(counts);
    let extraChips = '';
    if (readingListCount > 0) {
      extraChips += `<span class="card-count-chip reading-list" title="${readingListCount} Reading List${readingListCount === 1 ? '' : 's'}">📚 ${readingListCount}</span>`;
    }
    if (storyArcCount > 0) {
      extraChips += `<span class="card-count-chip story-arc text-amber-400 border border-amber-500/30" title="${storyArcCount} Story Arc${storyArcCount === 1 ? '' : 's'}">⚡ ${storyArcCount}</span>`;
    }
    if (extraChips) {
      if (countsChips.endsWith('</div>')) {
        countsChips = countsChips.slice(0, -6) + extraChips + '</div>';
      } else {
        countsChips = `<div class="card-counts">${extraChips}</div>`;
      }
    }

    let allComics = [];
    if (publisherData.series) {
      for (const seriesName in publisherData.series) {
        const comics = publisherData.series[seriesName];
        if (Array.isArray(comics)) {
          allComics = allComics.concat(comics);
        }
      }
    }

    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    let publisherStatusBannerHtml = '';
    if (counts && counts.total > 0 && counts.read === counts.total) {
      publisherStatusBannerHtml = `<div class="status-banner status-read">Read</div>`;
    }
    const isPublisherRead = counts && counts.total > 0 && counts.read === counts.total;
    const publisherStatusIcon = isPublisherRead
      ? ICONS.READ
      : ICONS.UNREAD;
    const publisherStatusButtonHtml = `
      <button class="status-toggle-btn absolute top-2 left-2 ${isPublisherRead ? 'text-green-400' : 'text-gray-400'} hover:text-white"
              data-publisher-name="${escapeHtml(publisher)}"
              data-root-folder="${escapeHtml(state.currentRootFolder)}"
              title="Bulk Read/Unread">
        ${publisherStatusIcon}
      </button>`;

    let isPublisherDownloaded = false;
    if (allComics.length > 0) {
      isPublisherDownloaded = allComics.every(comic => state.downloadedComicIds?.has?.(comic.id));
    }

    const downloadIcon = isPublisherDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isPublisherDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isPublisherDownloaded ? 'Delete from device' : 'Download publisher'}"
          data-publisher-name="${escapeHtml(publisher)}"
          data-root-folder="${escapeHtml(state.currentRootFolder)}"
          data-is-downloaded="${isPublisherDownloaded}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    const hasLogo = Boolean(publisherData.logoUrl);
    const needsLightBackground = Boolean(publisherData.logoNeedsBackground);
    const needsDarkBackground = Boolean(publisherData.logoNeedsDarkBackground);
    const logoWrapperClasses = ['flex', 'items-center', 'justify-center', 'h-full', 'w-full'];
    if (needsLightBackground) {
      logoWrapperClasses.push('bg-white/95', 'rounded-lg', 'p-4', 'shadow-inner');
    } else if (needsDarkBackground) {
      logoWrapperClasses.push('bg-gray-900', 'rounded-lg', 'p-4', 'shadow-inner');
    }
    const logoContent = hasLogo
      ? `<div class="${logoWrapperClasses.join(' ')}"><img src="${API_BASE_URL}/${publisherData.logoUrl}" alt="${escapeHtml(publisher)}" class="h-full w-full object-contain" loading="lazy"></div>`
      : `<svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>`;
    const panelBgClass = needsDarkBackground ? 'panel-dark bg-gray-900' : 'bg-gray-700';
    renderContent(card, safeHtml`
      <div class="relative h-48 w-full ${panelBgClass} rounded-lg flex items-center justify-center text-gray-400">
        ${safeRaw(publisherStatusBannerHtml)}
        ${safeRaw(mangaBannerHtml)}
        ${safeRaw(downloadButtonHtml)}
        ${safeRaw(publisherStatusButtonHtml)}
        ${safeRaw(logoContent)}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${publisher}</h3>
      ${safeRaw(countsChips)}
    `);
    card.addEventListener('click', () => showSeriesList(publisher));

    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete these ${allComics.length} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            for (const comic of allComics) {
              if (typeof window !== 'undefined' && typeof window.deleteOfflineComic === 'function') {
                await window.deleteOfflineComic(comic.id);
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else if (typeof window !== 'undefined' && typeof window.downloadSeries === 'function') {
          window.downloadSeries(allComics, downloadBtn);
        }
      });
    }

    const pubStatusBtn = card.querySelector('.status-toggle-btn');
    if (pubStatusBtn) {
      pubStatusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let comics = [];
        if (publisherData.series && typeof Data?.getSeriesComics === 'function') {
          for (const seriesName of Object.keys(publisherData.series)) {
            try {
              const sComics = await Data.getSeriesComics(state.currentRootFolder, publisher, seriesName);
              if (Array.isArray(sComics)) comics.push(...sComics);
            } catch (_) {}
          }
        } else {
          comics = allComics;
        }
        if (typeof window !== 'undefined' && typeof window.openBulkReadStatusDialog === 'function') {
          window.openBulkReadStatusDialog(comics || [], `publisher "${publisher}"`);
        }
      });
    }

    let longPressTimer = null;
    let contextMenuShown = false;
    const publisherContextData = {
      publisherName: publisher,
      publisherInfo: publisherData,
      rootFolder: state.currentRootFolder
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof window !== 'undefined' && typeof window.showPublisherContextMenu === 'function') {
        window.showPublisherContextMenu(e, publisherContextData);
      }
    });

    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.showPublisherContextMenu === 'function') {
          contextMenuShown = true;
          window.showPublisherContextMenu(e, publisherContextData);
        }
      }, 500);
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
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

    publisherListContainer.appendChild(card);
  }
}
