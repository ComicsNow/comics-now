import {
  state,
  ICONS,
  escapeHtml,
  showView,
  createEmptyMessage,
  createLoadingMessage,
  getRelativePath,
  rootFolderListDiv,
  rootFolderListContainer,
  publisherListDiv,
  publisherListContainer,
  seriesListDiv,
  comicListDiv,
  publisherAlphaFilter,
  seriesAlphaFilter,
  comicAlphaFilter,
  publisherTitleH2,
  seriesTitleH2,
  comicListTitleH2,
  smartListContainer,
  applyDisplayInfoToComic
} from '../globals.js';

import {
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
  updateLibraryReadStatus
} from './status.js';

import { updateBreadcrumb, makeCountChips } from './breadcrumb.js';
import { DeviceLibrary } from './device-library.js';
import { showFolderView } from './folder-viewer.js';
import * as Data from './data.js';
import * as SmartLists from './smartlists.js';
import { renderAllComicsAsList, renderAlphaFilter, applyFilterAndRender } from './alpha-list.js';
import { showSearchView, rerenderSearchResults } from './search.js';
import {
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
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  hideSmartFilterHost
} from './smart-filters.js';
import { toggleReadStatus } from '../progress.js';

const API_BASE_URL = state.API_BASE_URL || window.API_BASE_URL || '';

