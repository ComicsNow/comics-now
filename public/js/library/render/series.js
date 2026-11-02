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
  seriesListDiv,
  seriesTitleH2,
  seriesAlphaFilter,
  applyDisplayInfoToComic
} from '../../globals.js';

import {
  updateFilterButtonCounts,
  filterSeriesByActiveFilter,
  getComicStatusCounts,
  createEmptyStatusCounts,
  statusCountsMatchFilter,
  getSeriesStatus
} from '../status.js';

import { updateBreadcrumb, makeCountChips } from '../breadcrumb.js';
import * as Data from '../data.js';
import { renderAlphaFilter, applyFilterAndRender } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto } from '../smart-filters.js';
import { isOrderBySeriesDate, getSeriesPublishedInfo } from './series-sort.js';
import { showComicList } from './comics.js';
import { renderPublisherReadingLists } from './reading-lists.js';

export { renderPublisherReadingLists };

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

export function showSeriesList(publisherName, options = {}) {
  const force = Boolean(options.force);
  if (!publisherName) return;

  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing && !force) {
     let navPath = `/series-list?publisher=${encodeURIComponent(publisherName)}`;
     if (state.currentRootFolder) navPath += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  if (state.currentView !== 'series' || state.currentPublisher !== publisherName) {
    state.activeAlphaFilter = 'All';
  }
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('series', { publisher: publisherName, series: null });
  } else {
    state.currentView = 'series';
    state.currentPublisher = publisherName;
    state.currentSeries = null;
  }
  if (typeof window !== 'undefined') {
    window.currentView = 'series';
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  const normalizedPath = state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '') : '';
  const rootData = state.library?.[state.currentRootFolder] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
  const publisherData = rootData?.publishers?.[publisherName];
  if (!publisherData) {
    if (typeof state.showPublisherList === 'function') {
      state.showPublisherList(state.currentRootFolder, { force: true });
    } else if (typeof window !== 'undefined' && typeof window.showPublisherList === 'function') {
      window.showPublisherList(state.currentRootFolder, { force: true });
    }
    return;
  }

  const seriesData = publisherData.series || {};
  const filteredSeries = filterSeriesByActiveFilter(seriesData);
  const seriesNames = Object.keys(filteredSeries);

  if (seriesNames.length === 1 && !force) {
    state.currentSeries = seriesNames[0];
    if (typeof window !== 'undefined') window.currentSeries = state.currentSeries;
    showComicList(seriesNames[0]);
    return;
  }

  showView(seriesListDiv);
  mountSmartFilterHostInto(seriesListDiv);

  if (seriesTitleH2) {
    seriesTitleH2.textContent = publisherName;
  }

  const folderLabel = (typeof window !== 'undefined' && window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || state.currentRootFolder;
  updateBreadcrumb([
    { label: 'Libraries', action: () => (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true }) },
    { label: folderLabel, action: () => (state.showPublisherList || (typeof window !== 'undefined' && window.showPublisherList))?.(state.currentRootFolder, { force: true }) },
    { label: publisherName },
  ]);

  const sortContainer = document.getElementById('series-sort-container');
  if (state.activeSmartFilter === 'reading-list') {
    if (sortContainer) sortContainer.classList.add('hidden');
    renderPublisherReadingLists(publisherName);
    return;
  }
  if (sortContainer) sortContainer.classList.remove('hidden');
  renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderSeriesCards, 'series');

  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    });
  }
}

