(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};
  const Data = global.LibraryData || {};

  let lastSearchQuery = '';
  let lastSearchField = 'all';
  let lastSearchResults = null;

function setLatestButtonActive(isActive) {
  if (!latestAddedButton) return;
  latestAddedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  latestAddedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  latestAddedButton.classList.toggle('bg-gray-700', !isActive);
  latestAddedButton.classList.toggle('hover:bg-gray-600', !isActive);
  latestAddedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}


function setDownloadedButtonActive(isActive) {
  if (!downloadedButton) return;
  downloadedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  downloadedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  downloadedButton.classList.toggle('bg-gray-700', !isActive);
  downloadedButton.classList.toggle('hover:bg-gray-600', !isActive);
  downloadedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}


function setGuidedButtonActive(isActive) {
  const btn = document.getElementById('guided-smart-list-btn');
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}


function setMangaFilterButtonActive(isActive) {
  const btn = document.getElementById('dynamic-manga-filter-btn');
  if (!btn) return;
  btn.classList.toggle('bg-purple-600', Boolean(isActive));
  btn.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  btn.classList.toggle('bg-gray-700', !isActive);
  btn.classList.toggle('hover:bg-gray-600', !isActive);
  btn.setAttribute('aria-pressed', String(Boolean(isActive)));
}


function clearSmartFilterButtons() {
  setLatestButtonActive(false);
  setDownloadedButtonActive(false);
  setGuidedButtonActive(false);
  setMangaFilterButtonActive(false);
}

// Activate whichever pill matches the active smart-filter scope, deactivate the others.
// Use this on navigation (drill in/out) so the active scope pill stays purple while browsing.
// Also shows/hides the list/folder render-mode toggle (only meaningful when a scope is active).
function syncSmartFilterButtons() {
  const scope = global.activeSmartFilter || null;
  setLatestButtonActive(scope === 'latest');
  setDownloadedButtonActive(scope === 'downloaded');
  setGuidedButtonActive(scope === 'guided');
  setMangaFilterButtonActive(scope === 'manga' || scope === 'non-manga');
  const modeToggle = document.getElementById('smart-scope-mode-toggle');
  if (modeToggle) {
    const isFilterActive = typeof activeFilter !== 'undefined' && activeFilter !== 'all';
    modeToggle.classList.toggle('hidden', !scope && !isFilterActive);
  }
}

// Move the persistent #smart-filter-host into the active view's `.smart-filter-mount` slot
// so the smart pill row always renders directly beneath that view's title.
function mountSmartFilterHostInto(viewElement) {
  const host = document.getElementById('smart-filter-host');
  if (!host || !viewElement) return;
  const slot = viewElement.querySelector('.smart-filter-mount');
  if (!slot) return;
  if (host.parentElement !== slot) {
    slot.appendChild(host);
  }
  host.classList.remove('hidden');
}

// Hide the smart-filter pill row entirely. Used at the root (Libraries) view
// where smart filters don't make sense yet — the user picks a library first.
function hideSmartFilterHost() {
  const host = document.getElementById('smart-filter-host');
  if (host) host.classList.add('hidden');
}

// Return the set of comic IDs that fall under the current drill-in level
// (currentRootFolder / currentPublisher / currentSeries). Returns null when no
// drill-in is active, signalling "use the whole library".
function collectDrillInComicIds() {
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

// Filter a smart-list comic array to only those under the current drill-in level.
// When at library root, returns the array unchanged.
function scopeListByDrillIn(comics) {
  const ids = collectDrillInComicIds();
  if (!ids) return comics || [];
  return (comics || []).filter(c => c && ids.has(c.id));
}

// Build the breadcrumb path for the current drill-in (Libraries > Library > Publisher > Series),
// then append the given smart-list label.
function buildSmartListBreadcrumb(smartLabel) {
  const crumbs = [{ label: 'Libraries', action: () => showRootFolderList({ force: true }) }];
  if (currentRootFolder) {
    const libLabel = currentRootFolder.split(/[\\\/]/).pop();
    crumbs.push({ label: libLabel, action: () => showPublisherList(currentRootFolder, { force: true }) });
  }
  if (currentPublisher) {
    crumbs.push({ label: currentPublisher, action: () => showSeriesList(currentPublisher, { force: true }) });
  }
  if (currentSeries) {
    crumbs.push({ label: currentSeries, action: () => showComicList(currentSeries) });
  }
  crumbs.push({ label: smartLabel });
  return crumbs;
}


function showLatestAddedSmartList() {
  currentView = 'latest';
  if (typeof window !== 'undefined') window.currentView = currentView;
  updateBreadcrumb(buildSmartListBreadcrumb('New'));
  SmartLists.rebuildLatestComics();
  renderLatestSmartList();
}


async function showDownloadedSmartList() {
  currentView = 'downloaded';
  if (typeof window !== 'undefined') window.currentView = currentView;

  clearSmartFilterButtons();
  setDownloadedButtonActive(true);
  updateBreadcrumb(buildSmartListBreadcrumb('Down'));

  showView(smartListView);
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Down';
  }

  if (smartListContainer) {
    smartListContainer.innerHTML = createLoadingMessage('Loading downloaded comics...');
  }

  await SmartLists.rebuildDownloadedComics({ skipRender: true });
  renderDownloadedSmartList();
}

