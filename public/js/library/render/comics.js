import {
  state,
  actions,
  clearElement,
  render,
  html,
  showView,
  createEmptyMessage,
  createLoadingMessage,
  getRelativePath,
  comicListDiv,
  comicAlphaFilter,
  comicListTitleH2,
  smartListContainer
} from '../../globals.js';

import { getComicStatus, updateFilterButtonCounts } from '../status.js';
import { updateBreadcrumb } from '../breadcrumb.js';
import * as Data from '../data.js';
import * as SmartLists from '../smartlists.js';
import { renderAlphaFilter } from '../alpha-list.js';
import { syncSmartFilterButtons, mountSmartFilterHostInto } from '../smart-filters.js';
import { createComicCard } from './comics/card-builder.js';
import { createContinuityGapCard } from './comics/gap-card.js';
import { renderSeriesContinuityStrip } from './series-continuity.js';

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
      else out += String(v ?? '');
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

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

  const container = document.getElementById('comic-list-container');
  if (container) {
    renderContent(container, createLoadingMessage('Loading comics...'));
  }

  const targetSeries = seriesName;

  try {
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

    renderSeriesContinuityStrip(seriesName, state.currentPublisher);
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

  comicsToRender.forEach((comic) => {
    if (comic.isGap) {
      const gapCard = createContinuityGapCard(comic);
      container.appendChild(gapCard);
    } else {
      const card = createComicCard(comic);
      container.appendChild(card);
    }
  });
}
