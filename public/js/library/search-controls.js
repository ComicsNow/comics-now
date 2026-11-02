import { state, global as canonicalGlobal } from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export function runLibrarySearch() {
  const query = global.librarySearchQuery?.value?.trim();
  if (!query) return;
  const field = global.librarySearchField?.value || 'all';
  if (typeof global.showSearchView === 'function') {
    global.showSearchView(query, field);
  } else {
    console.error('[search] showSearchView is not defined');
  }
}

export function initSearchControls() {
  if (global.librarySearchForm && !global.librarySearchForm._submitListener) {
    global.librarySearchForm._submitListener = (event) => {
      event.preventDefault();
      runLibrarySearch();
    };
    global.librarySearchForm.addEventListener('submit', global.librarySearchForm._submitListener);
  }

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
}

export function initModeToggleControls() {
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
      
      if (typeof global._renderForActiveScope === 'function') {
        global._renderForActiveScope(global.activeSmartFilter);
      }
    };

    modeButtonPairs.forEach(([listBtn, foldersBtn]) => {
      listBtn.addEventListener('click', () => setMode('list'));
      foldersBtn.addEventListener('click', () => setMode('folders'));
    });

    updateModeButtons();
  }

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
}

export function initDayRolloverWatcher() {
  if (typeof document === 'undefined') return;
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
        const onLibraries = !global.rootFolderListDiv?.classList.contains('hidden');
        if (onLibraries && typeof global.showRootFolderList === 'function') {
          global.showRootFolderList({ force: true });
        }
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkDayRollover();
    });
    global.addEventListener?.('focus', checkDayRollover);
  }
}
