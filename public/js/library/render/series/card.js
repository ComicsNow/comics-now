import {
  state,
  render,
  html,
  raw,
  ICONS,
  escapeHtml,
  applyDisplayInfoToComic
} from '../../../globals.js';

import {
  getComicStatusCounts,
  createEmptyStatusCounts,
  statusCountsMatchFilter
} from '../../status.js';

import { makeCountChips } from '../../breadcrumb.js';
import * as Data from '../../data.js';
import { applyFilterAndRender } from '../../alpha-list.js';
import { getSeriesPublishedInfo } from '../series-sort.js';
import { showComicList } from '../comics.js';
import { getSeriesStatusBanner, getSeriesMangaBanner } from './banner.js';

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

/**
 * Builds a single series card DOM element.
 *
 * @param {Object} options
 * @param {string} options.seriesName - Name of the series
 * @param {Array<Object>|Object} options.comicsInSeries - Array of comic issues or lazy counts object
 * @param {Map} [options.publishedInfoMap] - Precomputed series publish date info
 * @param {boolean} [options.orderByDate] - Whether series list is sorted by publish date
 * @returns {HTMLElement|null} The series card element, or null if filtered out
 */
export function createSeriesCard({ seriesName, comicsInSeries, publishedInfoMap, orderByDate }) {
  const API_BASE_URL = state.API_BASE_URL || (typeof window !== 'undefined' && window.API_BASE_URL) || '';

  const card = document.createElement('div');
  card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';

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
    return null;
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

  const bannerHtml = getSeriesStatusBanner(comicsInSeries);
  const mangaBannerHtml = getSeriesMangaBanner(comicsInSeries);

  const pubInfo = publishedInfoMap?.get(seriesName) || getSeriesPublishedInfo(comicsInSeries);
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

  return card;
}
