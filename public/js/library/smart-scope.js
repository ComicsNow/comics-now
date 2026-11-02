import { state, global as canonicalGlobal } from '../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga', 'reading-list'];

export function renderForActiveScope(scope) {
  if (scope && global.smartListViewMode === 'list') {
    if (scope === 'latest' && typeof global.showLatestAddedSmartList === 'function') return global.showLatestAddedSmartList();
    if (scope === 'downloaded' && typeof global.showDownloadedSmartList === 'function') return global.showDownloadedSmartList();
    if (scope === 'guided' && typeof global.showGuidedSmartList === 'function') return global.showGuidedSmartList();
    if ((scope === 'manga' || scope === 'non-manga') && typeof global.showMangaSmartList === 'function') return global.showMangaSmartList();
  }
  
  if (SMART_LIST_VIEWS.includes(global.currentView)) {
    if (global.currentSeries && typeof global.showComicList === 'function') return global.showComicList(global.currentSeries);
    if (global.currentPublisher && typeof global.showSeriesList === 'function') return global.showSeriesList(global.currentPublisher, { force: true });
    if (global.currentRootFolder && typeof global.showPublisherList === 'function') return global.showPublisherList(global.currentRootFolder, { force: true });
    return global.showRootFolderList({ force: true });
  }

  if (global.LibraryRender && typeof global.LibraryRender.applyFilterAndRender === 'function') {
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
}

if (typeof window !== 'undefined') {
  window._renderForActiveScope = renderForActiveScope;
}
global._renderForActiveScope = renderForActiveScope;

export function setSmartScope(scope) {
  global.activeSmartFilter = scope;
  if (typeof window !== 'undefined') window.activeSmartFilter = scope;
  if (typeof global.updateFilterButtonCounts === 'function') global.updateFilterButtonCounts();
  renderForActiveScope(scope);
}

export function initSmartScopeControls() {
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

  const readingListFilterBtn = document.getElementById('dynamic-reading-list-filter-btn');
  if (readingListFilterBtn && !readingListFilterBtn._smartListListener) {
    readingListFilterBtn._smartListListener = (event) => {
      event.preventDefault();
      setSmartScope(global.activeSmartFilter === 'reading-list' ? null : 'reading-list');
    };
    readingListFilterBtn.addEventListener('click', readingListFilterBtn._smartListListener);
  }
}
