(function (global) {
  'use strict';

  async function rerenderSearchResults() {
    if (typeof lastSearchQuery !== 'undefined' && lastSearchQuery) {
      await showSearchView(lastSearchQuery, lastSearchField, true);
    }
  }

  async function showSearchView(query, field, useCache = false) {
    if (!window._isNavigatingFromRouter && window.router && query) {
      const searchUrl = `/search?q=${encodeURIComponent(query)}&field=${encodeURIComponent(field)}`;
      if (typeof getRelativePath === 'function') {
        if (getRelativePath() + window.location.search !== searchUrl) {
          window.router.navigate(searchUrl, true);
        }
      }
    }

    if (query === undefined && typeof lastSearchQuery !== 'undefined') {
      query = lastSearchQuery;
      field = lastSearchField;
      useCache = true;
    }
    
    const isSameSearch = (query === lastSearchQuery && field === lastSearchField);
    lastSearchQuery = query || '';
    lastSearchField = field || 'all';

    currentView = 'search';
    
    if (typeof rootFolderListDiv !== 'undefined') rootFolderListDiv.classList.add('hidden');
    if (typeof publisherListDiv !== 'undefined') publisherListDiv.classList.add('hidden');
    if (typeof seriesListDiv !== 'undefined') seriesListDiv.classList.add('hidden');
    if (typeof comicListDiv !== 'undefined') comicListDiv.classList.add('hidden');
    
    if (typeof searchResultsView !== 'undefined') {
      searchResultsView.classList.remove('hidden');
    }

    if (typeof searchResultsTitle !== 'undefined') {
      searchResultsTitle.textContent = `Search Results for "${lastSearchQuery}"`;
    }

    const renderResults = (comics) => {
      const mode = (typeof window !== 'undefined' && window.searchViewMode) || 'list';
      if (mode === 'folders') {
        renderSearchResultsAsFolders(comics);
      } else {
        if (typeof renderComicCards === 'function') {
          renderComicCards(comics, 'search');
        }
      }
    };

    if (useCache && isSameSearch && typeof lastSearchResults !== 'undefined' && lastSearchResults) {
      renderResults(lastSearchResults);
      return;
    }

    if (typeof searchResultsContainer !== 'undefined') {
      searchResultsContainer.innerHTML = createLoadingMessage('Searching...');
    }

    if (!navigator.onLine) {
      const comics = searchLibraryLocally(lastSearchQuery, lastSearchField);
      lastSearchResults = comics;
      if (comics.length === 0) {
        if (typeof searchResultsContainer !== 'undefined') {
          searchResultsContainer.innerHTML = createEmptyMessage('No results found.');
        }
        return;
      }
      renderResults(comics);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/search?query=${encodeURIComponent(lastSearchQuery)}&field=${lastSearchField}`);
      const comics = await response.json();
      lastSearchResults = comics;
      
      if (comics.length === 0) {
        if (typeof searchResultsContainer !== 'undefined') {
          searchResultsContainer.innerHTML = createEmptyMessage('No results found.');
        }
        return;
      }

      renderResults(comics);
    } catch (error) {
      console.error('[search] Error:', error);
      if (typeof searchResultsContainer !== 'undefined') {
        searchResultsContainer.innerHTML = '<div class="text-red-400">Search failed.</div>';
      }
    }
  }

  function renderSearchResultsAsFolders(comics) {
    if (typeof searchResultsContainer === 'undefined' || !searchResultsContainer) return;
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

      // Try to find a logo for the publisher
      const folderName = typeof safeDirName === 'function' ? safeDirName(pubName) : pubName;
      const pubLogoUrl = `${API_BASE_URL}/logos/${encodeURIComponent(folderName)}/logo.png`; // Fallback/Optimistic

      card.innerHTML = `
        <div class="relative h-48 w-full bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center p-4">
           <div class="text-4xl font-bold text-gray-500 opacity-20 select-none">${pubName.charAt(0).toUpperCase()}</div>
           <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-gray-400 font-bold">${pubName}</span>
           </div>
        </div>
        <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${typeof escapeHtml === 'function' ? escapeHtml(pubName) : pubName}</h3>
        <p class="mt-1 text-xs text-gray-400 text-center">${seriesCount} ${seriesCount === 1 ? 'Series' : 'Series'} (${comicCount} ${comicCount === 1 ? 'comic' : 'comics'})</p>
      `;
      
      card.addEventListener('click', () => {
        // For simplicity, just show the comics of this publisher in a flat list for now
        if (typeof renderComicCards === 'function') {
          renderComicCards(pubComics, 'search');
        }
        if (typeof searchResultsTitle !== 'undefined') {
          searchResultsTitle.textContent = `Search Results: ${pubName}`;
        }
        // Add back button to return to publisher list
        const backBtn = document.createElement('button');
        backBtn.className = 'pill-button bg-gray-700 hover:bg-gray-600 text-white transition-colors mb-4 ml-4';
        backBtn.textContent = '← Back to Publishers';
        backBtn.addEventListener('click', () => {
            showSearchView(lastSearchQuery, lastSearchField, true);
        });
        searchResultsContainer.prepend(backBtn);
      });
      
      searchResultsContainer.appendChild(card);
    });
  }

  function searchLibraryLocally(query, field) {
    const q = query.toLowerCase();
    const results = [];
    
    if (!global.comicIdMap) return [];

    for (const comic of global.comicIdMap.values()) {
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

  global.LibrarySearch = LibrarySearch;
  Object.assign(global, LibrarySearch);
})(typeof window !== 'undefined' ? window : globalThis);