function renderLatestSmartList() {
  if (!smartListContainer) return;

  const latestComics = scopeListByDrillIn(SmartLists.getLatestComics() || []);

  clearSmartFilterButtons();
  setLatestButtonActive(true);
  showView(smartListView);
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'New';
  }

  if (!Array.isArray(latestComics) || latestComics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage(`No comics added in the last ${SmartLists.LATEST_ADDED_DAYS} days.`);
    return;
  }

  let comicsToRender = latestComics;
  if (activeFilter === 'in-progress') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = latestComics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    let message = `No comics added in the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
    if (activeFilter === 'in-progress') {
      message = `No comics in progress from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
    } else if (activeFilter === 'read') {
      message = `No comics read from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
    } else if (activeFilter === 'unread') {
      message = `No unread comics from the last ${SmartLists.LATEST_ADDED_DAYS} days.`;
    }
    smartListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  renderComicCards(comicsToRender, 'smart-list');
}


function renderDownloadedSmartList() {
  if (!smartListContainer) return;

  const downloadedSmartListError = SmartLists.getDownloadedSmartListError();
  const downloadedSmartListComics = scopeListByDrillIn(SmartLists.getDownloadedSmartListComics() || []);

  clearSmartFilterButtons();
  setDownloadedButtonActive(true);
  showView(smartListView);
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

  renderComicCards(comicsToRender, 'smart-list');
}


function showGuidedSmartList() {
  currentView = 'guided';
  if (typeof window !== 'undefined') window.currentView = currentView;
  updateBreadcrumb(buildSmartListBreadcrumb('Guide'));
  SmartLists.rebuildGuidedComics();
  renderGuidedSmartList();
}


function renderGuidedSmartList() {
  if (!smartListContainer) return;

  const guidedComics = scopeListByDrillIn(SmartLists.getGuidedComics() || []);

  clearSmartFilterButtons();
  setGuidedButtonActive(true);
  showView(smartListView);
  mountSmartFilterHostInto(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Guide';
  }

  if (!Array.isArray(guidedComics) || guidedComics.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage('No comics with completed guided reading.');
    return;
  }

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

  renderComicCards(comicsToRender, 'smart-list');
}


function showMangaSmartList() {
  currentView = 'manga';
  if (typeof window !== 'undefined') window.currentView = currentView;
  const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  updateBreadcrumb(buildSmartListBreadcrumb(label));
  SmartLists.rebuildMangaSmartLists();
  renderMangaSmartList();
}


function renderMangaSmartList() {
  if (!smartListContainer) return;

  const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
  const label = isMangaDefault ? 'Non-Manga' : 'Manga';
  const comics = scopeListByDrillIn((isMangaDefault ? SmartLists.getNonMangaComics() : SmartLists.getMangaComics()) || []);

  clearSmartFilterButtons();
  setMangaFilterButtonActive(true);
  showView(smartListView);
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

  renderComicCards(comicsToRender, 'smart-list');
}


function renderAllComicsAsList() {
  if (!library || !smartListContainer) return;
  
  const allComics = [];
  const rootFolders = currentRootFolder ? [currentRootFolder] : Object.keys(library);
  
  rootFolders.forEach(rootPath => {
    const rootData = library[rootPath];
    if (!rootData || !rootData.publishers) return;
    
    const publishers = currentPublisher ? [currentPublisher] : Object.keys(rootData.publishers);
    publishers.forEach(pubName => {
      const pubData = rootData.publishers[pubName];
      if (!pubData || !pubData.series) return;
      
      const seriesNames = currentSeries ? [currentSeries] : Object.keys(pubData.series);
      seriesNames.forEach(seriesName => {
        const comics = pubData.series[seriesName];
        if (Array.isArray(comics)) {
          allComics.push(...comics);
        }
      });
    });
  });

  showView(smartListView);
  mountSmartFilterHostInto(smartListView);
  
  if (smartListTitle) {
    if (currentSeries) smartListTitle.textContent = currentSeries;
    else if (currentPublisher) smartListTitle.textContent = currentPublisher;
    else if (currentRootFolder) {
      const label = currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder;
      smartListTitle.textContent = label;
    } else smartListTitle.textContent = 'All Comics';
  }

  const scope = global.activeSmartFilter || null;
  const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
  
  let comicsToRender = scope ? allComics.filter(matchesScope) : allComics;
  
  if (activeFilter === 'in-progress') {
    comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = comicsToRender.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    smartListContainer.innerHTML = createEmptyMessage('No comics found matching your filters.');
    return;
  }

  renderComicCards(comicsToRender, 'smart-list');
}


// Simplified function - rendering functions handle active status filters
function applyFilterAndRender() {
  updateFilterButtonCounts();

  if (currentView === 'comic' || global.currentView === 'comic') {
    return;
  }

  const mode = global.smartListViewMode || 'folders';
  const SMART_LIST_VIEWS = ['latest', 'downloaded', 'guided', 'manga', 'non-manga'];

  // If in list mode and not currently in a specific flat view or search,
  // render the current context as a flat list.
  if (mode === 'list' && !SMART_LIST_VIEWS.includes(currentView) && currentView !== 'search' && currentView !== 'folder') {
    return renderAllComicsAsList();
  }

  switch (currentView) {
    case 'publishers':
      showPublisherList(currentRootFolder, { force: true });
      break;
    case 'series':
      showSeriesList(currentPublisher, { force: true });
      break;
    case 'comics':
      showComicList(currentSeries);
      break;
    case 'folder':
      if (typeof global.showFolderView === 'function') {
        global.showFolderView(global.currentFolderPath, { force: true });
      } else {
        showRootFolderList({ force: true });
      }
      break;
    case 'latest':
      renderLatestSmartList();
      break;
    case 'downloaded':
      renderDownloadedSmartList();
      break;
    case 'guided':
      renderGuidedSmartList();
      break;
    case 'manga':
      renderMangaSmartList();
      break;
    case 'search':
      rerenderSearchResults();
      break;
    default:
      showRootFolderList({ force: true });
  }
}

function renderAlphaFilter(targetDiv, data, renderFn, type) {
  targetDiv.innerHTML = '';
  const characters = ['All', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  characters.forEach(char => {
    const button = document.createElement('button');
    button.className = 'alpha-filter-btn';
    if (char === 'All') { button.classList.add('active'); button.style.width = '2.5rem'; }
    button.textContent = char;
    button.addEventListener('click', (e) => {
      targetDiv.querySelectorAll('.alpha-filter-btn').forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');

      if (char === 'All') {
        renderFn(data);
        return;
      }

      if (type === 'comics') {
        const filteredData = data.filter(item => {
          const info = applyDisplayInfoToComic(item);
          const label = info.displayTitle || item.name || '';
          const firstChar = label.charAt(0).toUpperCase();
          return (char === '#' && !isNaN(parseInt(firstChar))) || (char === firstChar);
        });
        renderFn(filteredData);
      } else { // publishers, series
        const filteredData = {};
        for (const key in data) {
          const firstChar = key.charAt(0).toUpperCase();
          if ((char === '#' && !isNaN(parseInt(firstChar))) || (char === firstChar)) {
            filteredData[key] = data[key];
          }
        }
        renderFn(filteredData);
      }
    });
    targetDiv.appendChild(button);
  });
}

function getComicStatus(comic) {
  const progress = comic?.progress || {};
  const total = progress.totalPages || 0;
  const lastRead = progress.lastReadPage || 0;

  if (total > 0) {
    if (lastRead >= total - 1) {
      return 'read';
    }
    if (lastRead > 0) {
      return 'in-progress';
    }
  } else if (lastRead > 0) {
    return 'in-progress';
  }

  return 'unread';
}

function getSeriesStatus(comicsInSeries) {
  if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) {
    return 'unread';
  }

  let allRead = true;
  let anyProgress = false;

  for (const comic of comicsInSeries) {
    const status = getComicStatus(comic);
    if (status !== 'read') {
      allRead = false;
    }
    if (status !== 'unread') {
      anyProgress = true;
    }

    if (!allRead && anyProgress) {
      break;
    }
  }

  if (allRead) {
    return 'read';
  }
  if (anyProgress) {
    return 'in-progress';
  }
  return 'unread';
}

function getComicStatusCounts(comicsInSeries) {
  const scope = global.activeSmartFilter || null;
  const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);

  // Pre-computed counts from lazy loading don't know about smart scope; bypass them
  // when a scope is active so we recompute against the actual comic list.
  if (!scope && comicsInSeries && typeof comicsInSeries === 'object' && !Array.isArray(comicsInSeries) && comicsInSeries._counts) {
    return comicsInSeries._counts;
  }

  const rawComics = Array.isArray(comicsInSeries) ? comicsInSeries : [];
  const comics = scope ? rawComics.filter(matchesScope) : rawComics;
  const counts = {
    total: comics.length,
    inProgress: 0,
    read: 0,
    unread: 0,
  };

  for (const comic of comics) {
    const status = getComicStatus(comic);
    if (status === 'read') {
      counts.read += 1;
    } else if (status === 'in-progress') {
      counts.inProgress += 1;
    } else {
      counts.unread += 1;
    }
  }

  return counts;
}

function createEmptyStatusCounts() {
  return { total: 0, inProgress: 0, read: 0, unread: 0 };
}

function addStatusCounts(target, addition) {
  if (!target) {
    target = createEmptyStatusCounts();
  }
  if (addition) {
    target.total += addition.total || 0;
    target.inProgress += addition.inProgress || 0;
    target.read += addition.read || 0;
    target.unread += addition.unread || 0;
  }
  return target;
}

function getPublisherStatusCounts(publisherData = {}) {
  // Pre-computed counts don't know about smart scope; bypass when a scope is active.
  if (!global.activeSmartFilter && publisherData._counts) {
    return publisherData._counts;
  }

  const counts = createEmptyStatusCounts();
  const seriesEntries = publisherData.series || {};
  for (const comics of Object.values(seriesEntries)) {
    const seriesCounts = getComicStatusCounts(Array.isArray(comics) ? comics : []);
    addStatusCounts(counts, seriesCounts);
  }
  return counts;
}

function getRootStatusCounts(rootData = {}) {
  const counts = createEmptyStatusCounts();
  const publishers = rootData.publishers || {};
  for (const publisherData of Object.values(publishers)) {
    const publisherCounts = getPublisherStatusCounts(publisherData);
    addStatusCounts(counts, publisherCounts);
  }
  return counts;
}

function getLibraryStatusCounts(libraryData = {}) {
  const counts = createEmptyStatusCounts();
  if (!libraryData || typeof libraryData !== 'object') {
    return counts;
  }
  for (const rootData of Object.values(libraryData)) {
    const rootCounts = getRootStatusCounts(rootData);
    addStatusCounts(counts, rootCounts);
  }
  return counts;
}

function statusCountsMatchFilter(counts = createEmptyStatusCounts()) {
  if (activeFilter === 'in-progress') {
    return (counts.inProgress || 0) > 0;
  }
  if (activeFilter === 'read') {
    return (counts.read || 0) > 0;
  }
  if (activeFilter === 'unread') {
    return (counts.unread || 0) > 0;
  }
  // 'all': drop empty entries when a smart scope is active so we don't show
  // root folders / publishers / series that have nothing in scope.
  if (global.activeSmartFilter) {
    return (counts.total || 0) > 0;
  }
  return true;
}

function filterPublishersByActiveFilter(publishers = {}) {
  const scope = global.activeSmartFilter || null;
  if (activeFilter === 'all' && !scope) {
    return publishers;
  }

  const filtered = {};
  for (const [publisherName, publisherData] of Object.entries(publishers)) {
    const counts = getPublisherStatusCounts(publisherData);
    // When a scope is active, drop publishers with zero in-scope total.
    if (scope && (counts.total || 0) === 0) continue;
    if (statusCountsMatchFilter(counts)) {
      filtered[publisherName] = publisherData;
    }
  }
  return filtered;
}

function filterSeriesByActiveFilter(seriesEntries = {}) {
  const scope = global.activeSmartFilter || null;
  if (activeFilter === 'all' && !scope) {
    return seriesEntries;
  }

  const filtered = {};
  for (const [seriesName, comics] of Object.entries(seriesEntries)) {
    const counts = getComicStatusCounts(comics);
    if (scope && (counts.total || 0) === 0) continue;
    if (statusCountsMatchFilter(counts)) {
      filtered[seriesName] = comics;
    }
  }
  return filtered;
}

let inProgressCountElement = null;
let readCountElement = null;
let unreadCountElement = null;

function updateFilterButtonCounts() {
  if (!inProgressCountElement) {
    inProgressCountElement = document.getElementById('in-progress-count');
  }

  if (!readCountElement) {
    readCountElement = document.getElementById('read-count');
  }

  if (!unreadCountElement) {
    unreadCountElement = document.getElementById('unread-count');
  }

  if (!inProgressCountElement && !readCountElement && !unreadCountElement) {
    return;
  }

  const counts = getLibraryStatusCounts(library);
  if (inProgressCountElement) {
    inProgressCountElement.textContent = counts.inProgress || 0;
  }
  if (readCountElement) {
    readCountElement.textContent = counts.read || 0;
  }
  if (unreadCountElement) {
    unreadCountElement.textContent = counts.unread || 0;
  }
}

function updateLibraryReadStatus({ rootFolder, publisher, seriesName, comicId, status }) {
  if (!library) return;

  // Invalidate folder cache if it exists
  if (typeof global.invalidateFolderCache === 'function') {
    global.invalidateFolderCache();
  }

  const normalizedStatus = status === 'read' ? 'read' : 'unread';

  let statusUpdated = false;
  let downloadedStatusUpdated = false;

  const applyStatusToComic = (comic) => {
    if (!comic) return;

    if (!comic.progress) {
      comic.progress = { totalPages: 0, lastReadPage: 0 };
    }

    if (normalizedStatus === 'read') {
      if (!comic.progress.totalPages || comic.progress.totalPages <= 0) {
        comic.progress.totalPages = Math.max(comic.pageCount || 0, 1);
      }
      const total = comic.progress.totalPages || 1;
      comic.progress.lastReadPage = Math.max(total - 1, 0);
    } else {
      comic.progress.lastReadPage = 0;
      if (!comic.progress.totalPages || comic.progress.totalPages <= 1) {
        comic.progress.totalPages = 0;
      }
    }
    if (SmartLists.syncDownloadedComicStatusFromLibrary(comic, normalizedStatus)) {
      downloadedStatusUpdated = true;
    }
    statusUpdated = true;
  };

  if (rootFolder && publisher && seriesName) {
    const comics = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
    if (Array.isArray(comics)) {
      comics.forEach(applyStatusToComic);
    }
    if (statusUpdated) {
      updateFilterButtonCounts();
    }
    if (downloadedStatusUpdated && currentView === 'downloaded') {
      renderDownloadedSmartList();
    }
    return;
  }

  const targetId = String(comicId);
  if (!targetId) {
    return;
  }

  for (const rootData of Object.values(library)) {
    const publishers = rootData?.publishers || {};
    for (const publisherData of Object.values(publishers)) {
      const seriesEntries = publisherData?.series || {};
      for (const comics of Object.values(seriesEntries)) {
        if (!Array.isArray(comics)) continue;
        const comic = comics.find(c => String(c.id) === targetId);
        if (comic) {
          applyStatusToComic(comic);
          if (statusUpdated) {
            updateFilterButtonCounts();
          }
          if (downloadedStatusUpdated && currentView === 'downloaded') {
            renderDownloadedSmartList();
          }
          return;
        }
      }
    }
  }

  if (statusUpdated) {
    updateFilterButtonCounts();
  }
  if (downloadedStatusUpdated && currentView === 'downloaded') {
    renderDownloadedSmartList();
  }
}

function updateBreadcrumb(segments) {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;

  nav.innerHTML = '';

  if (!segments || segments.length === 0) {
    nav.classList.add('hidden');
    nav.classList.remove('flex');
    return;
  }

  nav.classList.remove('hidden');
  nav.classList.add('flex');

  segments.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'text-gray-600 select-none';
      sep.textContent = '/';
      nav.appendChild(sep);
    }

    const isLast = i === segments.length - 1;
    const isClickable = seg.action && (!isLast || segments.length === 1);

    if (isClickable) {
      const btn = document.createElement('button');
      btn.className = 'text-gray-400 hover:text-white transition-colors truncate max-w-[10rem] sm:max-w-[16rem]';
      btn.textContent = seg.label;
      btn.addEventListener('click', seg.action);
      nav.appendChild(btn);
    } else {
      const span = document.createElement('span');
      span.className = 'text-white font-medium truncate max-w-[10rem] sm:max-w-[16rem]';
      span.textContent = seg.label;
      nav.appendChild(span);
    }
  });
}

function makeCountChips(counts) {
  if (activeFilter === 'in-progress') {
    return `<div class="card-counts"><span class="card-count-chip in-progress">${counts.inProgress} in prog</span></div>`;
  } else if (activeFilter === 'read') {
    return `<div class="card-counts"><span class="card-count-chip read">${counts.read} read</span></div>`;
  } else if (activeFilter === 'unread') {
    return `<div class="card-counts"><span class="card-count-chip unread">${counts.unread} unread</span></div>`;
  }
  const chips = [];
  if (counts.total > 0) chips.push(`<span class="card-count-chip">${counts.total}</span>`);
  if (counts.unread > 0) chips.push(`<span class="card-count-chip unread">${counts.unread} unread</span>`);
  if (counts.inProgress > 0) chips.push(`<span class="card-count-chip in-progress">${counts.inProgress} prog</span>`);
  if (counts.read > 0) chips.push(`<span class="card-count-chip read">${counts.read} read</span>`);
  return `<div class="card-counts">${chips.join('')}</div>`;
}

function showRootFolderList(options = {}) {
  const force = Boolean(options.force);
  currentView = 'root';
  currentRootFolder = null;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  syncSmartFilterButtons();
  updateBreadcrumb([]);

  const rootFoldersFromLibrary = library ? Object.keys(library) : [];
  const rootFolders = [];
  const seen = new Set();

  const addRootFolder = (folderPath) => {
    if (!folderPath) return;
    const normalized = folderPath.replace(/[\\\/]+$/, '');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    rootFolders.push(folderPath);
  };

  if (Array.isArray(configuredRootFolders) && configuredRootFolders.length > 0) {
    configuredRootFolders.forEach(addRootFolder);
  }
  rootFoldersFromLibrary.forEach(addRootFolder);

  const rootCards = rootFolders.map(folderPath => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const folderName = (window.LIBRARY_NAMES && window.LIBRARY_NAMES[normalizedPath]) || normalizedPath.split(/[\\\/]/).pop() || normalizedPath;
    
    // Use normalization-aware lookup for library data
    const rootData = library?.[folderPath] || library?.[normalizedPath] || library?.[normalizedPath + '/'];
    
    const publisherCount = rootData?.publishers ? Object.keys(rootData.publishers).length : 0;
    const publisherLabel = publisherCount === 1 ? 'Publisher' : 'Publishers';
    const counts = getRootStatusCounts(rootData);
    return { folderPath, folderName, publisherCount, publisherLabel, counts };
  });

  const visibleRootCards = rootCards.filter(card => statusCountsMatchFilter(card.counts));

  if (visibleRootCards.length === 1 && !force) {
    const cardData = visibleRootCards[0];
    const normalizedPath = cardData.folderPath.replace(/[\\\/]+$/, '');
    const actualKey = library?.[cardData.folderPath] ? cardData.folderPath : (library?.[normalizedPath] ? normalizedPath : (library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
    const rootData = actualKey ? library[actualKey] : null;
    const mode = rootData?.hierarchyMode || 'metadata';
    
    currentRootFolder = actualKey;
    if (typeof window !== 'undefined') window.currentRootFolder = currentRootFolder;
    
    if (mode === 'folder' && typeof global.showFolderView === 'function') {
      global.showFolderView(cardData.folderPath);
    } else {
      showPublisherList(cardData.folderPath);
    }
    return;
  }

  showView(rootFolderListDiv);
  if (global.activeSmartFilter) {
    mountSmartFilterHostInto(rootFolderListDiv);
  } else {
    hideSmartFilterHost();
  }

  if (!rootFolderListContainer) return;

  rootFolderListContainer.innerHTML = '';

  if (visibleRootCards.length === 0) {
    const message = activeFilter === 'in-progress'
      ? 'No comics in progress.'
      : activeFilter === 'read'
        ? 'No comics read.'
        : activeFilter === 'unread'
          ? 'No unread comics.'
          : 'No comics found.';
    rootFolderListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  visibleRootCards.forEach(({ folderPath, folderName, publisherCount, publisherLabel, counts }) => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const rootData = library?.[folderPath] || library?.[normalizedPath] || library?.[normalizedPath + '/'];

    // Get all comics from all publishers and all series under this library
    let allComics = [];
    if (rootData && rootData.publishers) {
      for (const publisherName in rootData.publishers) {
        const publisherData = rootData.publishers[publisherName];
        if (publisherData && publisherData.series) {
          for (const seriesName in publisherData.series) {
            const comics = publisherData.series[seriesName];
            if (Array.isArray(comics)) {
              allComics = allComics.concat(comics);
            }
          }
        }
      }
    }

    // Check if all comics in the library are manga
    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    // Check if all comics in the library are downloaded
    let isLibraryDownloaded = false;
    if (allComics.length > 0) {
      isLibraryDownloaded = allComics.every(comic => downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isLibraryDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isLibraryDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isLibraryDownloaded ? 'Delete from device' : 'Download library'}"
          data-folder-path="${folderPath}"
          data-is-downloaded="${isLibraryDownloaded}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'folder-card bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    card.setAttribute('data-library-path', folderPath);
    const countsHtml = makeCountChips(counts);

    // Deterministic image per library — stable within a day, rotates daily
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const libraryImageSeed = `${folderPath}|${dateKey}`;
    let libraryImageHash = 0;
    for (let i = 0; i < libraryImageSeed.length; i++) {
      libraryImageHash = ((libraryImageHash << 5) - libraryImageHash) + libraryImageSeed.charCodeAt(i);
      libraryImageHash |= 0;
    }
    const libraryImageIndex = Math.abs(libraryImageHash) % 11;
    const libraryImageName = libraryImageIndex === 0 ? 'Library.jpg' : `Library${libraryImageIndex}.jpg`;
    const libraryImageUrl = `${API_BASE_URL}/logos/${libraryImageName}`;

    card.innerHTML = `
      <div class="relative">
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        <div class="h-48 w-full bg-gray-700 rounded-lg overflow-hidden">
          <img src="${libraryImageUrl}" alt="${escapeHtml(folderName)}" class="w-full h-full object-cover">
        </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${escapeHtml(folderName)}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${publisherCount} ${publisherLabel}</p>
      ${countsHtml}
    `;
    
    card.addEventListener('click', () => {
      const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
      const actualKey = library?.[folderPath] ? folderPath : (library?.[normalizedPath] ? normalizedPath : (library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
      const rootData = actualKey ? library[actualKey] : null;
      const mode = rootData?.hierarchyMode || 'metadata';

      if (mode === 'folder') {
        if (typeof global.showFolderView === 'function') {
          global.showFolderView(folderPath);
        } else {
          showPublisherList(folderPath);
        }
      } else {
        showPublisherList(folderPath);
      }
    });

    // Add download button event handler
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete these ${allComics.length} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            for (const comic of allComics) {
              if (typeof global.deleteOfflineComic === 'function') {
                await global.deleteOfflineComic(comic.id);
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries(allComics, downloadBtn);
        }
      });
    }

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const libraryContextData = {
      folderPath,
      rootData
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof global.showLibraryContextMenu === 'function') {
        global.showLibraryContextMenu(e, libraryContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof global.showLibraryContextMenu === 'function') {
          contextMenuShown = true;
          global.showLibraryContextMenu(e, libraryContextData);
        }
      }, 500); // 500ms long press
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    rootFolderListContainer.appendChild(card);
  });

  // Device Library support
  if (global.DeviceLibrary) {
    // Add "Add Device Library" button
    const addCard = document.createElement('div');
    addCard.className = 'add-device-library-card bg-gray-800/50 rounded-lg overflow-hidden border-2 border-dashed border-gray-700 hover:border-purple-500 transition-all duration-300 cursor-pointer group flex flex-col items-center justify-center p-6 text-center h-full min-h-[200px]';
    addCard.innerHTML = `
      <div class="bg-gray-700/50 p-4 rounded-full mb-3 group-hover:bg-purple-900/30 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-gray-500 group-hover:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <div class="text-gray-400 font-bold group-hover:text-white">Add Device Library</div>
      <div class="text-xs text-gray-500 mt-1">Local CBZ/CBR folder</div>
    `;
    addCard.onclick = () => global.DeviceLibrary.requestDeviceLibrary();
    rootFolderListContainer.appendChild(addCard);

    // Render existing device libraries
    global.DeviceLibrary.appendDeviceLibraryCards(rootFolderListContainer);
  }
}


function showPublisherList(rootFolder, options = {}) {
  const force = Boolean(options.force);
  const normalizedPath = rootFolder ? rootFolder.replace(/[\\\/]+$/, '') : '';
  const actualKey = library?.[rootFolder] ? rootFolder : (library?.[normalizedPath] ? normalizedPath : (library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
  const rootData = actualKey ? library[actualKey] : null;

  if (!library || !rootData) {
    showRootFolderList({ force: true });
    return;
  }

  currentView = 'publishers';
  currentRootFolder = actualKey;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = 'publishers';
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  syncSmartFilterButtons();

  const publishers = rootData ? rootData.publishers : {};
  const publishersToRender = filterPublishersByActiveFilter(publishers);
  const publisherNames = Object.keys(publishersToRender);

  if (publisherNames.length === 1 && !force) {
    currentPublisher = publisherNames[0];
    if (typeof window !== 'undefined') window.currentPublisher = currentPublisher;
    showSeriesList(publisherNames[0]);
    return;
  }

  showView(publisherListDiv);
  mountSmartFilterHostInto(publisherListDiv);

  const folderLabel = currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder;
  if (publisherTitleH2) {
    publisherTitleH2.textContent = folderLabel;
  }

  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel }
  ]);

  renderAlphaFilter(publisherAlphaFilter, publishersToRender, renderPublisherCards, 'publishers');
  renderPublisherCards(publishersToRender);
}

function renderPublisherCards(publishersToShow) {
  publisherListContainer.innerHTML = '';
  const publishers = Object.keys(publishersToShow).sort();
  if (publishers.length === 0) {
    const msg = activeFilter === 'in-progress'
      ? 'No publishers in progress.'
      : activeFilter === 'read'
        ? 'No publishers read.'
        : activeFilter === 'unread'
          ? 'No unread publishers.'
          : 'No publishers found.';
    publisherListContainer.innerHTML = createEmptyMessage(msg);
    const backBtn = document.createElement('button');
    backBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backBtn.textContent = '← Libraries';
    backBtn.addEventListener('click', () => showRootFolderList({ force: true }));
    publisherListContainer.appendChild(backBtn);
    return;
  }
  for (const publisher of publishers) {
    const publisherData = publishersToShow[publisher] || {};
    const counts = getPublisherStatusCounts(publisherData);
    if (!statusCountsMatchFilter(counts)) {
      continue;
    }

    const countsChips = makeCountChips(counts);

    // Get all comics from all series under this publisher
    let allComics = [];
    if (publisherData.series) {
      for (const seriesName in publisherData.series) {
        const comics = publisherData.series[seriesName];
        if (Array.isArray(comics)) {
          allComics = allComics.concat(comics);
        }
      }
    }

    // Check if all comics in the publisher are manga
    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    // Read-status banner for the publisher: only show "Read" when every comic
    // is fully read. In-progress is intentionally NOT surfaced at publisher
    // level (too noisy — most publishers have something in progress).
    let publisherStatusBannerHtml = '';
    if (counts && counts.total > 0 && counts.read === counts.total) {
      publisherStatusBannerHtml = `<div class="status-banner status-read">Read</div>`;
    }
    const isPublisherRead = counts && counts.total > 0 && counts.read === counts.total;
    const publisherStatusIcon = isPublisherRead
      ? ICONS.READ
      : ICONS.UNREAD;
    const publisherStatusButtonHtml = `
      <button class="status-toggle-btn absolute top-2 left-2 ${isPublisherRead ? 'text-green-400' : 'text-gray-400'} hover:text-white"
              data-publisher-name="${escapeHtml(publisher)}"
              data-root-folder="${escapeHtml(currentRootFolder)}"
              title="Bulk Read/Unread">
        ${publisherStatusIcon}
      </button>`;

    // Check if all comics in the publisher are downloaded
    let isPublisherDownloaded = false;
    if (allComics.length > 0) {
      isPublisherDownloaded = allComics.every(comic => downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isPublisherDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isPublisherDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isPublisherDownloaded ? 'Delete from device' : 'Download publisher'}"
          data-publisher-name="${escapeHtml(publisher)}"
          data-root-folder="${escapeHtml(currentRootFolder)}"
          data-is-downloaded="${isPublisherDownloaded}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    const hasLogo = Boolean(publisherData.logoUrl);
    const needsLightBackground = Boolean(publisherData.logoNeedsBackground);
    const logoWrapperClasses = ['flex', 'items-center', 'justify-center', 'h-full', 'w-full'];
    if (needsLightBackground) {
      logoWrapperClasses.push('bg-gray-900', 'rounded-md', 'p-4');
    }
    const logoContent = hasLogo
      ? `<div class="${logoWrapperClasses.join(' ')}"><img src="${API_BASE_URL}/${publisherData.logoUrl}" alt="${escapeHtml(publisher)}" class="h-full w-full object-contain"></div>`
      : `<svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>`;
    card.innerHTML = `
      <div class="relative h-48 w-full bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
        ${publisherStatusBannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${publisherStatusButtonHtml}
        ${logoContent}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${escapeHtml(publisher)}</h3>
      ${countsChips}
    `;
    card.addEventListener('click', () => showSeriesList(publisher));

    // Add download button event handler
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete these ${allComics.length} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            for (const comic of allComics) {
              if (typeof global.deleteOfflineComic === 'function') {
                await global.deleteOfflineComic(comic.id);
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries(allComics, downloadBtn);
        }
      });
    }

    // Bulk read/unread dialog when the read-status icon is tapped. If only
    // lazy data is available (no comic objects), fetch each series' comics
    // first so the dialog can drive per-comic updates.
    const pubStatusBtn = card.querySelector('.status-toggle-btn');
    if (pubStatusBtn) {
      pubStatusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let comics = [];
        if (publisherData.series && typeof Data?.getSeriesComics === 'function') {
          for (const seriesName of Object.keys(publisherData.series)) {
            try {
              const sComics = await Data.getSeriesComics(currentRootFolder, publisher, seriesName);
              if (Array.isArray(sComics)) comics.push(...sComics);
            } catch (_) {}
          }
        } else {
          comics = allComics;
        }
        if (typeof global.openBulkReadStatusDialog === 'function') {
          global.openBulkReadStatusDialog(comics || [], `publisher "${publisher}"`);
        }
      });
    }

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const publisherContextData = {
      publisherName: publisher,
      publisherInfo: publisherData,
      rootFolder: currentRootFolder
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof global.showPublisherContextMenu === 'function') {
        global.showPublisherContextMenu(e, publisherContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof global.showPublisherContextMenu === 'function') {
          contextMenuShown = true;
          global.showPublisherContextMenu(e, publisherContextData);
        }
      }, 500); // 500ms long press
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    publisherListContainer.appendChild(card);
  }
}

function showSeriesList(publisherName, options = {}) {
  const force = Boolean(options.force);
  if (!publisherName) return;

  currentView = 'series';
  currentPublisher = publisherName;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = 'series';
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  syncSmartFilterButtons();

  const normalizedPath = currentRootFolder ? currentRootFolder.replace(/[\\\/]+$/, '') : '';
  const rootData = library?.[currentRootFolder] || library?.[normalizedPath] || library?.[normalizedPath + '/'];
  const publisherData = rootData?.publishers[publisherName];
  if (!publisherData) {
    showPublisherList(currentRootFolder, { force: true });
    return;
  }

  const seriesData = publisherData.series || {};
  const filteredSeries = filterSeriesByActiveFilter(seriesData);
  const seriesNames = Object.keys(filteredSeries);

  if (seriesNames.length === 1 && !force) {
    currentSeries = seriesNames[0];
    if (typeof window !== 'undefined') window.currentSeries = currentSeries;
    showComicList(seriesNames[0]);
    return;
  }

  showView(seriesListDiv);
  mountSmartFilterHostInto(seriesListDiv);

  if (seriesTitleH2) {
    seriesTitleH2.textContent = publisherName;
  }

  const folderLabel = currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder;
  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel, action: () => showPublisherList(currentRootFolder, { force: true }) },
    { label: publisherName },
  ]);

  renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderSeriesCards, 'series');
  renderSeriesCards(filteredSeries);
}
function renderSeriesCards(seriesToRender) {
  const container = document.getElementById('series-list-container');
  container.innerHTML = '';
  const sortedSeries = Object.keys(seriesToRender).sort();
  if (sortedSeries.length === 0) {
    const msg = activeFilter === 'in-progress'
      ? 'No series in progress.'
      : activeFilter === 'read'
        ? 'No series read.'
        : activeFilter === 'unread'
          ? 'No unread series.'
          : 'No series found.';
    container.innerHTML = createEmptyMessage(msg);
    const backToLibrariesBtn = document.createElement('button');
    backToLibrariesBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
    backToLibrariesBtn.textContent = '← Libraries';
    backToLibrariesBtn.addEventListener('click', () => showRootFolderList({ force: true }));
    container.appendChild(backToLibrariesBtn);

    const backToPublisherBtn = document.createElement('button');
    backToPublisherBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backToPublisherBtn.textContent = '← Publisher';
    backToPublisherBtn.addEventListener('click', () => showPublisherList(currentRootFolder));
    container.appendChild(backToPublisherBtn);
    return;
  }
  for (const seriesName of sortedSeries) {
    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';

    const comicsInSeries = seriesToRender[seriesName];

    // Handle both array format (full data) and object format (lazy loading)
    let statusCounts;
    if (Array.isArray(comicsInSeries)) {
      // Full data - sort the comics and get counts
      comicsInSeries.sort((a, b) => {
        const aInfo = applyDisplayInfoToComic(a);
        const bInfo = applyDisplayInfoToComic(b);
        const aTitle = aInfo.displayTitle || a.name || '';
        const bTitle = bInfo.displayTitle || b.name || '';
        return aTitle.localeCompare(bTitle, undefined, { numeric: true });
      });
      statusCounts = getComicStatusCounts(comicsInSeries);
    } else if (comicsInSeries && comicsInSeries._counts) {
      // Lazy loading data - use pre-computed counts
      statusCounts = comicsInSeries._counts;
    } else {
      // Fallback - empty counts
      statusCounts = createEmptyStatusCounts();
    }

    if (!statusCountsMatchFilter(statusCounts)) {
      continue;
    }

    const countsChips = makeCountChips(statusCounts);

    let imageHtml;
    let isSeriesRead = false;
    let isSeriesDownloaded = false;

    if (Array.isArray(comicsInSeries)) {
      // Full data - can access comic details
      const firstComicWithThumb = comicsInSeries.find(c => c.thumbnailPath);
      if (firstComicWithThumb) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${firstComicWithThumb.thumbnailPath}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image">`;
      }

      // Determine overall read status for the series
      isSeriesRead = comicsInSeries.every(comic => {
        const progress = comic.progress;
        const total = progress.totalPages || 0;
        const lastRead = progress.lastReadPage || 0;
        return total > 0 && lastRead >= total - 1;
      });

      // Determine if all comics in the series are downloaded
      isSeriesDownloaded = comicsInSeries.every(comic => downloadedComicIds.has(comic.id));
    } else if (comicsInSeries && comicsInSeries._counts) {
      // Lazy loading - use pre-computed counts and thumbnail
      if (comicsInSeries._firstThumbnail) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${comicsInSeries._firstThumbnail}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image">`;
      }

      // Use pre-computed counts to estimate status
      isSeriesRead = statusCounts.total > 0 && statusCounts.read === statusCounts.total;
      // Can't determine download status without full data
      isSeriesDownloaded = false;
    }

    if (!imageHtml) {
      imageHtml = `<div class="h-48 w-full bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
        <svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>
      </div>`;
    }

    // Choose icons similar to individual comic cards
    const statusIcon = isSeriesRead
      ? ICONS.READ
      : ICONS.UNREAD;

    const statusButtonHtml = `
      <button
        class="status-toggle-btn absolute top-2 left-2 ${isSeriesRead ? 'text-green-400' : 'text-gray-400'} hover:text-white"
        data-series-name="${escapeHtml(seriesName)}"
        data-publisher="${escapeHtml(currentPublisher)}"
        data-root-folder="${escapeHtml(currentRootFolder)}"
        data-current-status="${isSeriesRead ? 'read' : 'unread'}"
        title="Toggle Read Status"
      >
        ${statusIcon}
      </button>`;

    const downloadIcon = isSeriesDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isSeriesDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isSeriesDownloaded ? 'Delete from device' : 'Download series'}"
          data-series-name="${escapeHtml(seriesName)}"
          data-publisher="${escapeHtml(currentPublisher)}"
          data-root-folder="${escapeHtml(currentRootFolder)}"
          data-is-downloaded="${isSeriesDownloaded}"
        >${downloadIcon}</button>`;

    let bannerHtml = getSeriesStatusBanner(comicsInSeries);

    // Check if all comics in the series are manga
    let allComicsAreManga = false;
    if (Array.isArray(comicsInSeries) && comicsInSeries.length > 0) {
      allComicsAreManga = comicsInSeries.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    card.innerHTML = `
      <div class="relative">
        ${bannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${statusButtonHtml}
        ${imageHtml}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${escapeHtml(seriesName)}</h3>
      ${countsChips}
    `;
    card.addEventListener('click', () => showComicList(seriesName));

    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        // Ensure we have full comic objects for deletion/download
        let comics = comicsInSeries;
        if (!Array.isArray(comics) && typeof Data?.getSeriesComics === 'function') {
          downloadBtn.disabled = true;
          comics = await Data.getSeriesComics(currentRootFolder, currentPublisher, seriesName);
          downloadBtn.disabled = false;
        }

        if (isDownloaded) {
          if (confirm(`Delete these ${Array.isArray(comics) ? comics.length : 'selected'} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            if (Array.isArray(comics)) {
              for (const comic of comics) {
                if (typeof global.deleteOfflineComic === 'function') {
                  await global.deleteOfflineComic(comic.id);
                }
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries(comics, downloadBtn);
        }
      });
    }

    const statusBtn = card.querySelector('.status-toggle-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (statusBtn.disabled) return;
        // Series card may carry lazy data — fetch full comics so the bulk dialog
        // can show real read/in-progress/unread counts and apply per-comic.
        let comics = comicsInSeries;
        if (!Array.isArray(comics) && typeof Data?.getSeriesComics === 'function') {
          try {
            comics = await Data.getSeriesComics(currentRootFolder, currentPublisher, seriesName);
          } catch (_) { comics = []; }
        }
        if (typeof global.openBulkReadStatusDialog === 'function') {
          global.openBulkReadStatusDialog(comics || [], `series "${seriesName}"`);
        }
      });
    }

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const seriesContextData = {
      seriesName,
      comicsInSeries,
      rootFolder: currentRootFolder,
      publisher: currentPublisher
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof global.showSeriesContextMenu === 'function') {
        global.showSeriesContextMenu(e, seriesContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof global.showSeriesContextMenu === 'function') {
          contextMenuShown = true;
          global.showSeriesContextMenu(e, seriesContextData);
        }
      }, 500); // 500ms long press
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    container.appendChild(card);
  }
}

