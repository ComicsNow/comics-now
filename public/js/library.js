// Filter library function simplified - status filters are applied during rendering
function filterLibrary(originalLibrary, filter) {
  return originalLibrary;
}

// filterLibraryWithDownloaded function removed - no longer needed with smart lists removed

// Reset to the initial libraries view: clears active smart-filter scope, resets the status
// filter to 'All', restores the status pill highlight, then renders the root folder list.
// Wired to the "Comics Now!" title click in index.html.
function goToInitialView() {
  // Clear smart-filter scope
  activeSmartFilter = null;
  if (typeof window !== 'undefined') window.activeSmartFilter = null;

  // Reset status filter to 'all'
  activeFilter = 'all';
  if (typeof window !== 'undefined') window.activeFilter = 'all';

  // Mirror the visual state of the status filter pills
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-purple-600');
    btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
  });
  const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
  if (allBtn) {
    allBtn.classList.add('active', 'bg-purple-600');
    allBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600');
  }

  // Clear current navigation state to force a true root view
  if (typeof window !== 'undefined') {
    window.currentRootFolder = null;
    window.currentPublisher = null;
    window.currentSeries = null;
    window.currentFolderPath = null;
  }

  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();
  if (typeof window.showRootFolderList === 'function') {
    window.showRootFolderList({ force: true });
  }
}
if (typeof window !== 'undefined') window.goToInitialView = goToInitialView;

function handleFilterClick(event) {
  const button = event.target.closest('.filter-btn');
  if (!button) return;

  const allButtons = document.querySelectorAll('.filter-btn');
  allButtons.forEach(btn => {
    btn.classList.remove('active', 'bg-purple-600');
    btn.classList.add('bg-gray-700', 'hover:bg-gray-600');
  });

  button.classList.add('active', 'bg-purple-600');
  button.classList.remove('bg-gray-700', 'hover:bg-gray-600');

  const filter = button.dataset.filter || 'all';
  activeFilter = filter;
  if (typeof window !== 'undefined') window.activeFilter = filter;

  if (filter === 'all') {
    if (typeof window.goToInitialView === 'function') {
      return window.goToInitialView();
    }
  }

  updateFilterButtonCounts();
  
  // If we have an active smart filter, stay in that scope
  const currentSmartFilter = (typeof activeSmartFilter !== 'undefined') ? activeSmartFilter : (window.activeSmartFilter || null);
  if (currentSmartFilter && typeof window._renderForActiveScope === 'function') {
    window._renderForActiveScope(currentSmartFilter);
  } else if (typeof applyFilterAndRender === 'function') {
    applyFilterAndRender();
  }
}

