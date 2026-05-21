import {
  state,
  createLoadingMessage,
  createEmptyMessage,
  createErrorMessage,
  latestAddedButton,
  downloadedButton,
  smartListContainer,
  smartListTitle,
  smartListView
} from '../globals.js';

export function setLatestButtonActive(isActive) {
  if (!latestAddedButton) return;
  latestAddedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  latestAddedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  latestAddedButton.classList.toggle('bg-gray-700', !isActive);
  latestAddedButton.classList.toggle('hover:bg-gray-600', !isActive);
  latestAddedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setDownloadedButtonActive(isActive) {
  if (!downloadedButton) return;
  downloadedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  downloadedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  downloadedButton.classList.toggle('bg-gray-700', !isActive);
  downloadedButton.classList.toggle('hover:bg-gray-600', !isActive);
  downloadedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setGuidedButtonActive(isActive) {
  const btn = document.getElementById('guided-smart-list-btn');
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function setMangaFilterButtonActive(isActive) {
  const btn = document.getElementById('dynamic-manga-filter-btn');
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}

export function clearSmartFilterButtons() {
  setLatestButtonActive(false);
  setDownloadedButtonActive(false);
  setGuidedButtonActive(false);
  setMangaFilterButtonActive(false);
}

export function syncSmartFilterButtons() {
  const scope = state.activeSmartFilter || window.activeSmartFilter || null;
  setLatestButtonActive(scope === 'latest');
  setDownloadedButtonActive(scope === 'downloaded');
  setGuidedButtonActive(scope === 'guided');
  setMangaFilterButtonActive(scope === 'manga' || scope === 'non-manga');
  const modeToggle = document.getElementById('smart-scope-mode-toggle');
  if (modeToggle) {
    const activeFilter = state.activeFilter || window.activeFilter;
    const isFilterActive = typeof activeFilter !== 'undefined' && activeFilter !== 'all';
    modeToggle.classList.toggle('hidden', !scope && !isFilterActive);
  }
}

export function mountSmartFilterHostInto(viewElement) {
  const host = document.getElementById('smart-filter-host');
  if (!host || !viewElement) return;
  const slot = viewElement.querySelector('.smart-filter-mount');
  if (!slot) return;
  if (host.parentElement !== slot) {
    slot.appendChild(host);
  }
  host.classList.remove('hidden');
}

export function hideSmartFilterHost() {
  const host = document.getElementById('smart-filter-host');
  if (host) host.classList.add('hidden');
}

export function collectDrillInComicIds() {
  const library = state.library || window.library;
  const currentRootFolder = state.currentRootFolder || window.currentRootFolder;
  const currentPublisher = state.currentPublisher || window.currentPublisher;
  const currentSeries = state.currentSeries || window.currentSeries;

  if (!library || typeof library !== 'object') return null;
  if (!currentRootFolder && !currentPublisher && !currentSeries) return null;

  const ids = new Set();
  const addAll = (comics) => { if (Array.isArray(comics)) comics.forEach(c => c && c.id != null && ids.add(c.id)); };

  if (currentRootFolder && currentPublisher && currentSeries) {
    addAll(library[currentRootFolder]?.publishers?.[currentPublisher]?.series?.[currentSeries]);
  } else if (currentRootFolder && currentPublisher) {
    const seriesEntries = library[currentRootFolder]?.publishers?.[currentPublisher]?.series || {};
    Object.values(seriesEntries).forEach(addAll);
  } else if (currentRootFolder) {
    const publishers = library[currentRootFolder]?.publishers || {};
    Object.values(publishers).forEach(p => Object.values(p?.series || {}).forEach(addAll));
  }
  return ids;
}

export function scopeListByDrillIn(comics) {
  const ids = collectDrillInComicIds();
  if (!ids) return comics || [];
  return (comics || []).filter(c => c && ids.has(c.id));
}

export function buildSmartListBreadcrumb(smartLabel) {
  const showRootFolderList = state.showRootFolderList || window.showRootFolderList;
  const showPublisherList = state.showPublisherList || window.showPublisherList;
  const showSeriesList = state.showSeriesList || window.showSeriesList;
  const showComicList = state.showComicList || window.showComicList;

  const currentRootFolder = state.currentRootFolder || window.currentRootFolder;
  const currentPublisher = state.currentPublisher || window.currentPublisher;
  const currentSeries = state.currentSeries || window.currentSeries;

  const crumbs = [{ label: 'Libraries', action: () => { if (typeof showRootFolderList === 'function') showRootFolderList({ force: true }); } }];
  if (currentRootFolder) {
    const libraryNames = state.LIBRARY_NAMES || window.LIBRARY_NAMES || {};
    const libLabel = libraryNames[currentRootFolder] || libraryNames[currentRootFolder.replace(/[\\\/]+$/, '')] || currentRootFolder.split(/[\\\/]/).pop() || currentRootFolder;
    crumbs.push({ label: libLabel, action: () => { if (typeof showPublisherList === 'function') showPublisherList(currentRootFolder, { force: true }); } });
  }
  if (currentPublisher) {
    crumbs.push({ label: currentPublisher, action: () => { if (typeof showSeriesList === 'function') showSeriesList(currentPublisher, { force: true }); } });
  }
  if (currentSeries) {
    crumbs.push({ label: currentSeries, action: () => { if (typeof showComicList === 'function') showComicList(currentSeries); } });
  }
  crumbs.push({ label: smartLabel });
  return crumbs;
}

export function showLatestAddedSmartList() {
  state.currentView = 'latest';
  window.currentView = 'latest';
  
  const updateBreadcrumb = state.updateBreadcrumb || window.updateBreadcrumb;
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('New'));
  }
  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  if (typeof SmartLists.rebuildLatestComics === 'function') {
    SmartLists.rebuildLatestComics();
  }
  renderLatestSmartList();
}

export async function showDownloadedSmartList() {
  state.currentView = 'downloaded';
  window.currentView = 'downloaded';

  clearSmartFilterButtons();
  setDownloadedButtonActive(true);
  
  const updateBreadcrumb = state.updateBreadcrumb || window.updateBreadcrumb;
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('Down'));
  }

  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Down';
  }

  if (smartListContainer) {
    smartListContainer.innerHTML = createLoadingMessage('Loading downloaded comics...');
  }

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  if (typeof SmartLists.rebuildDownloadedComics === 'function') {
    await SmartLists.rebuildDownloadedComics({ skipRender: true });
  }
  renderDownloadedSmartList();
}

