import { state } from './globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

// Filter library function simplified - status filters are applied during rendering
function filterLibrary(originalLibrary, filter) {
  return originalLibrary;
}

// Reset to the initial libraries view: clears active smart-filter scope, resets the status
// filter to 'All', restores the status pill highlight, then renders the root folder list.
// Wired to the "Comics Now!" title click in index.html.
function goToInitialView() {
  // Clear smart-filter scope
  global.activeSmartFilter = null;
  if (typeof window !== 'undefined') window.activeSmartFilter = null;

  // Reset status filter to 'all'
  global.activeFilter = 'all';
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
  // Also update via global just to be safe
  global.currentRootFolder = null;
  global.currentPublisher = null;
  global.currentSeries = null;
  global.currentFolderPath = null;

  if (typeof global.updateFilterButtonCounts === 'function') global.updateFilterButtonCounts();
  if (typeof global.showRootFolderList === 'function') {
    global.showRootFolderList({ force: true });
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
  global.activeFilter = filter;
  if (typeof window !== 'undefined') window.activeFilter = filter;

  if (filter === 'all') {
    if (typeof global.goToInitialView === 'function') {
      return global.goToInitialView();
    }
  }

  if (typeof global.updateFilterButtonCounts === 'function') {
    global.updateFilterButtonCounts();
  }
  
  // If we have an active smart filter, stay in that scope
  const currentSmartFilter = global.activeSmartFilter || null;
  if (currentSmartFilter && typeof global._renderForActiveScope === 'function') {
    global._renderForActiveScope(currentSmartFilter);
  } else if (typeof global.applyFilterAndRender === 'function') {
    global.applyFilterAndRender();
  }
}

function initializeLibraryUIControls() {
  if (global.filterButtonsDiv && !global.filterButtonsDiv._filterListener) {
    global.filterButtonsDiv._filterListener = handleFilterClick;
    global.filterButtonsDiv.addEventListener('click', global.filterButtonsDiv._filterListener);
  }

  // Smart filter is now a *scope*, not a navigation target.
  // - Folder mode (default): re-render whatever drill-in view we're already in (publishers /
  //   series / comics) with the new scope applied. Don't bounce back to root.
  // - List mode + active scope: navigate to the flat #smart-list-view for that scope.
  const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga'];
  const renderForActiveScope = (scope) => {
    if (scope && global.smartListViewMode === 'list') {
      if (scope === 'latest' && typeof global.showLatestAddedSmartList === 'function') return global.showLatestAddedSmartList();
      if (scope === 'downloaded' && typeof global.showDownloadedSmartList === 'function') return global.showDownloadedSmartList();
      if (scope === 'guided' && typeof global.showGuidedSmartList === 'function') return global.showGuidedSmartList();
      if ((scope === 'manga' || scope === 'non-manga') && typeof global.showMangaSmartList === 'function') return global.showMangaSmartList();
    }
    
    // Folder mode, or scope cleared: re-render the current drill-in view scoped.
    if (SMART_LIST_VIEWS.includes(global.currentView)) {
      if (global.currentSeries && typeof global.showComicList === 'function') return global.showComicList(global.currentSeries);
      if (global.currentPublisher && typeof global.showSeriesList === 'function') return global.showSeriesList(global.currentPublisher, { force: true });
      if (global.currentRootFolder && typeof global.showPublisherList === 'function') return global.showPublisherList(global.currentRootFolder, { force: true });
      return global.showRootFolderList({ force: true });
    }

    // Call the exported applyFilterAndRender from LibraryRender to avoid recursion
    if (global.LibraryRender && typeof global.LibraryRender.applyFilterAndRender === 'function') {
        // We use a flag to prevent re-entering renderForActiveScope
        if (!global._isApplyingFilter) {
            global._isApplyingFilter = true;
            global.LibraryRender.applyFilterAndRender();
            global._isApplyingFilter = false;
            return;
        }
    }
    
    if (typeof global.showRootFolderList === 'function') {
      global.showRootFolderList({ force: true });
    }
  };
  
  if (typeof window !== 'undefined') {
      window._renderForActiveScope = renderForActiveScope;
  }
  global._renderForActiveScope = renderForActiveScope;

  const setSmartScope = (scope) => {
    global.activeSmartFilter = scope;
    if (typeof window !== 'undefined') window.activeSmartFilter = scope;
    if (typeof global.updateFilterButtonCounts === 'function') global.updateFilterButtonCounts();
    renderForActiveScope(scope);
  };


  if (global.latestAddedButton && !global.latestAddedButton._smartListListener) {
    global.latestAddedButton._smartListListener = (event) => {
      event.preventDefault();
      const isInbox = global.currentRootFolder === 'Smart Inbox';
      if (isInbox) {
        setSmartScope(global.activeSmartFilter === 'successful' ? null : 'successful');
      } else {
        setSmartScope(global.activeSmartFilter === 'latest' ? null : 'latest');
      }
    };
    global.latestAddedButton.addEventListener('click', global.latestAddedButton._smartListListener);
  }

  if (global.downloadedButton && !global.downloadedButton._smartListListener) {
    global.downloadedButton._smartListListener = (event) => {
      event.preventDefault();
      const isInbox = global.currentRootFolder === 'Smart Inbox';
      if (isInbox) {
        setSmartScope(global.activeSmartFilter === 'failed' ? null : 'failed');
      } else {
        setSmartScope(global.activeSmartFilter === 'downloaded' ? null : 'downloaded');
      }
    };
    global.downloadedButton.addEventListener('click', global.downloadedButton._smartListListener);
  }

  const guidedSmartListBtn = document.getElementById('guided-smart-list-btn');
  if (guidedSmartListBtn && !guidedSmartListBtn._smartListListener) {
    guidedSmartListBtn._smartListListener = (event) => {
      event.preventDefault();
      setSmartScope(global.activeSmartFilter === 'guided' ? null : 'guided');
    };
    guidedSmartListBtn.addEventListener('click', guidedSmartListBtn._smartListListener);
  }

  const mangaFilterBtn = document.getElementById('dynamic-manga-filter-btn');
  if (mangaFilterBtn && !mangaFilterBtn._smartListListener) {
    mangaFilterBtn._smartListListener = (event) => {
      event.preventDefault();
      const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
      const type = isMangaDefault ? 'non-manga' : 'manga';
      setSmartScope(global.activeSmartFilter === type ? null : type);
    };
    mangaFilterBtn.addEventListener('click', mangaFilterBtn._smartListListener);
  }

  if (global.smartListBackBtn && !global.smartListBackBtn._smartListBackListener) {
    global.smartListBackBtn._smartListBackListener = (event) => {
      event.preventDefault();
      if (typeof global.showRootFolderList === 'function') {
        global.showRootFolderList({ force: true });
      }
    };
    global.smartListBackBtn.addEventListener('click', global.smartListBackBtn._smartListBackListener);
  }

  const runLibrarySearch = () => {
    const query = global.librarySearchQuery?.value?.trim();
    if (!query) return;
    const field = global.librarySearchField?.value || 'all';
    if (typeof global.showSearchView === 'function') {
      global.showSearchView(query, field);
    } else {
      console.error('[search] showSearchView is not defined');
    }
  };

  if (global.librarySearchForm && !global.librarySearchForm._submitListener) {
    global.librarySearchForm._submitListener = (event) => {
      event.preventDefault();
      runLibrarySearch();
    };
    global.librarySearchForm.addEventListener('submit', global.librarySearchForm._submitListener);
  }

  // Belt-and-suspenders: handle Enter directly on the input so mobile keyboards
  // and browsers that skip implicit form submission still trigger the search.
  if (global.librarySearchQuery && !global.librarySearchQuery._enterListener) {
    global.librarySearchQuery._enterListener = (event) => {
      if (event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        runLibrarySearch();
      }
    };
    global.librarySearchQuery.addEventListener('keydown', global.librarySearchQuery._enterListener);
  }

  if (global.clearSearchBtn && !global.clearSearchBtn._clickListener) {
    global.clearSearchBtn._clickListener = (event) => {
      event.preventDefault();
      if (global.librarySearchQuery) {
        global.librarySearchQuery.value = '';
      }
      if (typeof global.showRootFolderList === 'function') {
        global.showRootFolderList({ force: true });
      }
    };
    global.clearSearchBtn.addEventListener('click', global.clearSearchBtn._clickListener);
  }

  // The list/folder mode buttons exist near the smart pill row (visible whenever a scope
  // is active). Wire them to the handlers and keep their visual state in sync.
  const modeButtonPairs = [
    [document.getElementById('smart-list-mode-list-top'), document.getElementById('smart-list-mode-folders-top')],
  ].filter(([l, f]) => l && f);

  if (modeButtonPairs.length > 0) {
    const updateModeButtons = () => {
      const activeClass = 'bg-purple-600';
      const inactiveClass = 'bg-gray-700';
      modeButtonPairs.forEach(([listBtn, foldersBtn]) => {
        if (global.smartListViewMode === 'list') {
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
      global.smartListViewMode = mode;
      if (typeof window !== 'undefined') window.smartListViewMode = mode;
      updateModeButtons();
      
      // Always re-render the current view to respect the new mode
      if (typeof renderForActiveScope === 'function') {
        renderForActiveScope(global.activeSmartFilter);
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
        const onLibraries = !global.rootFolderListDiv?.classList.contains('hidden');
        if (onLibraries && typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        }
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkDayRollover();
    });
    global.addEventListener('focus', checkDayRollover);
  }

  global.debugLog?.('UI', 'Library controls initialized');
}

export {
  filterLibrary,
  goToInitialView,
  handleFilterClick,
  initializeLibraryUIControls
};

state.filterLibrary = filterLibrary;
state.goToInitialView = goToInitialView;
state.handleFilterClick = handleFilterClick;
state.initializeLibraryUIControls = initializeLibraryUIControls;

if (typeof window !== 'undefined') {
  window.filterLibrary = filterLibrary;
  window.goToInitialView = goToInitialView;
  window.handleFilterClick = handleFilterClick;
  window.initializeLibraryUIControls = initializeLibraryUIControls;
}