function getSeriesStatusBanner(comicsInSeries) {
  const status = getSeriesStatus(comicsInSeries);
  if (status === 'read') {
    return `<div class="status-banner status-read">Read</div>`;
  }
  if (status === 'in-progress') {
    return `<div class="status-banner status-in-progress">In Progress</div>`;
  }
  return '';
}

async function showComicList(seriesName) {
  currentView = 'comics';
  currentSeries = seriesName;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentSeries = currentSeries;
  }
  syncSmartFilterButtons();

  showView(comicListDiv);
  mountSmartFilterHostInto(comicListDiv);

  if (comicListTitleH2) {
    comicListTitleH2.textContent = seriesName;
  }

  const libLabelComic = currentRootFolder ? currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || currentRootFolder : '';
  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    ...(libLabelComic ? [{ label: libLabelComic, action: () => showPublisherList(currentRootFolder, { force: true }) }] : []),
    { label: currentPublisher, action: () => showSeriesList(currentPublisher, { force: true }) },
    { label: seriesName },
  ]);

  // Show loading message while fetching comics
  const container = document.getElementById('comic-list-container');
  if (container) {
    container.innerHTML = createLoadingMessage('Loading comics...');
  }

  try {
    // Use lazy loading to get series comics
    const comicsData = await Data.getSeriesComics(currentRootFolder, currentPublisher, currentSeries);

    const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
    const scoped = global.activeSmartFilter ? comicsData.filter(matchesScope) : comicsData;

    let comicsToRender = scoped;
    if (activeFilter === 'in-progress') {
      comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'unread');
    }

    renderAlphaFilter(comicAlphaFilter, comicsToRender, renderComicCards, 'comics');
    renderComicCards(comicsToRender);

  } catch (error) {
    
    if (container) {
      container.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading comics. Please try again.</div>';
    }
  }
}


