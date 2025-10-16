(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};
  const Data = global.LibraryData || {};

function setLatestButtonActive(isActive) {
  if (!latestAddedButton) return;
  latestAddedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  latestAddedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  latestAddedButton.classList.toggle('bg-gray-700', !isActive);
  latestAddedButton.classList.toggle('hover:bg-gray-600', !isActive);
  latestAddedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}

function setConvertedButtonActive(isActive) {
  if (!latestConvertedButton) return;
  latestConvertedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  latestConvertedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  latestConvertedButton.classList.toggle('bg-gray-700', !isActive);
  latestConvertedButton.classList.toggle('hover:bg-gray-600', !isActive);
  latestConvertedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}

function setDownloadedButtonActive(isActive) {
  if (!downloadedButton) return;
  downloadedButton.classList.toggle('bg-purple-600', Boolean(isActive));
  downloadedButton.classList.toggle('hover:bg-purple-500', Boolean(isActive));
  downloadedButton.classList.toggle('bg-gray-700', !isActive);
  downloadedButton.classList.toggle('hover:bg-gray-600', !isActive);
  downloadedButton.setAttribute('aria-pressed', String(Boolean(isActive)));
}


function showLatestAddedSmartList() {
  currentView = 'latest';
  currentRootFolder = null;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  SmartLists.rebuildLatestComics();
  renderLatestSmartList();
}

function showLatestConvertedSmartList() {
  currentView = 'converted';
  currentRootFolder = null;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  SmartLists.rebuildLatestConvertedComics();
  renderConvertedSmartList();
}

async function showDownloadedSmartList() {
  currentView = 'downloaded';
  currentRootFolder = null;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }

  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(true);

  showView(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Downloaded';
  }

  if (smartListContainer) {
    smartListContainer.innerHTML = createLoadingMessage('Loading downloaded comics...');
  }

  await SmartLists.rebuildDownloadedComics({ skipRender: true });
  renderDownloadedSmartList();
}

function renderLatestSmartList() {
  if (!smartListContainer) return;

  const latestComics = SmartLists.getLatestComics() || [];

  setLatestButtonActive(true);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);
  showView(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Latest';
  }

  if (!Array.isArray(latestComics) || latestComics.length === 0) {
    smartListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">No comics added in the last ${SmartLists.LATEST_ADDED_DAYS} days.</div>`;
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
    smartListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${message}</div>`;
    return;
  }

  renderComicCards(comicsToRender, 'smart-list');
}

function renderConvertedSmartList() {
  if (!smartListContainer) return;

  const latestConvertedComics = SmartLists.getLatestConvertedComics() || [];

  setLatestButtonActive(false);
  setConvertedButtonActive(true);
  setDownloadedButtonActive(false);
  showView(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = `Converted (Last ${SmartLists.LATEST_CONVERTED_DAYS} Days)`;
  }

  if (!Array.isArray(latestConvertedComics) || latestConvertedComics.length === 0) {
    smartListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">No comics converted in the last ${SmartLists.LATEST_CONVERTED_DAYS} days.</div>`;
    return;
  }

  let comicsToRender = latestConvertedComics;
  if (activeFilter === 'in-progress') {
    comicsToRender = latestConvertedComics.filter(comic => getComicStatus(comic) === 'in-progress');
  } else if (activeFilter === 'read') {
    comicsToRender = latestConvertedComics.filter(comic => getComicStatus(comic) === 'read');
  } else if (activeFilter === 'unread') {
    comicsToRender = latestConvertedComics.filter(comic => getComicStatus(comic) === 'unread');
  }

  if (comicsToRender.length === 0) {
    let message = `No comics converted in the last ${SmartLists.LATEST_CONVERTED_DAYS} days.`;
    if (activeFilter === 'in-progress') {
      message = `No comics in progress converted in the last ${SmartLists.LATEST_CONVERTED_DAYS} days.`;
    } else if (activeFilter === 'read') {
      message = `No comics read converted in the last ${SmartLists.LATEST_CONVERTED_DAYS} days.`;
    } else if (activeFilter === 'unread') {
      message = `No unread comics converted in the last ${SmartLists.LATEST_CONVERTED_DAYS} days.`;
    }
    smartListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${message}</div>`;
    return;
  }

  renderComicCards(comicsToRender, 'smart-list');
}

function renderDownloadedSmartList() {
  if (!smartListContainer) return;

  const downloadedSmartListError = SmartLists.getDownloadedSmartListError();
  const downloadedSmartListComics = SmartLists.getDownloadedSmartListComics() || [];

  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(true);
  showView(smartListView);

  if (smartListTitle) {
    smartListTitle.textContent = 'Downloaded';
  }

  if (downloadedSmartListError) {
    smartListContainer.innerHTML = createErrorMessage('Failed to load downloaded comics.');
    return;
  }

  if (!Array.isArray(downloadedSmartListComics) || downloadedSmartListComics.length === 0) {
    smartListContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">No comics downloaded for offline use.</div>';
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
    smartListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${message}</div>`;
    return;
  }

  renderComicCards(comicsToRender, 'smart-list');
}