export function renderLatestSmartList() {
  if (!smartListContainer) return;

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const latestComics = scopeListByDrillIn(SmartLists.getLatestComics ? SmartLists.getLatestComics() : []);

  clearSmartFilterButtons();
  setLatestButtonActive(true);
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'New';
  }

  const days = SmartLists.LATEST_ADDED_DAYS || 14;

  if (!Array.isArray(latestComics) || latestComics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage(`No comics added in the last ${days} days.`);
    return;
  }

  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  const getComicStatus = state.getComicStatus || window.getComicStatus || (() => 'unread');

  let comicsToRender = latestComics;
  if (activeFilter === 'in-progress') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    let message = `No comics added in the last ${days} days.`;
    if (activeFilter === 'in-progress') {
      message = `No comics in progress from the last ${days} days.`;
    } else if (activeFilter === 'read') {
      message = `No comics read from the last ${days} days.`;
    } else if (activeFilter === 'unread') {
      message = `No unread comics from the last ${days} days.`;
    }
    smartListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  const renderComicCards = state.renderComicCards || window.renderComicCards;
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

export function renderDownloadedSmartList() {
  if (!smartListContainer) return;

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const downloadedSmartListError = typeof SmartLists.getDownloadedSmartListError === 'function' ? SmartLists.getDownloadedSmartListError() : null;
  const downloadedSmartListComics = scopeListByDrillIn(SmartLists.getDownloadedSmartListComics ? SmartLists.getDownloadedSmartListComics() : []);

  clearSmartFilterButtons();
  setDownloadedButtonActive(true);
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Down';
  }

  if (downloadedSmartListError) {
    smartListContainer.innerHTML = createErrorMessage('Failed to load downloaded comics.');
    return;
  }

  if (!Array.isArray(downloadedSmartListComics) || downloadedSmartListComics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage('No comics downloaded for offline use.');
    return;
  }

  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  const getComicStatus = state.getComicStatus || window.getComicStatus || (() => 'unread');

  let comicsToRender = downloadedSmartListComics;
  if (activeFilter === 'in-progress') {
    comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = downloadedSmartListComics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    let message = 'No comics downloaded for offline use.';
    if (activeFilter === 'in-progress') {
      message = 'No downloaded comics in progress.';
    } else if (activeFilter === 'read') {
      message = 'No downloaded comics marked as read.';
    } else if (activeFilter === 'unread') {
      message = 'No unread downloaded comics.';
    }
    smartListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  const renderComicCards = state.renderComicCards || window.renderComicCards;
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

export function showGuidedSmartList() {
  state.currentView = 'guided';
  window.currentView = 'guided';
  
  const updateBreadcrumb = state.updateBreadcrumb || window.updateBreadcrumb;
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb('Guide'));
  }
  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  if (typeof SmartLists.rebuildGuidedComics === 'function') {
    SmartLists.rebuildGuidedComics();
  }
  renderGuidedSmartList();
}

