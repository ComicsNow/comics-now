import {
  state,
  actions,
  clearElement,
  render,
  showView,
  createEmptyMessage,
  getRelativePath,
  seriesListDiv,
  seriesTitleH2,
  seriesAlphaFilter
} from '../../globals.js';

import {
  updateFilterButtonCounts,
  filterSeriesByActiveFilter
} from '../status.js';

import { updateBreadcrumb } from '../breadcrumb.js';
import { renderAlphaFilter } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto } from '../smart-filters.js';
import { isOrderBySeriesDate, getSeriesPublishedInfo } from './series-sort.js';
import { showComicList } from './comics.js';
import { renderPublisherReadingLists } from './reading-lists.js';
import { getSeriesStatusBanner } from './series/banner.js';
import { createSeriesCard } from './series/card.js';

export { renderPublisherReadingLists, getSeriesStatusBanner, createSeriesCard };

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
    const card = createSeriesCard({
      seriesName,
      comicsInSeries: seriesToRender[seriesName],
      publishedInfoMap,
      orderByDate
    });
    if (card) {
      container.appendChild(card);
    }
  }
}

if (state) {
  state.renderSeriesCards = renderSeriesCards;
  state.showSeriesList = showSeriesList;
}
if (typeof window !== 'undefined') {
  window.renderSeriesCards = renderSeriesCards;
  window.showSeriesList = showSeriesList;
}