export function renderSeriesCards(seriesToRender) {
  const container = document.getElementById('series-list-container');
  if (!container) return;
  clear(container);
  container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';

  const sortOrder = state.seriesSortOrder || (typeof window !== 'undefined' && window.seriesSortOrder) || 'name';
  const orderByDate = isOrderBySeriesDate(sortOrder);
  const isDesc = sortOrder === 'date-desc';

  const publishedInfoMap = new Map();
  for (const sName of Object.keys(seriesToRender)) {
    publishedInfoMap.set(sName, getSeriesPublishedInfo(seriesToRender[sName]));
  }

  let sortedSeries;
  if (orderByDate) {
    sortedSeries = Object.keys(seriesToRender).sort((a, b) => {
      const infoA = publishedInfoMap.get(a);
      const infoB = publishedInfoMap.get(b);
      const keyA = infoA?.sortKey ?? null;
      const keyB = infoB?.sortKey ?? null;

      if (keyA !== null && keyB !== null) {
        if (keyA !== keyB) {
          return isDesc ? keyB - keyA : keyA - keyB;
        }
      } else if (keyA !== null) {
        return -1;
      } else if (keyB !== null) {
        return 1;
      }
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else {
    sortedSeries = Object.keys(seriesToRender).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  if (sortedSeries.length === 0) {
    const msg = state.activeFilter === 'in-progress'
      ? 'No series in progress.'
      : state.activeFilter === 'read'
        ? 'No series read.'
        : state.activeFilter === 'unread'
          ? 'No unread series.'
          : 'No series found.';
    renderContent(container, createEmptyMessage(msg));
    const backToLibrariesBtn = document.createElement('button');
    backToLibrariesBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
    backToLibrariesBtn.textContent = '← Libraries';
    backToLibrariesBtn.addEventListener('click', () => (state.showRootFolderList || (typeof window !== 'undefined' && window.showRootFolderList))?.({ force: true }));
    container.appendChild(backToLibrariesBtn);

    const backToPublisherBtn = document.createElement('button');
    backToPublisherBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backToPublisherBtn.textContent = '← Publisher';
    backToPublisherBtn.addEventListener('click', () => (state.showPublisherList || (typeof window !== 'undefined' && window.showPublisherList))?.(state.currentRootFolder));
    container.appendChild(backToPublisherBtn);
    return;
  }
  for (const seriesName of sortedSeries) {
    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';

    const comicsInSeries = seriesToRender[seriesName];

    let statusCounts;
    if (Array.isArray(comicsInSeries)) {
      comicsInSeries.sort((a, b) => {
        const aInfo = applyDisplayInfoToComic(a);
        const bInfo = applyDisplayInfoToComic(b);
        const aTitle = aInfo.displayTitle || a.name || '';
        const bTitle = bInfo.displayTitle || b.name || '';
        return aTitle.localeCompare(bTitle, undefined, { numeric: true });
      });
      statusCounts = getComicStatusCounts(comicsInSeries);
    } else if (comicsInSeries && comicsInSeries._counts) {
      statusCounts = comicsInSeries._counts;
    } else {
      statusCounts = createEmptyStatusCounts();
    }

    if (!statusCountsMatchFilter(statusCounts)) {
      continue;
    }

    const countsChips = makeCountChips(statusCounts);

    let imageHtml;
    let isSeriesRead = false;
    let isSeriesDownloaded = false;

    if (Array.isArray(comicsInSeries)) {
      const firstComicWithThumb = comicsInSeries.find(c => c.thumbnailPath);
      if (firstComicWithThumb) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${firstComicWithThumb.thumbnailPath}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image" loading="lazy">`;
      }

      isSeriesRead = comicsInSeries.every(comic => {
        const progress = comic.progress || {};
        const total = progress.totalPages || 0;
        const lastRead = progress.lastReadPage || 0;
        return total > 0 && lastRead >= total - 1;
      });

      isSeriesDownloaded = comicsInSeries.every(comic => state.downloadedComicIds?.has?.(comic.id));
    } else if (comicsInSeries && comicsInSeries._counts) {
      if (comicsInSeries._firstThumbnail) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${comicsInSeries._firstThumbnail}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image" loading="lazy">`;
      }

      isSeriesRead = statusCounts.total > 0 && statusCounts.read === statusCounts.total;
      isSeriesDownloaded = false;
    }

    if (!imageHtml) {
      imageHtml = `<div class="h-48 w-full bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
        <svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>
      </div>`;
    }

    const statusIcon = isSeriesRead ? ICONS.READ : ICONS.UNREAD;

    const statusButtonHtml = `
      <button
        class="status-toggle-btn absolute top-2 left-2 ${isSeriesRead ? 'text-green-400' : 'text-gray-400'} hover:text-white"
        data-series-name="${escapeHtml(seriesName)}"
        data-publisher="${escapeHtml(state.currentPublisher)}"
        data-root-folder="${escapeHtml(state.currentRootFolder)}"
        data-current-status="${isSeriesRead ? 'read' : 'unread'}"
        title="Toggle Read Status"
      >
        ${statusIcon}
      </button>`;

    const downloadIcon = isSeriesDownloaded ? ICONS.READ : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isSeriesDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isSeriesDownloaded ? 'Delete from device' : 'Download series'}"
          data-series-name="${escapeHtml(seriesName)}"
          data-publisher="${escapeHtml(state.currentPublisher)}"
          data-root-folder="${escapeHtml(state.currentRootFolder)}"
          data-is-downloaded="${isSeriesDownloaded}"
        >${downloadIcon}</button>`;

    let bannerHtml = getSeriesStatusBanner(comicsInSeries);

    let allComicsAreManga = false;
    if (Array.isArray(comicsInSeries) && comicsInSeries.length > 0) {
      allComicsAreManga = comicsInSeries.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    const pubInfo = publishedInfoMap.get(seriesName) || getSeriesPublishedInfo(comicsInSeries);
    const seriesYear = pubInfo?.year || null;
    const showYear = Boolean(orderByDate && seriesYear && !seriesName.endsWith(`(${seriesYear})`));

    const seriesTitleDisplay = showYear
      ? `${escapeHtml(seriesName)} <span class="series-year text-gray-400 font-normal text-sm">(${escapeHtml(seriesYear)})</span>`
      : escapeHtml(seriesName);

    const tooltipTitle = showYear
      ? `${seriesName} (${seriesYear})`
      : seriesName;

    renderContent(card, safeHtml`
      <div class="relative">
        ${safeRaw(bannerHtml)}
        ${safeRaw(mangaBannerHtml)}
        ${safeRaw(downloadButtonHtml)}
        ${safeRaw(statusButtonHtml)}
        ${safeRaw(imageHtml)}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2" title="${tooltipTitle}">${safeRaw(seriesTitleDisplay)}</h3>
      ${safeRaw(countsChips)}
    `);
    card.addEventListener('click', () => showComicList(seriesName));

    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        let comics = comicsInSeries;
        if (!Array.isArray(comics) && typeof Data?.getSeriesComics === 'function') {
          downloadBtn.disabled = true;
          comics = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, seriesName);
          downloadBtn.disabled = false;
        }

        if (isDownloaded) {
          if (confirm(`Delete these ${Array.isArray(comics) ? comics.length : 'selected'} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            if (Array.isArray(comics)) {
              for (const comic of comics) {
                if (typeof window !== 'undefined' && typeof window.deleteOfflineComic === 'function') {
                  await window.deleteOfflineComic(comic.id);
                }
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else if (typeof window !== 'undefined' && typeof window.downloadSeries === 'function') {
          window.downloadSeries(comics, downloadBtn);
        }
      });
    }

    const statusBtn = card.querySelector('.status-toggle-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (statusBtn.disabled) return;
        let comics = comicsInSeries;
        if (!Array.isArray(comics) && typeof Data?.getSeriesComics === 'function') {
          try {
            comics = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, seriesName);
          } catch (_) { comics = []; }
        }
        if (typeof window !== 'undefined' && typeof window.openBulkReadStatusDialog === 'function') {
          window.openBulkReadStatusDialog(comics || [], `series "${seriesName}"`);
        }
      });
    }

    let longPressTimer = null;
    let contextMenuShown = false;
    const seriesContextData = {
      seriesName,
      comicsInSeries,
      rootFolder: state.currentRootFolder,
      publisher: state.currentPublisher
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof window !== 'undefined' && typeof window.showSeriesContextMenu === 'function') {
        window.showSeriesContextMenu(e, seriesContextData);
      }
    });

    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.showSeriesContextMenu === 'function') {
          contextMenuShown = true;
          window.showSeriesContextMenu(e, seriesContextData);
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

    container.appendChild(card);
  }
}

export function getSeriesStatusBanner(comicsInSeries) {
  const status = getSeriesStatus(comicsInSeries);
  if (status === 'read') {
    return `<div class="status-banner status-read">Read</div>`;
  }
  if (status === 'in-progress') {
    return `<div class="status-banner status-in-progress">In Progress</div>`;
  }
  return '';
}

if (state) {
  state.renderSeriesCards = renderSeriesCards;
  state.showSeriesList = showSeriesList;
}
if (typeof window !== 'undefined') {
  window.renderSeriesCards = renderSeriesCards;
  window.showSeriesList = showSeriesList;
}