export function showRootFolderList(options = {}) {
  const force = Boolean(options.force);
  
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     if (getRelativePath() !== '/') {
       state.router.navigate('/', true);
       return;
     }
  }

  state.currentView = 'root';
  state.currentRootFolder = null;
  state.currentPublisher = null;
  state.currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = state.currentView;
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  updateBreadcrumb([]);

  const rootFoldersFromLibrary = state.library ? Object.keys(state.library) : [];
  const rootFolders = [];
  const seen = new Set();

  const addRootFolder = (folderPath) => {
    if (!folderPath) return;
    const normalized = folderPath.replace(/[\\\/]+$/, '');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    rootFolders.push(folderPath);
  };

  if (Array.isArray(state.configuredRootFolders) && state.configuredRootFolders.length > 0) {
    state.configuredRootFolders.forEach(addRootFolder);
  }
  rootFoldersFromLibrary.forEach(addRootFolder);

  const rootCards = rootFolders.map(folderPath => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const folderName = (window.LIBRARY_NAMES && window.LIBRARY_NAMES[normalizedPath]) || normalizedPath.split(/[\\\/]/).pop() || normalizedPath;
    
    // Use normalization-aware lookup for library data
    const rootData = state.library?.[folderPath] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
    
    const publisherCount = rootData?.publishers ? Object.keys(rootData.publishers).length : 0;
    const publisherLabel = publisherCount === 1 ? 'Publisher' : 'Publishers';
    const counts = getRootStatusCounts(rootData);
    return { folderPath, folderName, publisherCount, publisherLabel, counts };
  });

  const visibleRootCards = rootCards.filter(card => statusCountsMatchFilter(card.counts));

  if (visibleRootCards.length === 1 && !force) {
    const cardData = visibleRootCards[0];
    const normalizedPath = cardData.folderPath.replace(/[\\\/]+$/, '');
    const actualKey = state.library?.[cardData.folderPath] ? cardData.folderPath : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
    const rootData = actualKey ? state.library[actualKey] : null;
    const mode = rootData?.hierarchyMode || 'metadata';
    
    state.currentRootFolder = actualKey;
    if (typeof window !== 'undefined') window.currentRootFolder = state.currentRootFolder;
    
    if (mode === 'folder') {
      showFolderView(cardData.folderPath);
    } else {
      showPublisherList(cardData.folderPath);
    }
    return;
  }

  showView(rootFolderListDiv);
  if (state.activeSmartFilter) {
    mountSmartFilterHostInto(rootFolderListDiv);
  } else {
    hideSmartFilterHost();
  }

  if (!rootFolderListContainer) return;

  rootFolderListContainer.innerHTML = '';

  if (visibleRootCards.length === 0) {
    const message = state.activeFilter === 'in-progress'
      ? 'No comics in progress.'
      : state.activeFilter === 'read'
        ? 'No comics read.'
        : state.activeFilter === 'unread'
          ? 'No unread comics.'
          : 'No comics found.';
    rootFolderListContainer.innerHTML = createEmptyMessage(message);
    return;
  }

  visibleRootCards.forEach(({ folderPath, folderName, publisherCount, publisherLabel, counts }) => {
    const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
    const rootData = state.library?.[folderPath] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];

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
      isLibraryDownloaded = allComics.every(comic => state.downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isLibraryDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const isLocalRoot = folderPath && String(folderPath).startsWith('device-');
    const downloadButtonHtml = isLocalRoot ? '' : `<button class="download-btn absolute top-2 right-2 z-20 ${isLibraryDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'} bg-gray-900/60 backdrop-blur-sm p-1.5 rounded-lg shadow-lg"
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
          <img src="${libraryImageUrl}" alt="${escapeHtml(folderName)}" class="w-full h-full object-cover" loading="lazy">
        </div>
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2">${escapeHtml(folderName)}</h3>
      <p class="mt-1 text-xs text-gray-400 text-center">${publisherCount} ${publisherLabel}</p>
      ${countsHtml}
    `;
    
    card.addEventListener('click', () => {
      const normalizedPath = folderPath.replace(/[\\\/]+$/, '');
      const actualKey = state.library?.[folderPath] ? folderPath : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
      const rootData = actualKey ? state.library[actualKey] : null;
      const mode = rootData?.hierarchyMode || 'metadata';

      if (mode === 'folder') {
        showFolderView(folderPath);
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
              if (typeof window.deleteOfflineComic === 'function') {
                await window.deleteOfflineComic(comic.id);
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
      if (typeof window.showLibraryContextMenu === 'function') {
        window.showLibraryContextMenu(e, libraryContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window.showLibraryContextMenu === 'function') {
          contextMenuShown = true;
          window.showLibraryContextMenu(e, libraryContextData);
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
  if (DeviceLibrary) {
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
    addCard.onclick = () => DeviceLibrary.requestDeviceLibrary();
    rootFolderListContainer.appendChild(addCard);

    // Render existing device libraries
    DeviceLibrary.appendDeviceLibraryCards(rootFolderListContainer);
  }
}

export function showPublisherList(rootFolder, options = {}) {
  const force = Boolean(options.force);
  
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     const navPath = `/library?rootFolder=${encodeURIComponent(rootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  const normalizedPath = rootFolder ? rootFolder.replace(/[\\\/]+$/, '') : '';
  const actualKey = state.library?.[rootFolder] ? rootFolder : (state.library?.[normalizedPath] ? normalizedPath : (state.library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
  const rootData = actualKey ? state.library[actualKey] : null;

  if (!state.library || !rootData) {
    showRootFolderList({ force: true });
    return;
  }

  if (state.currentView !== 'publishers') {
    state.activeAlphaFilter = 'All';
  }
  state.currentView = 'publishers';
  state.currentRootFolder = actualKey;
  state.currentPublisher = null;
  state.currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = 'publishers';
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  const publishers = rootData ? rootData.publishers : {};
  const publishersToRender = filterPublishersByActiveFilter(publishers);
  const publisherNames = Object.keys(publishersToRender);

  if (publisherNames.length === 1 && !force) {
    state.currentPublisher = publisherNames[0];
    if (typeof window !== 'undefined') window.currentPublisher = state.currentPublisher;
    showSeriesList(publisherNames[0]);
    return;
  }

  showView(publisherListDiv);
  mountSmartFilterHostInto(publisherListDiv);

  const folderLabel = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || state.currentRootFolder;
  if (publisherTitleH2) {
    publisherTitleH2.textContent = folderLabel;
  }

  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel }
  ]);

  renderAlphaFilter(publisherAlphaFilter, publishersToRender, renderPublisherCards, 'publishers');
}

export function renderPublisherCards(publishersToShow) {
  publisherListContainer.innerHTML = '';
  const publishers = Object.keys(publishersToShow).sort();
  if (publishers.length === 0) {
    const msg = state.activeSmartFilter === 'reading-list'
      ? 'No publishers with reading lists found.'
      : state.activeFilter === 'in-progress'
        ? 'No publishers in progress.'
        : state.activeFilter === 'read'
          ? 'No publishers read.'
          : state.activeFilter === 'unread'
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

    const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
    const getReadingLists = state.getReadingListsForPublisher || window.getReadingListsForPublisher || SmartLists.getReadingListsForPublisher;
    const pubReadingLists = typeof getReadingLists === 'function' ? getReadingLists(publisher) : [];
    const readingListCount = pubReadingLists.length;

    let countsChips = makeCountChips(counts);
    if (readingListCount > 0) {
      const chipHtml = `<span class="card-count-chip reading-list" title="${readingListCount} Reading List${readingListCount === 1 ? '' : 's'}">📚 ${readingListCount}</span>`;
      if (countsChips.endsWith('</div>')) {
        countsChips = countsChips.slice(0, -6) + chipHtml + '</div>';
      } else {
        countsChips = `<div class="card-counts">${chipHtml}</div>`;
      }
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
              data-root-folder="${escapeHtml(state.currentRootFolder)}"
              title="Bulk Read/Unread">
        ${publisherStatusIcon}
      </button>`;

    // Check if all comics in the publisher are downloaded
    let isPublisherDownloaded = false;
    if (allComics.length > 0) {
      isPublisherDownloaded = allComics.every(comic => state.downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isPublisherDownloaded
      ? ICONS.READ
      : ICONS.DOWNLOAD;

    const downloadButtonHtml = `<button class="download-btn absolute top-2 right-2 ${isPublisherDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}"
          title="${isPublisherDownloaded ? 'Delete from device' : 'Download publisher'}"
          data-publisher-name="${escapeHtml(publisher)}"
          data-root-folder="${escapeHtml(state.currentRootFolder)}"
          data-is-downloaded="${isPublisherDownloaded}"
        >${downloadIcon}</button>`;

    const card = document.createElement('div');
    card.className = 'series-card bg-gray-800 rounded-lg shadow-lg cursor-pointer p-4 border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    const hasLogo = Boolean(publisherData.logoUrl);
    const needsLightBackground = Boolean(publisherData.logoNeedsBackground);
    const logoWrapperClasses = ['flex', 'items-center', 'justify-center', 'h-full', 'w-full'];
    if (needsLightBackground) {
      logoWrapperClasses.push('bg-white/95', 'rounded-lg', 'p-4', 'shadow-inner');
    }
    const logoContent = hasLogo
      ? `<div class="${logoWrapperClasses.join(' ')}"><img src="${API_BASE_URL}/${publisherData.logoUrl}" alt="${escapeHtml(publisher)}" class="h-full w-full object-contain" loading="lazy"></div>`
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
              if (typeof window.deleteOfflineComic === 'function') {
                await window.deleteOfflineComic(comic.id);
              }
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries(allComics, downloadBtn);
        }
      });
    }

    // Bulk read/unread dialog when the read-status icon is tapped.
    const pubStatusBtn = card.querySelector('.status-toggle-btn');
    if (pubStatusBtn) {
      pubStatusBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let comics = [];
        if (publisherData.series && typeof Data?.getSeriesComics === 'function') {
          for (const seriesName of Object.keys(publisherData.series)) {
            try {
              const sComics = await Data.getSeriesComics(state.currentRootFolder, publisher, seriesName);
              if (Array.isArray(sComics)) comics.push(...sComics);
            } catch (_) {}
          }
        } else {
          comics = allComics;
        }
        if (typeof window.openBulkReadStatusDialog === 'function') {
          window.openBulkReadStatusDialog(comics || [], `publisher "${publisher}"`);
        }
      });
    }

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const publisherContextData = {
      publisherName: publisher,
      publisherInfo: publisherData,
      rootFolder: state.currentRootFolder
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof window.showPublisherContextMenu === 'function') {
        window.showPublisherContextMenu(e, publisherContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window.showPublisherContextMenu === 'function') {
          contextMenuShown = true;
          window.showPublisherContextMenu(e, publisherContextData);
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

export function isOrderBySeriesDate(order = state.seriesSortOrder) {
  if (!order) return false;
  const o = String(order).toLowerCase();
  return o === 'date' || o === 'date-asc' || o === 'date-desc' || o === 'published-date' || o.includes('date');
}

export function getComicIssueNumber(comic) {
  if (!comic) return null;
  const m = comic.metadata || {};
  const raw = m.Number ?? m.Issue ?? m.IssueNumber ?? m.SortNumber ?? m.AlternateNumber;
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = parseFloat(String(raw).replace(/^[^\d.]*/, ''));
    if (!isNaN(parsed)) return parsed;
  }
  const name = comic.name || '';
  const matchHash = name.match(/#(\d+(?:\.\d+)?)/);
  if (matchHash) {
    const parsed = parseFloat(matchHash[1]);
    if (!isNaN(parsed)) return parsed;
  }
  const matchLead = name.match(/^0*(\d+(?:\.\d+)?)\b/);
  if (matchLead) {
    const parsed = parseFloat(matchLead[1]);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

export function getComicPublishedDate(comic) {
  if (!comic) return { year: null, month: null, day: null, sortKey: null };
  let m = comic.metadata || {};
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch (_) { m = {}; }
  }

  let year = m.Year || m.year || null;
  let month = m.Month || m.month || null;
  let day = m.Day || m.day || null;

  const rawDate = m.CoverDate || m['Cover Date'] || m.StoreDate || m['Store Date'] || m.Date || m.date;

  if (rawDate && (!year || !month || !day)) {
    const str = String(rawDate).trim();
    const isoMatch = str.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (isoMatch) {
      if (!year) year = isoMatch[1];
      if (!month && isoMatch[2]) month = isoMatch[2];
      if (!day && isoMatch[3]) day = isoMatch[3];
    } else {
      const parsed = Date.parse(str);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        if (!year) year = d.getUTCFullYear();
        if (!month) month = d.getUTCMonth() + 1;
        if (!day) day = d.getUTCDate();
      } else {
        const yMatch = str.match(/\b(19\d\d|20\d\d)\b/);
        if (yMatch && !year) year = yMatch[1];
      }
    }
  }

  if (!year) {
    const nameStr = (comic.name || '') + ' ' + (comic.displayName || '');
    const nameMatch = nameStr.match(/\b(19\d\d|20\d\d)\b/);
    if (nameMatch) year = nameMatch[1];
  }

  const yNum = year ? parseInt(year, 10) : null;
  const mNum = month ? parseInt(month, 10) : null;
  const dNum = day ? parseInt(day, 10) : null;

  let sortKey = null;
  if (yNum && !isNaN(yNum) && yNum >= 1800 && yNum <= 2100) {
    const safeM = (mNum && !isNaN(mNum) && mNum >= 1 && mNum <= 12) ? mNum : 1;
    const safeD = (dNum && !isNaN(dNum) && dNum >= 1 && dNum <= 31) ? dNum : 1;
    sortKey = yNum * 10000 + safeM * 100 + safeD;
  }

  return {
    year: (yNum && !isNaN(yNum) && yNum >= 1800 && yNum <= 2100) ? String(yNum) : null,
    month: mNum,
    day: dNum,
    sortKey
  };
}

export function getFirstComicInSeries(comicsInSeries) {
  if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) return null;
  if (comicsInSeries.length === 1) return comicsInSeries[0];

  const issueOne = comicsInSeries.find(c => {
    const num = getComicIssueNumber(c);
    return num === 1;
  });

  const sorted = [...comicsInSeries].sort((a, b) => {
    const numA = getComicIssueNumber(a);
    const numB = getComicIssueNumber(b);
    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else if (numA !== null) {
      return -1;
    } else if (numB !== null) {
      return 1;
    }
    const applyDisplay = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;
    const aInfo = typeof applyDisplay === 'function' ? applyDisplay(a) : {};
    const bInfo = typeof applyDisplay === 'function' ? applyDisplay(b) : {};
    const aTitle = aInfo.displayTitle || a.name || '';
    const bTitle = bInfo.displayTitle || b.name || '';
    return aTitle.localeCompare(bTitle, undefined, { numeric: true, sensitivity: 'base' });
  });

  return issueOne || sorted[0];
}

export function getSeriesPublishedInfo(comicsInSeries) {
  if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) {
    return { firstComic: null, year: null, month: null, day: null, sortKey: null };
  }

  const firstComic = getFirstComicInSeries(comicsInSeries);
  let dateInfo = getComicPublishedDate(firstComic);

  if (!dateInfo.sortKey) {
    for (const c of comicsInSeries) {
      const alt = getComicPublishedDate(c);
      if (alt.sortKey !== null) {
        if (dateInfo.sortKey === null || alt.sortKey < dateInfo.sortKey) {
          dateInfo = alt;
        }
      }
    }
  }

  return {
    firstComic,
    year: dateInfo.year,
    month: dateInfo.month,
    day: dateInfo.day,
    sortKey: dateInfo.sortKey
  };
}

export function initSeriesSortControls() {
  const select = document.getElementById('series-sort-select');
  if (!select) return;

  const pubKey = state.currentPublisher ? `publisher_series_sort_${state.currentPublisher}` : null;
  const saved = (pubKey && typeof localStorage !== 'undefined') ? localStorage.getItem(pubKey) : null;
  const currentOrder = saved || 'name';
  state.seriesSortOrder = currentOrder;
  if (typeof window !== 'undefined') window.seriesSortOrder = currentOrder;

  if (select.querySelector(`option[value="${currentOrder}"]`)) {
    select.value = currentOrder;
  } else if (currentOrder === 'date' && select.querySelector('option[value="date-asc"]')) {
    select.value = 'date-asc';
  } else if (currentOrder === 'date-asc' && select.querySelector('option[value="date"]')) {
    select.value = 'date';
  }

  if (!select._seriesSortWired) {
    select._seriesSortWired = true;
    select.addEventListener('change', (e) => {
      setSeriesSortOrder(e.target.value);
    });
  }
}

export function setSeriesSortOrder(order) {
  state.seriesSortOrder = order;
  if (typeof window !== 'undefined') {
    window.seriesSortOrder = order;
  }
  if (typeof localStorage !== 'undefined') {
    if (state.currentPublisher) {
      localStorage.setItem(`publisher_series_sort_${state.currentPublisher}`, order);
    }
    localStorage.setItem('publisher_series_sort', order);
  }
  const select = document.getElementById('series-sort-select');
  if (select) {
    if (select.querySelector(`option[value="${order}"]`)) {
      select.value = order;
    } else if (order === 'date' && select.querySelector('option[value="date-asc"]')) {
      select.value = 'date-asc';
    } else if (order === 'date-asc' && select.querySelector('option[value="date"]')) {
      select.value = 'date';
    }
  }

  if (state.currentView === 'series' && state.currentPublisher) {
    const normalizedPath = state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '') : '';
    const rootData = state.library?.[state.currentRootFolder] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
    const publisherData = rootData?.publishers?.[state.currentPublisher];
    if (publisherData?.series) {
      const filteredSeries = filterSeriesByActiveFilter(publisherData.series);
      renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderSeriesCards, 'series');
      return;
    }
    showSeriesList(state.currentPublisher, { force: true });
  }
}

export function showSeriesList(publisherName, options = {}) {
  const force = Boolean(options.force);
  if (!publisherName) return;

  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing && !force) {
     let navPath = `/series-list?publisher=${encodeURIComponent(publisherName)}`;
     if (state.currentRootFolder) navPath += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  if (state.currentView !== 'series' || state.currentPublisher !== publisherName) {
    state.activeAlphaFilter = 'All';
  }
  state.currentView = 'series';
  state.currentPublisher = publisherName;
  state.currentSeries = null;
  if (typeof window !== 'undefined') {
    window.currentView = 'series';
    window.currentRootFolder = state.currentRootFolder;
    window.currentPublisher = state.currentPublisher;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  const normalizedPath = state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '') : '';
  const rootData = state.library?.[state.currentRootFolder] || state.library?.[normalizedPath] || state.library?.[normalizedPath + '/'];
  const publisherData = rootData?.publishers[publisherName];
  if (!publisherData) {
    showPublisherList(state.currentRootFolder, { force: true });
    return;
  }

  const seriesData = publisherData.series || {};
  const filteredSeries = filterSeriesByActiveFilter(seriesData);
  const seriesNames = Object.keys(filteredSeries);

  if (seriesNames.length === 1 && !force) {
    state.currentSeries = seriesNames[0];
    if (typeof window !== 'undefined') window.currentSeries = state.currentSeries;
    showComicList(seriesNames[0]);
    return;
  }

  showView(seriesListDiv);
  mountSmartFilterHostInto(seriesListDiv);

  if (seriesTitleH2) {
    seriesTitleH2.textContent = publisherName;
  }

  const folderLabel = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || state.currentRootFolder;
  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel, action: () => showPublisherList(state.currentRootFolder, { force: true }) },
    { label: publisherName },
  ]);

  const sortContainer = document.getElementById('series-sort-container');
  if (state.activeSmartFilter === 'reading-list') {
    if (sortContainer) sortContainer.classList.add('hidden');
    renderPublisherReadingLists(publisherName);
    return;
  }
  if (sortContainer) sortContainer.classList.remove('hidden');
  renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderSeriesCards, 'series');

  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    });
  }
}

