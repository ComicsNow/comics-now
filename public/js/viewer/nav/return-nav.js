import { state, global as canonicalGlobal, actions } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});
const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : global?.actions;

function setLibraryControlsVisibility(isVisible) {
  const action = isVisible ? 'remove' : 'add';
  const searchContainer = global.document?.getElementById('search-container');
  const filtersContainer = global.document?.getElementById('filters-container');

  if (searchContainer) {
    searchContainer.classList[action]('hidden');
  }
  if (filtersContainer) {
    filtersContainer.classList[action]('hidden');
  }
}

function navigateBackFromViewer(targetContext) {
  const useOverride = arguments.length > 0;
  const context = useOverride ? targetContext : global.viewerReturnContext;
  global.viewerReturnContext = null;
  global.currentComicZipCache = null;

  if (global.window?.syncManager) {
    global.window.syncManager.stopPolling();
  }

  setLibraryControlsVisibility(true);

  if (global.comicViewerDiv) {
    global.comicViewerDiv.classList.add('hidden');
    global.comicViewerDiv.style.display = 'none';
  }

  if (!context) {
    if (actionsRef?.navigation?.setView) {
      actionsRef.navigation.setView('root', { folder: null, publisher: null, series: null });
    } else {
      global.currentView = 'root';
      global.currentRootFolder = null;
      global.currentPublisher = null;
      global.currentSeries = null;
    }
    global.showRootFolderList?.({ force: true });
    return;
  }

  if (context.view === 'search') {
    if (actionsRef?.navigation?.setView) {
      actionsRef.navigation.setView('search');
    } else {
      global.currentView = 'search';
    }
    global.showView?.(global.searchResultsView);
    return;
  }

  if (context.view === 'comics' && context.series && context.rootFolder && context.publisher) {
    global.currentRootFolder = context.rootFolder;
    global.currentPublisher = context.publisher;
    global.currentSeries = context.series;
    global.showComicList?.(context.series);
    return;
  }

  if (context.view === 'series' && context.rootFolder && context.publisher) {
    global.currentRootFolder = context.rootFolder;
    global.currentPublisher = context.publisher;
    global.currentSeries = null;
    global.showSeriesList?.(context.publisher, { force: true });
    return;
  }

  if (context.view === 'latest') {
    global.showLatestAddedSmartList?.();
    return;
  }

  if (context.view === 'downloaded') {
    global.showDownloadedSmartList?.();
    return;
  }

  if (context.view === 'folder' && context.folderPath) {
    global.showFolderView?.(context.folderPath, { force: true });
    return;
  }

  if (context.view === 'publishers' && context.rootFolder) {
    global.currentRootFolder = context.rootFolder;
    global.currentPublisher = null;
    global.currentSeries = null;
    global.showPublisherList?.(context.rootFolder, { force: true });
    return;
  }

  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('root', { folder: null, publisher: null, series: null });
  } else {
    global.currentView = 'root';
    global.currentRootFolder = null;
    global.currentPublisher = null;
    global.currentSeries = null;
  }
  global.showRootFolderList?.({ force: true });
}

function rebindViewerEvents() {
  const elementsToClear = [
    global.prevPageBtn, global.nextPageBtn, 
    global.prevPageBtnBottom, global.nextPageBtnBottom,
    global.pageCounterSpan, global.pageCounterSpanBottom,
    global.pageJumpInput, global.pageJumpInputBottom
  ];

  elementsToClear.forEach(el => {
    if (!el) return;
    const newEl = el.cloneNode(true);
    if (el.parentNode) {
      el.parentNode.replaceChild(newEl, el);
    }
    // Re-assign global references
    if (el === global.prevPageBtn) global.prevPageBtn = newEl;
    if (el === global.nextPageBtn) global.nextPageBtn = newEl;
    if (el === global.prevPageBtnBottom) global.prevPageBtnBottom = newEl;
    if (el === global.nextPageBtnBottom) global.nextPageBtnBottom = newEl;
    if (el === global.pageCounterSpan) global.pageCounterSpan = newEl;
    if (el === global.pageCounterSpanBottom) global.pageCounterSpanBottom = newEl;
    if (el === global.pageJumpInput) global.pageJumpInput = newEl;
    if (el === global.pageJumpInputBottom) global.pageJumpInputBottom = newEl;
  });

  // Re-bind listeners
  if (global.prevPageBtn) {
    global.prevPageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const dir = global.getNavigationDirection ? global.getNavigationDirection(-1) : -1;
      global.navigatePage?.(dir);
    });
  }
  if (global.nextPageBtn) {
    global.nextPageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const dir = global.getNavigationDirection ? global.getNavigationDirection(1) : 1;
      global.navigatePage?.(dir);
    });
  }
  if (global.prevPageBtnBottom) {
    global.prevPageBtnBottom.addEventListener('click', (e) => {
      e.preventDefault();
      const dir = global.getNavigationDirection ? global.getNavigationDirection(-1) : -1;
      global.navigatePage?.(dir);
    });
  }
  if (global.nextPageBtnBottom) {
    global.nextPageBtnBottom.addEventListener('click', (e) => {
      e.preventDefault();
      const dir = global.getNavigationDirection ? global.getNavigationDirection(1) : 1;
      global.navigatePage?.(dir);
    });
  }

  if (global.pageCounterSpan) {
    global.pageCounterSpan.addEventListener('click', (e) => {
      e.preventDefault();
      global.showPageJumpInput?.();
    });
  }
  if (global.pageCounterSpanBottom) {
    global.pageCounterSpanBottom.addEventListener('click', (e) => {
      e.preventDefault();
      global.showPageJumpInputBottom?.();
    });
  }

  if (global.pageJumpInput) {
    global.pageJumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        global.commitPageJump?.();
      }
    });
    global.pageJumpInput.addEventListener('blur', () => {
      global.hidePageJumpInput?.({ focusButton: false });
    });
  }
  if (global.pageJumpInputBottom) {
    global.pageJumpInputBottom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        global.commitPageJumpBottom?.();
      }
    });
    global.pageJumpInputBottom.addEventListener('blur', () => {
      global.hidePageJumpInputBottom?.({ focusButton: false });
    });
  }
}

export {
  setLibraryControlsVisibility,
  navigateBackFromViewer,
  rebindViewerEvents
};