// Simplified function - rendering functions handle active status filters
function applyFilterAndRender() {
  updateFilterButtonCounts();

  // With smart lists removed, we always use the full library
  if (currentView === 'comic' || global.currentView === 'comic') {
    return;
  }

  switch (currentView) {
    case 'publishers':
      showPublisherList(currentRootFolder);
      break;
    case 'series':
      showSeriesList(currentPublisher);
      break;
    case 'comics':
      showComicList(currentSeries);
      break;
    case 'latest':
      renderLatestSmartList();
      break;
    case 'converted':
      renderConvertedSmartList();
      break;
    case 'downloaded':
      renderDownloadedSmartList();
      break;
    default:
      showRootFolderList();
  }
}

function renderAlphaFilter(targetDiv, data, renderFn, type) {
  targetDiv.innerHTML = '';
  const characters = ['All', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  characters.forEach(char => {
    const button = document.createElement('button');
    button.className = 'alpha-filter-btn text-sm font-bold text-gray-400 hover:text-purple-500 transition-colors px-1';
    if (char === 'All') button.classList.add('active');
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
  // Check if this is lazy loading structure with pre-computed counts
  if (comicsInSeries && typeof comicsInSeries === 'object' && !Array.isArray(comicsInSeries) && comicsInSeries._counts) {
    return comicsInSeries._counts;
  }

  // Fall back to original computation for full data
  const comics = Array.isArray(comicsInSeries) ? comicsInSeries : [];
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
  // Check if lazy loading structure with pre-computed counts exists
  if (publisherData._counts) {
    return publisherData._counts;
  }

  // Fall back to original computation for full data
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
  return true;
}

function filterPublishersByActiveFilter(publishers = {}) {
  if (activeFilter === 'all') {
    return publishers;
  }

  const filtered = {};
  for (const [publisherName, publisherData] of Object.entries(publishers)) {
    const counts = getPublisherStatusCounts(publisherData);
    if (statusCountsMatchFilter(counts)) {
      filtered[publisherName] = publisherData;
    }
  }
  return filtered;
}

function filterSeriesByActiveFilter(seriesEntries = {}) {
  if (activeFilter === 'all') {
    return seriesEntries;
  }

  const filtered = {};
  for (const [seriesName, comics] of Object.entries(seriesEntries)) {
    // Use getComicStatusCounts which now handles both formats correctly
    const counts = getComicStatusCounts(comics);
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

  const idNum = Number(comicId);
  if (Number.isNaN(idNum)) {
    return;
  }

  for (const rootData of Object.values(library)) {
    const publishers = rootData?.publishers || {};
    for (const publisherData of Object.values(publishers)) {
      const seriesEntries = publisherData?.series || {};
      for (const comics of Object.values(seriesEntries)) {
        const comic = comics.find(c => Number(c.id) === idNum);
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
  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);

  const rootFoldersFromLibrary = library ? Object.keys(library) : [];
  const rootFolders = [];
  const seen = new Set();

  const addRootFolder = (folderPath) => {
    if (!folderPath || seen.has(folderPath)) return;
    seen.add(folderPath);
    rootFolders.push(folderPath);
  };

  if (Array.isArray(configuredRootFolders) && configuredRootFolders.length > 0) {
    configuredRootFolders.forEach(addRootFolder);
  }
  rootFoldersFromLibrary.forEach(addRootFolder);

  const rootCards = rootFolders.map(folderPath => {
    const normalizedPath = folderPath.replace(/[\/]+$/, '');
    const folderName = normalizedPath.split(/[\\\/]/).pop() || normalizedPath;
    const rootData = library?.[folderPath];
    const publisherCount = rootData?.publishers ? Object.keys(rootData.publishers).length : 0;
    const publisherLabel = publisherCount === 1 ? 'Publisher' : 'Publishers';
    const counts = getRootStatusCounts(rootData);
    return { folderPath, folderName, publisherCount, publisherLabel, counts };
  });

  const visibleRootCards = rootCards.filter(card => statusCountsMatchFilter(card.counts));

  if (visibleRootCards.length === 1 && !force) {
    currentRootFolder = visibleRootCards[0].folderPath;
    if (typeof window !== 'undefined') window.currentRootFolder = currentRootFolder;
    showPublisherList(visibleRootCards[0].folderPath);
    return;
  }

  showView(rootFolderListDiv);

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
    rootFolderListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${message}</div>`;
    return;
  }

  visibleRootCards.forEach(({ folderPath, folderName, publisherCount, publisherLabel, counts }) => {
    const rootData = library?.[folderPath];

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
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`;

    const downloadButtonHtml = isLibraryDownloaded
      ? `<div class="download-btn absolute top-2 right-2 text-green-400 pointer-events-none">${downloadIcon}</div>`
      : `<button class="download-btn absolute top-2 right-2 text-gray-400 hover:text-white"
          title="Download library"
          data-folder-path="${folderPath}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'folder-card bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer p-4';
    card.setAttribute('data-library-path', folderPath);
    let countsHtml;
    if (activeFilter === 'in-progress') {
      countsHtml = `<div class="mt-2 text-xs text-gray-400 text-center"><p>Total: ${counts.inProgress}</p></div>`;
    } else if (activeFilter === 'read') {
      countsHtml = `<div class="mt-2 text-xs text-gray-400 text-center"><p>Total: ${counts.read}</p></div>`;
    } else if (activeFilter === 'unread') {
      countsHtml = `<div class="mt-2 text-xs text-gray-400 text-center"><p>Total: ${counts.unread}</p></div>`;
    } else {
      countsHtml = `<div class="mt-2 text-xs text-gray-400 space-y-1 text-center">
           <p>Total: ${counts.total}</p>
           <p>Unread: ${counts.unread}</p>
           <p>In Progress: ${counts.inProgress}</p>
           <p>Read: ${counts.read}</p>
         </div>`;
    }

    card.innerHTML = `
      <div class="relative">
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        <div class="h-48 w-full bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
          <svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 0 1-2 2H4a2 2 0 01-2-2V6z"></path></svg>
        </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${folderName}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${publisherCount} ${publisherLabel}</p>
      ${countsHtml}
    `;
    card.addEventListener('click', () => showPublisherList(folderPath));

    // Add download button event handler
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn && downloadBtn.tagName === 'BUTTON') {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.downloadSeries(allComics, downloadBtn);
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
}


function showPublisherList(rootFolder, options = {}) {
  const force = Boolean(options.force);
  if (!library || !library[rootFolder]) {
    
    showRootFolderList({ force: true });
    return;
  }

  currentView = 'publishers';
  currentRootFolder = rootFolder;
  currentPublisher = null;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentRootFolder = currentRootFolder;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
  }
  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);

  const rootData = library[currentRootFolder];
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

  if (publisherTitleH2) {
    publisherTitleH2.textContent = currentRootFolder.split(/[\\\/]/).pop();
  }

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
    publisherListContainer.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${msg}</div>`;
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

    let countsContent;
    if (activeFilter === 'in-progress') {
      countsContent = `<p>Total: ${counts.inProgress}</p>`;
    } else if (activeFilter === 'read') {
      countsContent = `<p>Total: ${counts.read}</p>`;
    } else if (activeFilter === 'unread') {
      countsContent = `<p>Total: ${counts.unread}</p>`;
    } else {
      countsContent = `<p>Total: ${counts.total}</p>
             <p>Unread: ${counts.unread}</p>
             <p>In Progress: ${counts.inProgress}</p>
             <p>Read: ${counts.read}</p>`;
    }

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

    // Check if all comics in the publisher are downloaded
    let isPublisherDownloaded = false;
    if (allComics.length > 0) {
      isPublisherDownloaded = allComics.every(comic => downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isPublisherDownloaded
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`;

    const downloadButtonHtml = isPublisherDownloaded
      ? `<div class="download-btn absolute top-2 right-2 text-green-400 pointer-events-none">${downloadIcon}</div>`
      : `<button class="download-btn absolute top-2 right-2 text-gray-400 hover:text-white"
          title="Download publisher"
          data-publisher-name="${publisher}"
          data-root-folder="${currentRootFolder}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4';
    const hasLogo = Boolean(publisherData.logoUrl);
    const needsLightBackground = Boolean(publisherData.logoNeedsBackground);
    const logoWrapperClasses = ['flex', 'items-center', 'justify-center', 'h-full', 'w-full'];
    if (needsLightBackground) {
      logoWrapperClasses.push('bg-gray-100', 'rounded-md', 'p-4');
    }
    const logoContent = hasLogo
      ? `<div class="${logoWrapperClasses.join(' ')}"><img src="${API_BASE_URL}/${publisherData.logoUrl}" alt="${publisher}" class="h-full w-full object-contain"></div>`
      : `<svg class="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v1H4V6zm14 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8h16zm-2 2H4v4h12v-4z"></path></svg>`;
    card.innerHTML = `
      <div class="relative h-48 w-full bg-gray-700 rounded-lg flex items-center justify-center text-gray-400">
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${logoContent}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${publisher}</h3>
      <div class="mt-2 text-xs text-gray-400 space-y-1 text-center">
        ${countsContent}
      </div>
    `;
    card.addEventListener('click', () => showSeriesList(publisher));

    // Add download button event handler
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn && downloadBtn.tagName === 'BUTTON') {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.downloadSeries(allComics, downloadBtn);
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
  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);
  const publisherData = library[currentRootFolder]?.publishers[publisherName];
  if (!publisherData) {
    
    return;
  }

  currentView = 'series';
  currentPublisher = publisherName;
  currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = currentView;
    window.currentPublisher = currentPublisher;
    window.currentSeries = currentSeries;
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

  if (seriesTitleH2) {
    seriesTitleH2.textContent = publisherName;
  }

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
    container.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${msg}</div>`;
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
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4';

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

    let countsContent;
    if (activeFilter === 'in-progress') {
      countsContent = `<p>Total: ${statusCounts.inProgress}</p>`;
    } else if (activeFilter === 'read') {
      countsContent = `<p>Total: ${statusCounts.read}</p>`;
    } else if (activeFilter === 'unread') {
      countsContent = `<p>Total: ${statusCounts.unread}</p>`;
    } else {
      countsContent = `<p>Total: ${statusCounts.total}</p>
             <p>Unread: ${statusCounts.unread}</p>
             <p>In Progress: ${statusCounts.inProgress}</p>
             <p>Read: ${statusCounts.read}</p>`;
    }

    let imageHtml;
    let isSeriesRead = false;
    let isSeriesDownloaded = false;

    if (Array.isArray(comicsInSeries)) {
      // Full data - can access comic details
      const firstComicWithThumb = comicsInSeries.find(c => c.thumbnailPath);
      if (firstComicWithThumb) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${firstComicWithThumb.thumbnailPath}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${seriesName}" class="comic-cover-image">`;
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
        imageHtml = `<img src="${thumbnailUrl}" alt="${seriesName}" class="comic-cover-image">`;
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
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;

    const statusButtonHtml = `
      <button
        class="status-toggle-btn absolute top-2 left-2 ${isSeriesRead ? 'text-green-400' : 'text-gray-400'} hover:text-white"
        data-series-name="${seriesName}"
        data-publisher="${currentPublisher}"
        data-root-folder="${currentRootFolder}"
        data-current-status="${isSeriesRead ? 'read' : 'unread'}"
        title="Toggle Read Status"
      >
        ${statusIcon}
      </button>`;

    const downloadIcon = isSeriesDownloaded
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`;

    const downloadButtonHtml = isSeriesDownloaded
      ? `<div class="download-btn absolute top-2 right-2 text-green-400 pointer-events-none">${downloadIcon}</div>`
      : `<button class="download-btn absolute top-2 right-2 text-gray-400 hover:text-white"
          title="Download series"
          data-series-name="${seriesName}"
          data-publisher="${currentPublisher}"
          data-root-folder="${currentRootFolder}"
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
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${seriesName}</h3>
      <div class="mt-2 text-xs text-gray-400 space-y-1 text-center">
        ${countsContent}
      </div>
    `;
    card.addEventListener('click', () => showComicList(seriesName));

    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn && downloadBtn.tagName === 'BUTTON') {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.downloadSeries(comicsInSeries, downloadBtn);
      });
    }

    const statusBtn = card.querySelector('.status-toggle-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!statusBtn.disabled) {
          toggleReadStatus(statusBtn);
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
  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);

  showView(comicListDiv);

  if (comicListTitleH2) {
    comicListTitleH2.textContent = seriesName;
  }

  // Show loading message while fetching comics
  const container = document.getElementById('comic-list-container');
  if (container) {
    container.innerHTML = createLoadingMessage('Loading comics...');
  }

  try {
    // Use lazy loading to get series comics
    const comicsData = await Data.getSeriesComics(currentRootFolder, currentPublisher, currentSeries);

    let comicsToRender = comicsData;
    if (activeFilter === 'in-progress') {
      comicsToRender = comicsData.filter(comic => getComicStatus(comic) === 'in-progress');
    } else if (activeFilter === 'read') {
      comicsToRender = comicsData.filter(comic => getComicStatus(comic) === 'read');
    } else if (activeFilter === 'unread') {
      comicsToRender = comicsData.filter(comic => getComicStatus(comic) === 'unread');
    }

    renderAlphaFilter(comicAlphaFilter, comicsToRender, renderComicCards, 'comics');
    renderComicCards(comicsToRender);

  } catch (error) {
    
    if (container) {
      container.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading comics. Please try again.</div>';
    }
  }
}


function renderComicCards(comicsToRender, viewType) {
  let container;
  if (viewType === 'search') {
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
    container.innerHTML = `<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">${msg}</div>`;
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
    card.className = 'comic-card bg-gray-800 rounded-lg shadow-lg cursor-pointer flex flex-col';
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

let downloadButtonHtml = '';
if (downloadedComicIds.has(comic.id)) {
  downloadButtonHtml = `<div class="download-btn absolute top-2 right-2 text-green-400">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>
  </div>`;
} else {
  downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 text-gray-400 hover:text-white" data-comic-id="${comic.id}">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
  </button>`;
}

// NEW: Add the read/unread toggle button HTML
// NEW: Add the read/unread toggle button HTML
    const toggleStatusIcon = isRead
      ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;

    const toggleStatusButtonHtml = `
      <button class="status-toggle-btn absolute top-2 left-2 ${isRead ? 'text-green-400' : 'text-gray-400'} hover:text-white" title="Toggle Read Status" data-comic-id="${comic.id}" data-current-status="${isRead ? 'read' : 'unread'}">
        ${toggleStatusIcon}
      </button>
    `;

    card.innerHTML = `
      <div class="relative">
        ${bannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${toggleStatusButtonHtml} <!-- NEW: Add the button here -->
        <img src="${comic.thumbnailPath ? `${API_BASE_URL}/thumbnails/${comic.thumbnailPath}` : 'https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover'}" alt="${altText}" class="comic-cover-image">
        ${pageCountLabel ? `<div class="page-count-badge">${pageCountLabel}</div>` : ''}
      </div>
      <div class="p-2 flex-grow flex flex-col justify-between">
        <div>
          <p class="text-sm font-semibold text-white truncate">${displayTitle}</p>
          ${subtitleText ? `<p class="text-xs text-gray-300 truncate">${subtitleText}</p>` : ''}
        </div>
      </div>
      <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-600 rounded-b-lg"><div class="bg-purple-600 h-full rounded-b-lg" style="width: ${progressPercent}%;"></div></div>
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

      
      if (typeof window.openComicViewer === 'function') {
        window.openComicViewer(comic);
      } else {
        
      }
    });
    card.classList.add('cursor-pointer');
    const downloadBtn = card.querySelector('.download-btn');
    if (downloadBtn && downloadBtn.tagName === 'BUTTON') {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadComic(comic, downloadBtn);
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


async function showSearchView(query, field) {
  currentView = 'search';
  setLatestButtonActive(false);
  setConvertedButtonActive(false);
  setDownloadedButtonActive(false);
  rootFolderListDiv.classList.add('hidden');
  publisherListDiv.classList.add('hidden');
  seriesListDiv.classList.add('hidden');
  comicListDiv.classList.add('hidden');
  // smartListView reference removed
  searchResultsView.classList.remove('hidden');

  searchResultsTitle.textContent = `Search Results for "${query}"`;
  searchResultsContainer.innerHTML = createLoadingMessage('Searching...');

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/search?query=${encodeURIComponent(query)}&field=${field}`);
    const comics = await response.json();
    if (comics.length === 0) {
      searchResultsContainer.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-gray-500 col-span-full">No results found.</div>';
      return;
    }
    renderComicCards(comics, 'search');
  } catch (error) {
    
    searchResultsContainer.innerHTML = '<div class="text-red-400">Search failed.</div>';
  }
}


  const LibraryRender = {
    setLatestButtonActive,
    setConvertedButtonActive,
    setDownloadedButtonActive,
    showLatestAddedSmartList,
    showLatestConvertedSmartList,
    showDownloadedSmartList,
    renderLatestSmartList,
    renderConvertedSmartList,
    renderDownloadedSmartList,
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
    updateLibraryReadStatus,
  };

  global.LibraryRender = LibraryRender;
  Object.assign(global, LibraryRender);
})(typeof window !== 'undefined' ? window : globalThis);
