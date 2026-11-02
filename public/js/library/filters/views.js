import {
  state,
  actions,
  render,
  createLoadingMessage,
  createEmptyMessage,
  createErrorMessage,
  smartListContainer,
  smartListTitle,
  smartListView
} from '../../globals.js';
import {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  clearSmartFilterButtons,
  mountSmartFilterHostInto
} from './buttons.js';
import {
  scopeListByDrillIn,
  buildSmartListBreadcrumb,
  filterComicsByStatus
} from './predicate.js';

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

const getActions = () => (typeof actions !== 'undefined' && actions?.navigation) ? actions : (typeof globalThis !== 'undefined' ? globalThis.__COMICS_STORE__?.actions : null);

function getContainer() {
  return smartListContainer || (typeof document !== 'undefined' ? document.getElementById('smart-list-container') : null);
}

function getTitleElem() {
  return smartListTitle || (typeof document !== 'undefined' ? document.getElementById('smart-list-title') : null);
}

function getViewElem() {
  return smartListView || (typeof document !== 'undefined' ? document.getElementById('smart-list-view') : null);
}

function renderSmartListShell({ title, setButtonActive }) {
  const container = getContainer();
  if (!container) return null;

  clearSmartFilterButtons();
  if (typeof setButtonActive === 'function') setButtonActive(true);

  const viewElem = getViewElem();
  const showView = state.showView || (typeof window !== 'undefined' ? window.showView : null);
  if (typeof showView === 'function' && viewElem) {
    showView(viewElem);
  }
  if (viewElem) mountSmartFilterHostInto(viewElem);

  const titleElem = getTitleElem();
  if (titleElem) {
    titleElem.textContent = title;
  }
  return container;
}

function renderFilteredComics({ container, comics, emptyMsg, getFilteredEmptyMsg }) {
  if (!Array.isArray(comics) || comics.length === 0) {
    renderContent(container, createEmptyMessage(emptyMsg));
    return;
  }

  const activeFilter = state.activeFilter || (typeof window !== 'undefined' ? window.activeFilter : null) || 'all';
  const getComicStatus = state.getComicStatus || (typeof window !== 'undefined' ? window.getComicStatus : null) || (() => 'unread');
  const comicsToRender = filterComicsByStatus(comics, activeFilter, getComicStatus);

  if (comicsToRender.length === 0) {
    const msg = typeof getFilteredEmptyMsg === 'function' ? getFilteredEmptyMsg(activeFilter) : emptyMsg;
    renderContent(container, createEmptyMessage(msg));
    return;
  }

  const renderComicCards = state.renderComicCards || (typeof window !== 'undefined' ? window.renderComicCards : null);
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

export function showLatestAddedSmartList() {
  const actionsRef = getActions();
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('latest');
  } else {
    state.currentView = 'latest';
  }
  if (typeof window !== 'undefined') window.currentView = 'latest';
  
  const updateBreadcrumb = state.updateBreadcrumb || (typeof window !== 'undefined' ? window.updateBreadcrumb : null);
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('New'));
  }
  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  if (typeof SmartLists.rebuildLatestComics === 'function') {
    SmartLists.rebuildLatestComics();
  }
  renderLatestSmartList();
}

export async function showDownloadedSmartList() {
  const actionsRef = getActions();
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('downloaded');
  } else {
    state.currentView = 'downloaded';
  }
  if (typeof window !== 'undefined') window.currentView = 'downloaded';

  const container = renderSmartListShell({ title: 'Down', setButtonActive: setDownloadedButtonActive });
  
  const updateBreadcrumb = state.updateBreadcrumb || (typeof window !== 'undefined' ? window.updateBreadcrumb : null);
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('Down'));
  }

  if (container) {
    renderContent(container, createLoadingMessage('Loading downloaded comics...'));
  }

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  if (typeof SmartLists.rebuildDownloadedComics === 'function') {
    await SmartLists.rebuildDownloadedComics({ skipRender: true });
  }
  renderDownloadedSmartList();
}

export function renderLatestSmartList() {
  const container = renderSmartListShell({ title: 'New', setButtonActive: setLatestButtonActive });
  if (!container) return;

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  const latestComics = scopeListByDrillIn(SmartLists.getLatestComics ? SmartLists.getLatestComics() : []);
  const days = SmartLists.LATEST_ADDED_DAYS || 14;

  renderFilteredComics({
    container,
    comics: latestComics,
    emptyMsg: `No comics added in the last ${days} days.`,
    getFilteredEmptyMsg: (f) => {
      if (f === 'in-progress') return `No comics in progress from the last ${days} days.`;
      if (f === 'read') return `No comics read from the last ${days} days.`;
      return `No unread comics from the last ${days} days.`;
    }
  });
}