function initializeLibraryUIControls() {
  if (filterButtonsDiv && !filterButtonsDiv._filterListener) {
    filterButtonsDiv._filterListener = handleFilterClick;
    filterButtonsDiv.addEventListener('click', filterButtonsDiv._filterListener);
  }

  // Smart filter is now a *scope*, not a navigation target.
  // - Folder mode (default): re-render whatever drill-in view we're already in (publishers /
  //   series / comics) with the new scope applied. Don't bounce back to root.
  // - List mode + active scope: navigate to the flat #smart-list-view for that scope.
  const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga'];
  const renderForActiveScope = (scope) => {
    if (scope && smartListViewMode === 'list') {
      if (scope === 'latest' && typeof showLatestAddedSmartList === 'function') return showLatestAddedSmartList();
      if (scope === 'downloaded' && typeof showDownloadedSmartList === 'function') return showDownloadedSmartList();
      if (scope === 'guided' && typeof showGuidedSmartList === 'function') return showGuidedSmartList();
      if ((scope === 'manga' || scope === 'non-manga') && typeof showMangaSmartList === 'function') return showMangaSmartList();
    }
    
    // Folder mode, or scope cleared: re-render the current drill-in view scoped.
    if (SMART_LIST_VIEWS.includes(currentView)) {
      if (currentSeries && typeof showComicList === 'function') return showComicList(currentSeries);
      if (currentPublisher && typeof showSeriesList === 'function') return showSeriesList(currentPublisher, { force: true });
      if (currentRootFolder && typeof showPublisherList === 'function') return showPublisherList(currentRootFolder, { force: true });
      return showRootFolderList({ force: true });
    }

    // Call the exported applyFilterAndRender from LibraryRender to avoid recursion
    if (window.LibraryRender && typeof window.LibraryRender.applyFilterAndRender === 'function') {
        // We use a flag to prevent re-entering renderForActiveScope
        if (!window._isApplyingFilter) {
            window._isApplyingFilter = true;
            window.LibraryRender.applyFilterAndRender();
            window._isApplyingFilter = false;
            return;
        }
    }
    
    showRootFolderList({ force: true });
  };
  
  if (typeof window !== 'undefined') {
      window._renderForActiveScope = renderForActiveScope;
  }

  const setSmartScope = (scope) => {
    activeSmartFilter = scope;
    if (typeof window !== 'undefined') window.activeSmartFilter = scope;
    if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();
    renderForActiveScope(scope);
  };

  const clearSmartFilter = () => setSmartScope(null);

  if (latestAddedButton && !latestAddedButton._smartListListener) {
    latestAddedButton._smartListListener = (event) => {
      event.preventDefault();
      setSmartScope(activeSmartFilter === 'latest' ? null : 'latest');
    };
    latestAddedButton.addEventListener('click', latestAddedButton._smartListListener);
  }

  if (downloadedButton && !downloadedButton._smartListListener) {
    downloadedButton._smartListListener = (event) => {
      event.preventDefault();
      setSmartScope(activeSmartFilter === 'downloaded' ? null : 'downloaded');
    };
    downloadedButton.addEventListener('click', downloadedButton._smartListListener);
  }

  const guidedSmartListBtn = document.getElementById('guided-smart-list-btn');
  if (guidedSmartListBtn && !guidedSmartListBtn._smartListListener) {
    guidedSmartListBtn._smartListListener = (event) => {
      event.preventDefault();
      setSmartScope(activeSmartFilter === 'guided' ? null : 'guided');
    };
    guidedSmartListBtn.addEventListener('click', guidedSmartListBtn._smartListListener);
  }

  const mangaFilterBtn = document.getElementById('dynamic-manga-filter-btn');
  if (mangaFilterBtn && !mangaFilterBtn._smartListListener) {
    mangaFilterBtn._smartListListener = (event) => {
      event.preventDefault();
      const isMangaDefault = !!(window.mangaModePreference === true || window.mangaModePreference == 1);
      const type = isMangaDefault ? 'non-manga' : 'manga';
      setSmartScope(activeSmartFilter === type ? null : type);
    };
    mangaFilterBtn.addEventListener('click', mangaFilterBtn._smartListListener);
  }

  if (smartListBackBtn && !smartListBackBtn._smartListBackListener) {
    smartListBackBtn._smartListBackListener = (event) => {
      event.preventDefault();
      showRootFolderList({ force: true });
    };
    smartListBackBtn.addEventListener('click', smartListBackBtn._smartListBackListener);
  }

  const runLibrarySearch = () => {
    const query = librarySearchQuery?.value?.trim();
    if (!query) return;
    const field = librarySearchField?.value || 'all';
    if (typeof showSearchView === 'function') {
      showSearchView(query, field);
    } else {
      console.error('[search] showSearchView is not defined');
    }
  };

  if (librarySearchForm && !librarySearchForm._submitListener) {
    librarySearchForm._submitListener = (event) => {
      event.preventDefault();
      runLibrarySearch();
    };
    librarySearchForm.addEventListener('submit', librarySearchForm._submitListener);
  }

  // Belt-and-suspenders: handle Enter directly on the input so mobile keyboards
  // and browsers that skip implicit form submission still trigger the search.
  if (librarySearchQuery && !librarySearchQuery._enterListener) {
    librarySearchQuery._enterListener = (event) => {
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        runLibrarySearch();
      }
    };
    librarySearchQuery.addEventListener('keydown', librarySearchQuery._enterListener);
  }

  if (clearSearchBtn && !clearSearchBtn._clickListener) {
    clearSearchBtn._clickListener = (event) => {
      event.preventDefault();
      if (librarySearchQuery) {
        librarySearchQuery.value = '';
      }
      showRootFolderList({ force: true });
    };
    clearSearchBtn.addEventListener('click', clearSearchBtn._clickListener);
  }

  // Two pairs of list/folder mode buttons exist: one inside #smart-list-view (only visible
  // in list mode), and a persistent pair near the smart pill row (visible whenever a scope
  // is active). Wire both pairs to the same handlers and keep their visual state in sync.
  const modeButtonPairs = [
    [document.getElementById('smart-list-mode-list'), document.getElementById('smart-list-mode-folders')],
    [document.getElementById('smart-list-mode-list-top'), document.getElementById('smart-list-mode-folders-top')],
  ].filter(([l, f]) => l && f);

  if (modeButtonPairs.length > 0) {
    const updateModeButtons = () => {
      const activeClass = 'bg-purple-600';
      const inactiveClass = 'bg-gray-700';
      modeButtonPairs.forEach(([listBtn, foldersBtn]) => {
        if (smartListViewMode === 'list') {
          listBtn.classList.add(activeClass);
          listBtn.classList.remove(inactiveClass);
          foldersBtn.classList.remove(activeClass);
          foldersBtn.classList.add(inactiveClass);
        } else {
          foldersBtn.classList.add(activeClass);
          foldersBtn.classList.remove(inactiveClass);
          listBtn.classList.remove(activeClass);
          listBtn.classList.add(inactiveClass);
        }
      });
    };

    const setMode = (mode) => {
      smartListViewMode = mode;
      if (typeof window !== 'undefined') window.smartListViewMode = mode;
      updateModeButtons();
      
      // Always re-render the current view to respect the new mode
      if (typeof renderForActiveScope === 'function') {
        renderForActiveScope(activeSmartFilter);
      }
    };

    modeButtonPairs.forEach(([listBtn, foldersBtn]) => {
      listBtn.addEventListener('click', () => setMode('list'));
      foldersBtn.addEventListener('click', () => setMode('folders'));
    });

    updateModeButtons();
  }

  // Search view list/folder toggle — same pattern, scoped to search results.
  const searchListBtn = document.getElementById('search-mode-list');
  const searchFoldersBtn = document.getElementById('search-mode-folders');
  if (searchListBtn && searchFoldersBtn) {
    if (typeof window !== 'undefined' && !window.searchViewMode) window.searchViewMode = 'list';
    const updateSearchButtons = () => {
      const mode = (typeof window !== 'undefined' && window.searchViewMode) || 'list';
      const activeClass = 'bg-purple-600';
      const inactiveClass = 'bg-gray-700';
      if (mode === 'list') {
        searchListBtn.classList.add(activeClass); searchListBtn.classList.remove(inactiveClass);
        searchFoldersBtn.classList.remove(activeClass); searchFoldersBtn.classList.add(inactiveClass);
      } else {
        searchFoldersBtn.classList.add(activeClass); searchFoldersBtn.classList.remove(inactiveClass);
        searchListBtn.classList.remove(activeClass); searchListBtn.classList.add(inactiveClass);
      }
    };
    searchListBtn.addEventListener('click', () => {
      window.searchViewMode = 'list';
      updateSearchButtons();
      window.LibraryRender?.rerenderSearchResults?.();
    });
    searchFoldersBtn.addEventListener('click', () => {
      window.searchViewMode = 'folders';
      updateSearchButtons();
      window.LibraryRender?.rerenderSearchResults?.();
    });
    updateSearchButtons();
  }

  // Library card icons rotate daily, but the rotation is picked at render
  // time — so a tab left open across midnight keeps yesterday's icon. Watch
  // for the date key changing whenever the tab regains visibility (or the
  // user navigates back), and force a re-render when it does.
  if (!document._libraryDayWatcherInstalled) {
    document._libraryDayWatcherInstalled = true;
    const todayKey = () => {
      const d = new Date();
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    let lastDayKey = todayKey();
    const checkDayRollover = () => {
      const k = todayKey();
      if (k !== lastDayKey) {
        lastDayKey = k;
        // Only refresh if we're showing the libraries grid; other views
        // (publisher / series / comic / search) don't show library cards.
        const onLibraries = !rootFolderListDiv?.classList.contains('hidden');
        if (onLibraries && typeof showRootFolderList === 'function') {
          showRootFolderList({ force: true });
        }
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkDayRollover();
    });
    window.addEventListener('focus', checkDayRollover);
  }

  debugLog('UI', 'Library controls initialized');
}


