import {
  state,
  clearElement,
  render,
  html,
  escapeHtml,
  safeDirName,
  getRelativePath,
  createLoadingMessage,
  createEmptyMessage,
  searchResultsView,
  searchResultsTitle,
  searchResultsContainer,
  rootFolderListDiv,
  publisherListDiv,
  seriesListDiv,
  comicListDiv
} from '../globals.js';
import { comicIdMap } from './data.js';

const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
const renderContent = typeof render === 'function' ? render : (el, content) => {
  if (!el) return;
  if (content && typeof content === 'object' && typeof content.toHTML === 'function') {
    el.innerHTML = content.toHTML();
  } else if (content && typeof content === 'object' && content.__isRawHtml) {
    el.innerHTML = content.html;
  } else {
    el.innerHTML = String(content ?? '');
  }
};
const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  const formatVal = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(formatVal).join('');
    if (typeof v === 'object' && v.__isRawHtml) return v.html;
    if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
    return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v);
  };
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += formatVal(values[i]);
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export async function rerenderSearchResults() {
  const lastSearchQuery = state.lastSearchQuery || window.lastSearchQuery;
  const lastSearchField = state.lastSearchField || window.lastSearchField;
  if (lastSearchQuery) {
    await showSearchView(lastSearchQuery, lastSearchField, true);
  }
}

export async function showSearchView(query, field, useCache = false) {
  const _isNavigatingFromRouter = state._isNavigatingFromRouter || window._isNavigatingFromRouter;
  const router = state.router || window.router;
  if (!_isNavigatingFromRouter && router && query) {
    const searchUrl = `/search?q=${encodeURIComponent(query)}&field=${encodeURIComponent(field)}`;
    if (getRelativePath() + window.location.search !== searchUrl) {
      router.navigate(searchUrl, true);
    }
  }

  if (query === undefined && state.lastSearchQuery !== undefined) {
    query = state.lastSearchQuery;
    field = state.lastSearchField;
    useCache = true;
  }
  
  const isSameSearch = (query === state.lastSearchQuery && field === state.lastSearchField);
  state.lastSearchQuery = query || '';
  window.lastSearchQuery = state.lastSearchQuery;
  state.lastSearchField = field || 'all';
  window.lastSearchField = state.lastSearchField;

  state.currentView = 'search';
  window.currentView = 'search';
  
  if (rootFolderListDiv) rootFolderListDiv.classList.add('hidden');
  if (publisherListDiv) publisherListDiv.classList.add('hidden');
  if (seriesListDiv) seriesListDiv.classList.add('hidden');
  if (comicListDiv) comicListDiv.classList.add('hidden');
  
  if (searchResultsView) {
    searchResultsView.classList.remove('hidden');
  }

  if (searchResultsTitle) {
    searchResultsTitle.textContent = `Search Results for "${state.lastSearchQuery}"`;
  }

  const renderResults = (comics) => {
    const mode = state.searchViewMode || window.searchViewMode || 'list';
    if (mode === 'folders') {
      renderSearchResultsAsFolders(comics);
    } else {
      const renderComicCards = state.renderComicCards || window.renderComicCards;
      if (typeof renderComicCards === 'function') {
        renderComicCards(comics, 'search');
      }
    }
  };

  if (useCache && isSameSearch && state.lastSearchResults) {
    renderResults(state.lastSearchResults);
    return;
  }

  if (searchResultsContainer) {
    renderContent(searchResultsContainer, createLoadingMessage('Searching...'));
  }

  if (!navigator.onLine) {
    const comics = searchLibraryLocally(state.lastSearchQuery, state.lastSearchField);
    state.lastSearchResults = comics;
    window.lastSearchResults = comics;
    if (comics.length === 0) {
      if (searchResultsContainer) {
        renderContent(searchResultsContainer, createEmptyMessage('No results found.'));
      }
      return;
    }
    renderResults(comics);
    return;
  }

  try {
    const baseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(`${baseUrl}/api/v1/search?query=${encodeURIComponent(state.lastSearchQuery)}&field=${state.lastSearchField}`);
    const comics = await response.json();
    state.lastSearchResults = comics;
    window.lastSearchResults = comics;
    
    if (comics.length === 0) {
      if (searchResultsContainer) {
        renderContent(searchResultsContainer, createEmptyMessage('No results found.'));
      }
      return;
    }

    renderResults(comics);
  } catch (error) {
    console.error('[search] Error:', error);
    if (searchResultsContainer) {
      renderContent(searchResultsContainer, html`<div class="text-red-400">Search failed.</div>`);
    }
  }
}