export function renderGuidedSmartList() {
  if (!smartListContainer) return;

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const guidedComics = scopeListByDrillIn(SmartLists.getGuidedComics ? SmartLists.getGuidedComics() : []);

  clearSmartFilterButtons();
  setGuidedButtonActive(true);
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Guide';
  }

  if (!Array.isArray(guidedComics) || guidedComics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage('No comics with completed guided reading.');
    return;
  }

  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  const getComicStatus = state.getComicStatus || window.getComicStatus || (() => 'unread');

  let comicsToRender = guidedComics;
  if (activeFilter === 'in-progress') {
    comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = guidedComics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    let message = 'No comics with completed guided reading.';
    if (activeFilter === 'in-progress') {
      message = 'No guided comics in progress.';
    } else if (activeFilter === 'read') {
      message = 'No guided comics marked as read.';
    } else if (activeFilter === 'unread') {
      message = 'No unread guided comics.';
    }
    smartListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  const renderComicCards = state.renderComicCards || window.renderComicCards;
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

export function showMangaSmartList() {
  state.currentView = 'manga';
  window.currentView = 'manga';
  
  const isMangaDefault = !!(state.mangaModePreference === true || state.mangaModePreference == 1 || window.mangaModePreference === true || window.mangaModePreference == 1);
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  
  const updateBreadcrumb = state.updateBreadcrumb || window.updateBreadcrumb;
  if (typeof updateBreadcrumb === 'function') {
    updateBreadcrumb(buildSmartListBreadcrumb(label));
  }
  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  if (typeof SmartLists.rebuildMangaSmartLists === 'function') {
    SmartLists.rebuildMangaSmartLists();
  }
  renderMangaSmartList();
}

export function renderMangaSmartList() {
  if (!smartListContainer) return;

  const isMangaDefault = !!(state.mangaModePreference === true || state.mangaModePreference == 1 || window.mangaModePreference === true || window.mangaModePreference == 1);
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const comics = scopeListByDrillIn((isMangaDefault ? (SmartLists.getNonMangaComics ? SmartLists.getNonMangaComics() : []) : (SmartLists.getMangaComics ? SmartLists.getMangaComics() : [])));

  clearSmartFilterButtons();
  setMangaFilterButtonActive(true);
  
  const showView = state.showView || window.showView;
  if (typeof showView === 'function') {
    showView(smartListView);
  }
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = label;
  }

  if (!Array.isArray(comics) || comics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage(
      isMangaDefault ? 'No non-manga comics in your library.' : 'No manga comics in your library.'
    );
    return;
  }

  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  const getComicStatus = state.getComicStatus || window.getComicStatus || (() => 'unread');

  let comicsToRender = comics;
  if (activeFilter === 'in-progress') {
    comicsToRender = comics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = comics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = comics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    const base = isMangaDefault ? 'non-manga' : 'manga';
    let message = `No ${base} comics in your library.`;
    if (activeFilter === 'in-progress') {
      message = `No ${base} comics in progress.`;
    } else if (activeFilter === 'read') {
      message = `No ${base} comics marked as read.`;
    } else if (activeFilter === 'unread') {
      message = `No unread ${base} comics.`;
    }
    smartListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  const renderComicCards = state.renderComicCards || window.renderComicCards;
  if (typeof renderComicCards === 'function') {
    renderComicCards(comicsToRender, 'smart-list');
  }
}

const LibrarySmartFilters = {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  clearSmartFilterButtons,
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  hideSmartFilterHost,
  collectDrillInComicIds,
  scopeListByDrillIn,
  buildSmartListBreadcrumb,
  showLatestAddedSmartList,
  showDownloadedSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  showGuidedSmartList,
  renderGuidedSmartList,
  showMangaSmartList,
  renderMangaSmartList
};

state.LibrarySmartFilters = LibrarySmartFilters;
Object.assign(state, LibrarySmartFilters);

if (typeof window !== 'undefined') {
  window.LibrarySmartFilters = LibrarySmartFilters;
  Object.assign(window, LibrarySmartFilters);
}

