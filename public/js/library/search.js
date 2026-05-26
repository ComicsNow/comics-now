import {
  state,
  escapeHtml,
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
    searchResultsContainer.innerHTML = createLoadingMessage('Searching...');
  }

  if (!navigator.onLine) {
    const comics = searchLibraryLocally(state.lastSearchQuery, state.lastSearchField);
    state.lastSearchResults = comics;
    window.lastSearchResults = comics;
    if (comics.length === 0) {
      if (searchResultsContainer) {
        searchResultsContainer.innerHTML = createEmptyMessage('No results found.');
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
        searchResultsContainer.innerHTML = createEmptyMessage('No results found.');
      }
      return;
    }

    renderResults(comics);
  } catch (error) {
    console.error('[search] Error:', error);
    if (searchResultsContainer) {
      searchResultsContainer.innerHTML = '<div class="text-red-400">Search failed.</div>';
    }
  }
}

export function renderSearchResultsAsFolders(comics) {
  if (!searchResultsContainer) return;
  searchResultsContainer.innerHTML = '';
  
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


    card.innerHTML = `
      <div class="relative h-48 w-full bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center p-4">
         <div class="text-4xl font-bold text-gray-500 opacity-20 select-none">${pubName.charAt(0).toUpperCase()}</div>
         <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-gray-400 font-bold">${pubName}</span>
         </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${escapeHtml(pubName)}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${seriesCount} ${seriesCount === 1 ? 'Series' : 'Series'} (${comicCount} ${comicCount === 1 ? 'comic' : 'comics'})</p>
    `;
    
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

export function searchLibraryLocally(query, field) {
  const q = query.toLowerCase();
  const results = [];
  
  const activeComicIdMap = comicIdMap || state.comicIdMap || window.comicIdMap;
  if (!activeComicIdMap) return [];

  for (const comic of activeComicIdMap.values()) {
    const meta = comic.metadata || {};
    const hay = {
      title: comic.name || '',
      series: comic.series || '',
      publisher: comic.publisher || '',
      character: meta.Characters || '',
      all: `${comic.name} ${comic.series} ${comic.publisher} ${meta.Characters || ''} ${meta.Summary || ''}`
    };
    
    const valueToSearch = (hay[field] || hay.all).toLowerCase();
    if (valueToSearch.includes(q)) {
      results.push(comic);
    }
  }
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