function renderComicCards(comicsToRender, viewType, targetContainer) {
  let container;
  if (targetContainer) {
    container = targetContainer;
  } else if (viewType === 'search') {
    container = searchResultsContainer;
  } else if (viewType === 'smart-list') {
    container = smartListContainer || document.getElementById('smart-list-container');
  } else {
    container = document.getElementById('comic-list-container');
  }

  container.innerHTML = '';
  if (comicsToRender.length === 0) {
    let msg;
    if (!viewType && activeFilter === 'in-progress') {
      msg = 'No comics in progress.';
    } else if (!viewType && activeFilter === 'read') {
      msg = 'No comics read.';
    } else if (!viewType && activeFilter === 'unread') {
      msg = 'No unread comics.';
    } else {
      msg = 'No comics found.';
    }
    container.innerHTML = createEmptyMessage(msg);
    if (!viewType) {
      const backToLibrariesBtn = document.createElement('button');
      backToLibrariesBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
      backToLibrariesBtn.textContent = '← Libraries';
      backToLibrariesBtn.addEventListener('click', () => showRootFolderList({ force: true }));
      container.appendChild(backToLibrariesBtn);

      const backToPublisherBtn = document.createElement('button');
      backToPublisherBtn.className = 'mt-4 mr-2 text-purple-400 hover:text-purple-300';
      backToPublisherBtn.textContent = '← Publisher';
      backToPublisherBtn.addEventListener('click', () => showPublisherList(currentRootFolder));
      container.appendChild(backToPublisherBtn);

      const backToSeriesBtn = document.createElement('button');
      backToSeriesBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
      backToSeriesBtn.textContent = '← Series';
      backToSeriesBtn.addEventListener('click', () => showSeriesList(currentPublisher, { force: true }));
      container.appendChild(backToSeriesBtn);
    }
    return;
  }
  comicsToRender.forEach((comic, index) => {
    const card = document.createElement('div');
    card.className = 'comic-card bg-gray-800 rounded-lg shadow-lg cursor-pointer flex flex-col border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    //... inside renderComicCards function
    const progress = comic.progress || {};
    const trackedTotalPages = Math.max(0, Number(progress.totalPages) || 0);
    const lastRead = Math.max(0, Number(progress.lastReadPage) || 0);

    const displayInfo = applyDisplayInfoToComic(comic);
    const displayTitle = displayInfo.displayTitle;
    const subtitleText = displayInfo.subtitle;

    const derivedTotalPages = (() => {
      if (trackedTotalPages > 0) return trackedTotalPages;
      const directTotal = Number(comic.totalPages);
      if (!Number.isNaN(directTotal) && directTotal > 0) return directTotal;
      const pageCount = Number(comic.pageCount);
      if (!Number.isNaN(pageCount) && pageCount > 0) return pageCount;
      return 0;
    })();

    const pageCountLabel = derivedTotalPages > 0 ? `p.${derivedTotalPages}` : '';
    const altText = displayInfo.altText;

    // Smart list debugging removed
    let bannerHtml = '';
    let isRead = false; // NEW: Define isRead here to use it for the button

    if (trackedTotalPages > 0) {
      isRead = lastRead >= trackedTotalPages - 1; // NEW: Assign the value here
      const isInProgress = lastRead > 0 && !isRead;
      if (isRead) {
        bannerHtml = `<div class="status-banner status-read">Read</div>`;
      } else if (isInProgress) {
        bannerHtml = `<div class="status-banner status-in-progress">In Progress</div>`;
      }
    }

    // Add manga mode banner
    const mangaBannerHtml = comic.mangaMode ? `<div class="status-banner status-manga">Manga</div>` : '';

    const progressPercent = trackedTotalPages > 0 ? (lastRead / trackedTotalPages) * 100 : 0;

    const isComicDownloaded = downloadedComicIds.has(comic.id);
    const downloadIcon = isComicDownloaded ? ICONS.READ : ICONS.DOWNLOAD;
    
    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isComicDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}" 
          data-comic-id="${comic.id}" 
          data-is-downloaded="${isComicDownloaded}"
          title="${isComicDownloaded ? 'Delete from device' : 'Download comic'}">
        ${downloadIcon}
      </button>`;

    // NEW: Add the read/unread toggle button HTML
    const toggleStatusIcon = isRead
      ? ICONS.READ
      : ICONS.UNREAD;

    const toggleStatusButtonHtml = `
      <button class="status-toggle-btn absolute top-2 left-2 ${isRead ? 'text-green-400' : 'text-gray-400'} hover:text-white" title="Toggle Read Status" data-comic-id="${comic.id}" data-current-status="${isRead ? 'read' : 'unread'}">
        ${toggleStatusIcon}
      </button>
    `;

    const titleIconHtml = isComicDownloaded
      ? `<span class="inline-block mb-0.5 mr-1 text-green-400" style="width: 0.75rem; height: 0.75rem;">${ICONS.READ}</span>`
      : '';

    card.innerHTML = `
      <div class="relative">
        ${bannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${toggleStatusButtonHtml}
        <img src="${comic.thumbnailPath ? `${API_BASE_URL}/thumbnails/${comic.thumbnailPath}` : 'https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover'}" alt="${escapeHtml(altText)}" class="comic-cover-image">
        ${pageCountLabel ? `<div class="page-count-badge">${pageCountLabel}</div>` : ''}
      </div>
      <div class="p-2 flex-grow flex flex-col justify-between">
        <div>
          <p class="text-sm font-semibold text-white truncate">${titleIconHtml}${escapeHtml(displayTitle)}</p>
          ${subtitleText ? `<p class="text-xs text-gray-300 truncate">${escapeHtml(subtitleText)}</p>` : ''}
        </div>
      </div>
      <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-700 rounded-b-lg">${progressPercent > 0 ? `<div class="${isRead ? 'bg-green-500' : 'bg-purple-500'} h-full rounded-b-lg transition-all duration-300" style="width: ${progressPercent}%;"></div>` : ''}</div>
    `;
// ...

    // Store comic data on the card element for context menu access
    card._comicData = comic;

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;

    card.addEventListener('contextmenu', (e) => {
      if (typeof global.showComicContextMenu === 'function') {
        global.showComicContextMenu(e, comic);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof global.showComicContextMenu === 'function') {
          contextMenuShown = true;
          global.showComicContextMenu(e, comic);
        }
      }, 500); // 500ms long press
    });

    card.addEventListener('touchend', (e) => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Prevent click if context menu was just shown
      if (contextMenuShown) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuShown = false;
      }
    });

    card.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    card.addEventListener('click', (event) => {
      const target = event.target;
      const clickDebugDetails = {
        comicId: comic?.id,
        comicPath: comic?.path,
        currentView,
        targetTag: target?.tagName,
        targetClasses: target?.className,
      };

      

      if (target instanceof Element) {
        const interactiveButton = target.closest('button.download-btn, button.status-toggle-btn');
        if (interactiveButton) {
          return;
        }
      }

      if (target.closest(".download-btn") || target.closest(".status-toggle-btn")) return;
      if (typeof window.openComicViewer === "function") window.openComicViewer(comic);
    });
    card.classList.add('cursor-pointer');
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isDownloaded = downloadBtn.dataset.isDownloaded === 'true';

        if (isDownloaded) {
          if (confirm(`Delete "${displayTitle}" from your device?`)) {
            downloadBtn.disabled = true;
            if (typeof global.deleteOfflineComic === 'function') {
              await global.deleteOfflineComic(comic.id);
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries([comic], downloadBtn);
        }
      });
    }
    // NEW: Attach handler for read/unread toggle button on individual comic
    const statusBtn = card.querySelector('.status-toggle-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!statusBtn.disabled) {
          toggleReadStatus(statusBtn);
        }
      });
    }
    container.appendChild(card);
  });
}


async function rerenderSearchResults() {
  if (lastSearchQuery) {
    await showSearchView(lastSearchQuery, lastSearchField, true);
  }
}

async function showSearchView(query, field, useCache = false) {
  if (!window._isNavigatingFromRouter && window.router && query) {
    const searchUrl = `/search?q=${encodeURIComponent(query)}&field=${encodeURIComponent(field)}`;
    if (getRelativePath() + window.location.search !== searchUrl) {
      window.router.navigate(searchUrl, true);
    }
  }

  if (query === undefined && lastSearchQuery) {
    query = lastSearchQuery;
    field = lastSearchField;
    useCache = true;
  }
  
  const isSameSearch = (query === lastSearchQuery && field === lastSearchField);
  lastSearchQuery = query || '';
  lastSearchField = field || 'all';

  currentView = 'search';
  syncSmartFilterButtons();
  rootFolderListDiv.classList.add('hidden');
  publisherListDiv.classList.add('hidden');
  seriesListDiv.classList.add('hidden');
  comicListDiv.classList.add('hidden');
  // smartListView reference removed
  searchResultsView.classList.remove('hidden');
  mountSmartFilterHostInto(searchResultsView);

  searchResultsTitle.textContent = `Search Results for "${lastSearchQuery}"`;

  const renderResults = (comics) => {
    const mode = (typeof window !== 'undefined' && window.searchViewMode) || 'list';
    if (mode === 'folders') {
      renderSearchResultsAsFolders(comics);
    } else {
      renderComicCards(comics, 'search');
    }
  };

  if (useCache && isSameSearch && lastSearchResults) {
    renderResults(lastSearchResults);
    return;
  }

  searchResultsContainer.innerHTML = createLoadingMessage('Searching...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/search?query=${encodeURIComponent(lastSearchQuery)}&field=${lastSearchField}`);
    const comics = await response.json();
    lastSearchResults = comics;
    
    if (comics.length === 0) {
      searchResultsContainer.innerHTML = createEmptyMessage('No results found.');
      return;
    }

    renderResults(comics);
  } catch (error) {
    console.error('[search] Error:', error);
    searchResultsContainer.innerHTML = '<div class="text-red-400">Search failed.</div>';
  }
}