export function renderDownloadedSmartList() {
  const container = renderSmartListShell({ title: 'Down', setButtonActive: setDownloadedButtonActive });
  if (!container) return;

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  const downloadedSmartListError = typeof SmartLists.getDownloadedSmartListError === 'function' ? SmartLists.getDownloadedSmartListError() : null;
  if (downloadedSmartListError) {
    renderContent(container, createErrorMessage('Failed to load downloaded comics.'));
    return;
  }

  const downloadedComics = scopeListByDrillIn(SmartLists.getDownloadedSmartListComics ? SmartLists.getDownloadedSmartListComics() : []);
  renderFilteredComics({
    container,
    comics: downloadedComics,
    emptyMsg: 'No comics downloaded for offline use.',
    getFilteredEmptyMsg: (f) => {
      if (f === 'in-progress') return 'No downloaded comics in progress.';
      if (f === 'read') return 'No downloaded comics marked as read.';
      return 'No unread downloaded comics.';
    }
  });
}

export function showGuidedSmartList() {
  const actionsRef = getActions();
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('guided');
  } else {
    state.currentView = 'guided';
  }
  if (typeof window !== 'undefined') window.currentView = 'guided';
  
  const updateBreadcrumb = state.updateBreadcrumb || (typeof window !== 'undefined' ? window.updateBreadcrumb : null);
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('Guide'));
  }
  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  if (typeof SmartLists.rebuildGuidedComics === 'function') {
    SmartLists.rebuildGuidedComics();
  }
  renderGuidedSmartList();
}

export function renderGuidedSmartList() {
  const container = renderSmartListShell({ title: 'Guide', setButtonActive: setGuidedButtonActive });
  if (!container) return;

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  const guidedComics = scopeListByDrillIn(SmartLists.getGuidedComics ? SmartLists.getGuidedComics() : []);

  renderFilteredComics({
    container,
    comics: guidedComics,
    emptyMsg: 'No comics with completed guided reading.',
    getFilteredEmptyMsg: (f) => {
      if (f === 'in-progress') return 'No guided comics in progress.';
      if (f === 'read') return 'No guided comics marked as read.';
      return 'No unread guided comics.';
    }
  });
}

export function showMangaSmartList() {
  const actionsRef = getActions();
  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('manga');
  } else {
    state.currentView = 'manga';
  }
  if (typeof window !== 'undefined') window.currentView = 'manga';
  
  const isMangaDefault = !!(state.mangaModePreference === true || state.mangaModePreference == 1 || (typeof window !== 'undefined' && (window.mangaModePreference === true || window.mangaModePreference == 1)));
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  
  const updateBreadcrumb = state.updateBreadcrumb || (typeof window !== 'undefined' ? window.updateBreadcrumb : null);
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb(label));
  }
  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  if (typeof SmartLists.rebuildMangaSmartLists === 'function') {
    SmartLists.rebuildMangaSmartLists();
  }
  renderMangaSmartList();
}

export function renderMangaSmartList() {
  const isMangaDefault = !!(state.mangaModePreference === true || state.mangaModePreference == 1 || (typeof window !== 'undefined' && (window.mangaModePreference === true || window.mangaModePreference == 1)));
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  const container = renderSmartListShell({ title: label, setButtonActive: setMangaFilterButtonActive });
  if (!container) return;

  const SmartLists = state.LibrarySmartLists || (typeof window !== 'undefined' ? window.LibrarySmartLists : null) || {};
  const comics = scopeListByDrillIn((isMangaDefault ? (SmartLists.getNonMangaComics ? SmartLists.getNonMangaComics() : []) : (SmartLists.getMangaComics ? SmartLists.getMangaComics() : [])));

  const base = isMangaDefault ? 'non-manga' : 'manga';
  renderFilteredComics({
    container,
    comics,
    emptyMsg: `No ${base} comics in your library.`,
    getFilteredEmptyMsg: (f) => {
      if (f === 'in-progress') return `No ${base} comics in progress.`;
      if (f === 'read') return `No ${base} comics marked as read.`;
      return `No unread ${base} comics.`;
    }
  });
}