export function renderSearchResultsAsFolders(comics) {
  if (!searchResultsContainer) return;
  clear(searchResultsContainer);
  
  // Group comics by Publisher
  const publishers = {};
  comics.forEach(comic => {
    const pub = comic.publisher || 'Unknown';
    if (!publishers[pub]) publishers[pub] = [];
    publishers[pub].push(comic);
  });

  const sortedPublishers = Object.keys(publishers).sort();
  
  sortedPublishers.forEach(pubName => {
    const pubComics = publishers[pubName];
    const card = document.createElement('div');
    card.className = 'publisher-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    
    // Group by series within publisher to get counts
    const series = {};
    pubComics.forEach(c => {
      const s = c.series || 'Unknown';
      if (!series[s]) series[s] = [];
      series[s].push(c);
    });
    
    const seriesCount = Object.keys(series).length;
    const comicCount = pubComics.length;

    renderContent(card, safeHtml`
      <div class="relative h-48 w-full bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center p-4">
         <div class="text-4xl font-bold text-gray-500 opacity-20 select-none">${pubName.charAt(0).toUpperCase()}</div>
         <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-gray-400 font-bold">${pubName}</span>
         </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${pubName}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${seriesCount} ${seriesCount === 1 ? 'Series' : 'Series'} (${comicCount} ${comicCount === 1 ? 'comic' : 'comics'})</p>
    `);
    
    card.addEventListener('click', () => {
      // For simplicity, just show the comics of this publisher in a flat list for now
      const renderComicCards = state.renderComicCards || window.renderComicCards;
      if (typeof renderComicCards === 'function') {
        renderComicCards(pubComics, 'search');
      }
      if (searchResultsTitle) {
        searchResultsTitle.textContent = `Search Results: ${pubName}`;
      }
      // Add back button to return to publisher list
      const backBtn = document.createElement('button');
      backBtn.className = 'pill-button bg-gray-700 hover:bg-gray-600 text-white transition-colors mb-4 ml-4';
      backBtn.textContent = '← Back to Publishers';
      backBtn.addEventListener('click', () => {
          showSearchView(state.lastSearchQuery, state.lastSearchField, true);
      });
      searchResultsContainer.prepend(backBtn);
    });
    
    searchResultsContainer.appendChild(card);
  });
}

export function searchLibraryLocally(query, field = 'all') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const normalizedField = String(field || 'all').toLowerCase().trim();
  const results = [];
  
  const activeComicIdMap = comicIdMap || state.comicIdMap || window.comicIdMap;
  if (!activeComicIdMap) return [];

  for (const comic of activeComicIdMap.values()) {
    const meta = comic.metadata || {};
    const titleVal = `${comic.name || ''} ${meta.Title || meta.title || ''}`;
    const seriesVal = `${comic.series || ''} ${meta.Series || meta.series || ''}`;
    const pubVal = `${comic.publisher || ''} ${meta.Publisher || meta.publisher || ''}`;
    const charVal = `${meta.Characters || meta.characters || ''}`;
    const hay = {
      title: titleVal,
      series: seriesVal,
      publisher: pubVal,
      character: charVal,
      all: `${titleVal} ${seriesVal} ${pubVal} ${charVal} ${meta.Writer || meta.writer || ''} ${meta.Summary || meta.summary || ''}`
    };
    
    const valueToSearch = (hay[normalizedField] ?? hay.all).toLowerCase();
    if (valueToSearch.includes(q)) {
      results.push(comic);
    }
  }

  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`(?:^|[^a-z0-9])${escapedQ}(?:$|[^a-z0-9])`, 'i');
  const scoreComic = (c) => {
    const meta = c.metadata || {};
    const series = String(c.series || meta.Series || meta.series || '').trim().toLowerCase();
    const title = String(meta.Title || meta.title || '').trim().toLowerCase();
    const rawName = String(c.name || '').trim().toLowerCase().replace(/\.(cbz|cbr|cb7|cbt|zip|rar|pdf)$/i, '');
    const chars = String(meta.Characters || meta.characters || '').toLowerCase();
    const pub = String(c.publisher || meta.Publisher || meta.publisher || '').toLowerCase();
    let score = 0;
    if (series === q || title === q || rawName === q) score += 1000;
    else if (series.startsWith(q) || title.startsWith(q) || rawName.startsWith(q)) score += 700;
    else if (wordRegex.test(series) || wordRegex.test(title) || wordRegex.test(rawName)) score += 500;
    else if (series.includes(q) || title.includes(q) || rawName.includes(q)) score += 300;
    if (chars.includes(q)) score += 150;
    if (pub.includes(q)) score += 80;
    return score || 20;
  };

  results.sort((a, b) => {
    const diff = scoreComic(b) - scoreComic(a);
    if (diff !== 0) return diff;
    const sA = String(a.series || a.metadata?.Series || '');
    const sB = String(b.series || b.metadata?.Series || '');
    const sCmp = sA.localeCompare(sB, undefined, { sensitivity: 'base' });
    if (sCmp !== 0) return sCmp;
    const nA = parseFloat(a.metadata?.Number ?? a.metadata?.number);
    const nB = parseFloat(b.metadata?.Number ?? b.metadata?.number);
    if (!Number.isNaN(nA) && !Number.isNaN(nB) && nA !== nB) return nA - nB;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });
  });

  return results;
}

const LibrarySearch = {
  rerenderSearchResults,
  showSearchView,
  renderSearchResultsAsFolders,
  searchLibraryLocally
};

state.LibrarySearch = LibrarySearch;
Object.assign(state, LibrarySearch);

if (typeof window !== 'undefined') {
  window.LibrarySearch = LibrarySearch;
  Object.assign(window, LibrarySearch);
}