function renderSearchResultsAsFolders(comics) {
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
    const folderName = safeDirName(pubName);
    const pubLogoUrl = `${API_BASE_URL}/logos/${encodeURIComponent(folderName)}/logo.png`; // Fallback/Optimistic

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
      renderComicCards(pubComics, 'search');
      searchResultsTitle.textContent = `Search Results: ${pubName}`;
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


  const LibraryRender = {
    setLatestButtonActive,
    setDownloadedButtonActive,
    setGuidedButtonActive,
    setMangaFilterButtonActive,
    clearSmartFilterButtons,
    showLatestAddedSmartList,
    showDownloadedSmartList,
    showGuidedSmartList,
    showMangaSmartList,
    renderLatestSmartList,
    renderDownloadedSmartList,
    renderGuidedSmartList,
    renderMangaSmartList,
    renderAllComicsAsList,
    applyFilterAndRender,
    renderAlphaFilter,
    getComicStatus,
    getSeriesStatus,
    getComicStatusCounts,
    createEmptyStatusCounts,
    addStatusCounts,
    getPublisherStatusCounts,
    getRootStatusCounts,
    getLibraryStatusCounts,
    statusCountsMatchFilter,
    filterPublishersByActiveFilter,
    filterSeriesByActiveFilter,
    updateFilterButtonCounts,
    showRootFolderList,
    renderPublisherCards,
    showPublisherList,
    renderSeriesCards,
    showSeriesList,
    getSeriesStatusBanner,
    renderComicCards,
    showComicList,
    showSearchView,
    rerenderSearchResults,
    updateLibraryReadStatus,
    updateBreadcrumb,
    syncSmartFilterButtons,
    mountSmartFilterHostInto,
  };

  global.LibraryRender = LibraryRender;
  Object.assign(global, LibraryRender);
})(typeof window !== 'undefined' ? window : globalThis);