export function renderPublisherReadingLists(publisherName) {
  const container = document.getElementById('series-list-container');
  if (!container) return;
  container.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
  container.innerHTML = '';

  if (seriesAlphaFilter) {
    seriesAlphaFilter.innerHTML = '';
  }

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const readingLists = typeof SmartLists.getReadingListsForPublisher === 'function'
    ? SmartLists.getReadingListsForPublisher(publisherName)
    : [];

  if (readingLists.length === 0) {
    const msg = `No reading lists available for ${publisherName}.`;
    container.innerHTML = createEmptyMessage(msg);
    const backToSeriesBtn = document.createElement('button');
    backToSeriesBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
    backToSeriesBtn.textContent = '← Back to Series';
    backToSeriesBtn.addEventListener('click', () => {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
      showSeriesList(publisherName, { force: true });
    });
    container.appendChild(backToSeriesBtn);
    return;
  }

  for (const list of readingLists) {
    const card = document.createElement('div');
    card.className = 'reading-list-card bg-gray-800 rounded-xl shadow-lg p-4 sm:p-5 border border-gray-700/60 hover:border-purple-500/60 transition-all duration-200 group cursor-pointer flex flex-col justify-between gap-3';
    
    const progressPercent = list.progressPercent || (list.totalComics > 0 ? Math.round(((list.readComics || 0) / list.totalComics) * 100) : 0);
    const totalComics = list.totalComics || 0;
    const readComics = list.readComics || 0;

    card.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-purple-900/40 border border-purple-500/30 flex items-center justify-center text-xl shrink-0 group-hover:scale-105 transition-transform mt-0.5">
          📚
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-start justify-between gap-2 mb-1">
            <a href="#" class="reading-list-hotlink font-bold text-base sm:text-lg text-white group-hover:text-purple-300 hover:underline transition-colors leading-snug break-words flex-1 min-w-[140px]" title="Open ${escapeHtml(list.name)}">
              ${escapeHtml(list.name)}
            </a>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-purple-900/60 text-purple-300 font-semibold shrink-0">
              ${totalComics} ${totalComics === 1 ? 'comic' : 'comics'}
            </span>
          </div>
          ${list.description ? `<p class="text-xs sm:text-sm text-gray-400 line-clamp-3 mt-1.5 leading-relaxed">${escapeHtml(list.description)}</p>` : ''}
        </div>
      </div>

      <div class="mt-2 pt-3 border-t border-gray-700/50">
        <div class="flex justify-between items-center text-xs text-gray-400 mb-1.5">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${progressPercent === 100 ? 'bg-green-400' : progressPercent > 0 ? 'bg-purple-400' : 'bg-gray-500'}"></span>
            <span>${readComics} of ${totalComics} read</span>
          </span>
          <span class="font-bold ${progressPercent === 100 ? 'text-green-400' : 'text-purple-400'}">${progressPercent}%</span>
        </div>
        <div class="w-full bg-gray-700/80 h-2 rounded-full overflow-hidden">
          <div class="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${progressPercent}%;"></div>
        </div>
      </div>
    `;

    const openListHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const openModal = state.openReadingListModal || window.openReadingListModal;
      const showDetail = state.showReadingListDetail || window.showReadingListDetail;
      if (typeof openModal === 'function') openModal();
      if (typeof showDetail === 'function') showDetail(list.id, list.name);
    };

    card.addEventListener('click', openListHandler);
    const hotlink = card.querySelector('.reading-list-hotlink');
    if (hotlink) hotlink.addEventListener('click', openListHandler);

    container.appendChild(card);
  }
}

export function renderSeriesCards(seriesToRender) {
  const container = document.getElementById('series-list-container');
  if (!container) return;
  container.innerHTML = '';
  container.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6';
  const sortOrder = state.seriesSortOrder || (typeof window !== 'undefined' && window.seriesSortOrder) || 'name';
  const orderByDate = isOrderBySeriesDate(sortOrder);
  const isDesc = sortOrder === 'date-desc';

  const publishedInfoMap = new Map();
  for (const sName of Object.keys(seriesToRender)) {
    publishedInfoMap.set(sName, getSeriesPublishedInfo(seriesToRender[sName]));
  }

  let sortedSeries;
  if (orderByDate) {
    sortedSeries = Object.keys(seriesToRender).sort((a, b) => {
      const infoA = publishedInfoMap.get(a);
      const infoB = publishedInfoMap.get(b);
      const keyA = infoA?.sortKey ?? null;
      const keyB = infoB?.sortKey ?? null;

      if (keyA !== null && keyB !== null) {
        if (keyA !== keyB) {
          return isDesc ? keyB - keyA : keyA - keyB;
        }
      } else if (keyA !== null) {
        return -1;
      } else if (keyB !== null) {
        return 1;
      }
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else {
    sortedSeries = Object.keys(seriesToRender).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  }
  if (sortedSeries.length === 0) {
    const msg = state.activeFilter === 'in-progress'
      ? 'No series in progress.'
      : state.activeFilter === 'read'
        ? 'No series read.'
        : state.activeFilter === 'unread'
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
    backToPublisherBtn.addEventListener('click', () => showPublisherList(state.currentRootFolder));
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
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image" loading="lazy">`;
      }

      // Determine overall read status for the series
      isSeriesRead = comicsInSeries.every(comic => {
        const progress = comic.progress || {};
        const total = progress.totalPages || 0;
        const lastRead = progress.lastReadPage || 0;
        return total > 0 && lastRead >= total - 1;
      });

      // Determine if all comics in the series are downloaded
      isSeriesDownloaded = comicsInSeries.every(comic => state.downloadedComicIds.has(comic.id));
    } else if (comicsInSeries && comicsInSeries._counts) {
      // Lazy loading - use pre-computed counts and thumbnail
      if (comicsInSeries._firstThumbnail) {
        const thumbnailUrl = `${API_BASE_URL}/thumbnails/${comicsInSeries._firstThumbnail}`;
        imageHtml = `<img src="${thumbnailUrl}" alt="${escapeHtml(seriesName)}" class="comic-cover-image" loading="lazy">`;
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
        data-publisher="${escapeHtml(state.currentPublisher)}"
        data-root-folder="${escapeHtml(state.currentRootFolder)}"
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
          data-publisher="${escapeHtml(state.currentPublisher)}"
          data-root-folder="${escapeHtml(state.currentRootFolder)}"
          data-is-downloaded="${isSeriesDownloaded}"
        >${downloadIcon}</button>`;

    let bannerHtml = getSeriesStatusBanner(comicsInSeries);

    // Check if all comics in the series are manga
    let allComicsAreManga = false;
    if (Array.isArray(comicsInSeries) && comicsInSeries.length > 0) {
      allComicsAreManga = comicsInSeries.every(comic => comic.mangaMode === true);
    }
    const mangaBannerHtml = allComicsAreManga ? `<div class="status-banner status-manga">Manga</div>` : '';

    const pubInfo = publishedInfoMap.get(seriesName) || getSeriesPublishedInfo(comicsInSeries);
    const seriesYear = pubInfo?.year || null;
    const showYear = Boolean(orderByDate && seriesYear && !seriesName.endsWith(`(${seriesYear})`));

    const seriesTitleDisplay = showYear
      ? `${escapeHtml(seriesName)} <span class="series-year text-gray-400 font-normal text-sm">(${escapeHtml(seriesYear)})</span>`
      : escapeHtml(seriesName);

    const tooltipTitle = showYear
      ? `${seriesName} (${seriesYear})`
      : seriesName;

    card.innerHTML = `
      <div class="relative">
        ${bannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${statusButtonHtml}
        ${imageHtml}
      </div>
      <h3 class="text-lg font-semibold mt-4 text-center text-white truncate w-full px-2" title="${escapeHtml(tooltipTitle)}">${seriesTitleDisplay}</h3>
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
          comics = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, seriesName);
          downloadBtn.disabled = false;
        }

        if (isDownloaded) {
          if (confirm(`Delete these ${Array.isArray(comics) ? comics.length : 'selected'} downloaded comics from your device?`)) {
            downloadBtn.disabled = true;
            if (Array.isArray(comics)) {
              for (const comic of comics) {
                if (typeof window.deleteOfflineComic === 'function') {
                  await window.deleteOfflineComic(comic.id);
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
            comics = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, seriesName);
          } catch (_) { comics = []; }
        }
        if (typeof window.openBulkReadStatusDialog === 'function') {
          window.openBulkReadStatusDialog(comics || [], `series "${seriesName}"`);
        }
      });
    }

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;
    const seriesContextData = {
      seriesName,
      comicsInSeries,
      rootFolder: state.currentRootFolder,
      publisher: state.currentPublisher
    };

    card.addEventListener('contextmenu', (e) => {
      if (typeof window.showSeriesContextMenu === 'function') {
        window.showSeriesContextMenu(e, seriesContextData);
      }
    });

    // Long-press for mobile
    card.addEventListener('touchstart', (e) => {
      contextMenuShown = false;
      longPressTimer = setTimeout(() => {
        if (typeof window.showSeriesContextMenu === 'function') {
          contextMenuShown = true;
          window.showSeriesContextMenu(e, seriesContextData);
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

export function getSeriesStatusBanner(comicsInSeries) {
  const status = getSeriesStatus(comicsInSeries);
  if (status === 'read') {
    return `<div class="status-banner status-read">Read</div>`;
  }
  if (status === 'in-progress') {
    return `<div class="status-banner status-in-progress">In Progress</div>`;
  }
  return '';
}

export async function showComicList(seriesName) {
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
     let navPath = `/series/${encodeURIComponent(seriesName)}`;
     if (state.currentPublisher) navPath += `?publisher=${encodeURIComponent(state.currentPublisher)}`;
     if (state.currentRootFolder) navPath += (state.currentPublisher ? '&' : '?') + `rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       state.router.navigate(navPath, true);
       return;
     }
  }

  if (state.currentView !== 'comics' || state.currentSeries !== seriesName) {
    state.activeAlphaFilter = 'All';
  }
  state.currentView = 'comics';
  state.currentSeries = seriesName;
  if (typeof window !== 'undefined') {
    window.currentView = state.currentView;
    window.currentSeries = state.currentSeries;
  }
  syncSmartFilterButtons();
  if (typeof updateFilterButtonCounts === 'function') updateFilterButtonCounts();

  showView(comicListDiv);
  mountSmartFilterHostInto(comicListDiv);

  if (comicListTitleH2) {
    comicListTitleH2.textContent = seriesName;
  }

  const libLabelComic = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[state.currentRootFolder] || (state.currentRootFolder && window.LIBRARY_NAMES[state.currentRootFolder.replace(/[\\\/]+$/, '')]))) || (state.currentRootFolder ? state.currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() : '') || state.currentRootFolder || '';
  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    ...(libLabelComic ? [{ label: libLabelComic, action: () => showPublisherList(state.currentRootFolder, { force: true }) }] : []),
    { label: state.currentPublisher, action: () => showSeriesList(state.currentPublisher, { force: true }) },
    { label: seriesName },
  ]);

  // Show loading message while fetching comics
  const container = document.getElementById('comic-list-container');
  if (container) {
    container.innerHTML = createLoadingMessage('Loading comics...');
  }

  const targetSeries = seriesName;

  try {
    // Use lazy loading to get series comics
    const comicsData = await Data.getSeriesComics(state.currentRootFolder, state.currentPublisher, targetSeries);

    if (state.currentSeries !== targetSeries || state.currentView !== 'comics') {
      return;
    }

    const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);
    const scoped = state.activeSmartFilter ? comicsData.filter(matchesScope) : comicsData;

    let comicsToRender = scoped;
    const isInbox = state.currentRootFolder === 'Smart Inbox';
    if (isInbox) {
      if (state.activeFilter === 'unread') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'successful');
      } else if (state.activeFilter === 'in-progress') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'failed');
      } else if (state.activeFilter === 'read') {
        comicsToRender = scoped.filter(comic => (comic.tagStatus || 'pending') === 'pending');
      }
    } else {
      if (state.activeFilter === 'in-progress') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'in-progress');
      } else if (state.activeFilter === 'read') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'read');
      } else if (state.activeFilter === 'unread') {
        comicsToRender = scoped.filter(comic => getComicStatus(comic) === 'unread');
      }
    }

    renderAlphaFilter(comicAlphaFilter, comicsToRender, renderComicCards, 'comics');

  } catch (error) {
    if (container) {
      container.innerHTML = '<div class="bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full">Error loading comics. Please try again.</div>';
    }
  }
}

export function renderComicCards(comicsToRender, viewType, targetContainer) {
  let container;
  if (targetContainer) {
    container = targetContainer;
  } else if (viewType === 'search') {
    container = document.getElementById('search-results-container');
  } else if (viewType === 'smart-list') {
    container = smartListContainer || document.getElementById('smart-list-container');
  } else {
    container = document.getElementById('comic-list-container');
  }

  if (!container) return;

  container.innerHTML = '';
  if (comicsToRender.length === 0) {
    let msg;
    if (!viewType && state.activeFilter === 'in-progress') {
      msg = 'No comics in progress.';
    } else if (!viewType && state.activeFilter === 'read') {
      msg = 'No comics read.';
    } else if (!viewType && state.activeFilter === 'unread') {
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
      backToPublisherBtn.addEventListener('click', () => showPublisherList(state.currentRootFolder));
      container.appendChild(backToPublisherBtn);

      const backToSeriesBtn = document.createElement('button');
      backToSeriesBtn.className = 'mt-4 text-purple-400 hover:text-purple-300';
      backToSeriesBtn.textContent = '← Series';
      backToSeriesBtn.addEventListener('click', () => showSeriesList(state.currentPublisher, { force: true }));
      container.appendChild(backToSeriesBtn);
    }
    return;
  }
  comicsToRender.forEach((comic, index) => {
    const card = document.createElement('div');
    card.className = 'comic-card bg-gray-800 rounded-lg shadow-lg cursor-pointer flex flex-col border border-gray-700/50 hover:border-purple-500/50 transition-all duration-300 group';
    
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

    const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));

    let bannerHtml = '';
    let isRead = false;

    if (trackedTotalPages > 0) {
      isRead = lastRead >= trackedTotalPages - 1;
      const isInProgress = lastRead > 0 && !isRead;
      if (!isLocal) {
        if (isRead) {
          bannerHtml = `<div class="status-banner status-read">Read</div>`;
        } else if (isInProgress) {
          bannerHtml = `<div class="status-banner status-in-progress">In Progress</div>`;
        }
      }
    }

    // Add manga mode banner
    const mangaBannerHtml = (comic.mangaMode && !isLocal) ? `<div class="status-banner status-manga">Manga</div>` : '';

    const progressPercent = trackedTotalPages > 0 ? (lastRead / trackedTotalPages) * 100 : 0;

    const isInbox = state.currentRootFolder === 'Smart Inbox';
    const isComicDownloaded = state.downloadedComicIds.has(comic.id);
    const downloadIcon = isComicDownloaded ? ICONS.READ : ICONS.DOWNLOAD;
    
    // Don't show download button for local/device or inbox comics
    const downloadButtonHtml = (isLocal || isInbox) ? '' : `<button class="download-btn absolute top-2 right-2 ${isComicDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}" 
          data-comic-id="${comic.id}" 
          data-is-downloaded="${isComicDownloaded}"
          title="${isComicDownloaded ? 'Delete from device' : 'Download comic'}">
        ${downloadIcon}
      </button>`;

    // Add the read/unread toggle button HTML
    const toggleStatusIcon = isRead
      ? ICONS.READ
      : ICONS.UNREAD;

    const toggleStatusButtonHtml = (isLocal || isInbox) ? '' : `
      <button class="status-toggle-btn absolute top-2 left-2 ${isRead ? 'text-green-400' : 'text-gray-400'} hover:text-white" title="Toggle Read Status" data-comic-id="${comic.id}" data-current-status="${isRead ? 'read' : 'unread'}">
        ${toggleStatusIcon}
      </button>
    `;

    const titleIconHtml = '';

    let coverHtml = '';
    if (comic.thumbnailPath) {
      coverHtml = `<img src="${API_BASE_URL}/thumbnails/${comic.thumbnailPath}" alt="${escapeHtml(altText)}" class="comic-cover-image" loading="lazy">`;
    } else if (isLocal) {
      coverHtml = `
        <div class="comic-cover-image flex items-center justify-center bg-gray-900 text-purple-500">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
      `;
    } else {
      coverHtml = `<img src="https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover" alt="${escapeHtml(altText)}" class="comic-cover-image" loading="lazy">`;
    }

    card.innerHTML = `
      <div class="relative">
        ${bannerHtml}
        ${mangaBannerHtml}
        ${downloadButtonHtml}
        ${toggleStatusButtonHtml}
        ${coverHtml}
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

    // Store comic data on the card element for context menu access
    card._comicData = comic;

    // Add context menu support (right-click and long-press)
    let longPressTimer = null;
    let contextMenuShown = false;

    if (!isInbox) {
      card.addEventListener('contextmenu', (e) => {
        if (typeof window.showComicContextMenu === 'function') {
          window.showComicContextMenu(e, comic);
        }
      });

      // Long-press for mobile
      card.addEventListener('touchstart', (e) => {
        contextMenuShown = false;
        longPressTimer = setTimeout(() => {
          if (typeof window.showComicContextMenu === 'function') {
            contextMenuShown = true;
            window.showComicContextMenu(e, comic);
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
    }

    card.addEventListener('click', (event) => {
      const target = event.target;
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
            if (typeof window.deleteOfflineComic === 'function') {
              await window.deleteOfflineComic(comic.id);
            }
            if (typeof applyFilterAndRender === 'function') applyFilterAndRender();
          }
        } else {
          window.downloadSeries([comic], downloadBtn);
        }
      });
    }
    // Attach handler for read/unread toggle button on individual comic
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

export function searchLibraryLocally(query, field) {
  // Imported dynamically or handled by local search module
}

export const LibraryRender = {
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
  renderPublisherReadingLists,
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
  searchLibraryLocally,
  isOrderBySeriesDate,
  getComicIssueNumber,
  getComicPublishedDate,
  getFirstComicInSeries,
  getSeriesPublishedInfo,
  initSeriesSortControls,
  setSeriesSortOrder
};

// Register on state & window for compatibility
state.LibraryRender = LibraryRender;
Object.assign(state, LibraryRender);
if (typeof window !== 'undefined') {
  window.LibraryRender = LibraryRender;
  Object.assign(window, LibraryRender);
}

export default LibraryRender;
