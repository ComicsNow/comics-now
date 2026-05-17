(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};
  const Data = global.LibraryData || {};

function showRootFolderList(options = {}) {
  const force = Boolean(options.force);
  
  if (!window._isNavigatingFromRouter && window.router && !window._isAppInitializing) {
     if (getRelativePath() !== '/') {
       window.router.navigate('/', true);
       return;
     }
  }

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
  
  if (!window._isNavigatingFromRouter && window.router && !window._isAppInitializing) {
     const navPath = `/library?rootFolder=${encodeURIComponent(rootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       window.router.navigate(navPath, true);
       return;
     }
  }

  const normalizedPath = rootFolder ? rootFolder.replace(/[\\\/]+$/, '') : '';
  const actualKey = library?.[rootFolder] ? rootFolder : (library?.[normalizedPath] ? normalizedPath : (library?.[normalizedPath + '/'] ? normalizedPath + '/' : null));
  const rootData = actualKey ? library[actualKey] : null;

  if (!library || !rootData) {
    showRootFolderList({ force: true });
    return;
  }

  if (currentView !== 'publishers') {
    activeAlphaFilter = 'All';
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

  const folderLabel = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || currentRootFolder;
  if (publisherTitleH2) {
    publisherTitleH2.textContent = folderLabel;
  }

  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel }
  ]);

  renderAlphaFilter(publisherAlphaFilter, publishersToRender, renderPublisherCards, 'publishers');
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

  if (!window._isNavigatingFromRouter && window.router && !window._isAppInitializing) {
     let navPath = `/series-list?publisher=${encodeURIComponent(publisherName)}`;
     if (currentRootFolder) navPath += `&rootFolder=${encodeURIComponent(currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       window.router.navigate(navPath, true);
       return;
     }
  }

  if (currentView !== 'series' || currentPublisher !== publisherName) {
    activeAlphaFilter = 'All';
  }
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

  const folderLabel = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[currentRootFolder] || window.LIBRARY_NAMES[normalizedPath])) || normalizedPath.split(/[\\\/]/).pop() || currentRootFolder;
  updateBreadcrumb([
    { label: 'Libraries', action: () => showRootFolderList({ force: true }) },
    { label: folderLabel, action: () => showPublisherList(currentRootFolder, { force: true }) },
    { label: publisherName },
  ]);

  renderAlphaFilter(seriesAlphaFilter, filteredSeries, renderSeriesCards, 'series');
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
  if (!window._isNavigatingFromRouter && window.router && !window._isAppInitializing) {
     let navPath = `/series/${encodeURIComponent(seriesName)}`;
     if (currentPublisher) navPath += `?publisher=${encodeURIComponent(currentPublisher)}`;
     if (currentRootFolder) navPath += (currentPublisher ? '&' : '?') + `rootFolder=${encodeURIComponent(currentRootFolder)}`;
     if ((getRelativePath() + window.location.search) !== navPath) {
       window.router.navigate(navPath, true);
       return;
     }
  }

  if (currentView !== 'comics' || currentSeries !== seriesName) {
    activeAlphaFilter = 'All';
  }
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

  const libLabelComic = (window.LIBRARY_NAMES && (window.LIBRARY_NAMES[currentRootFolder] || (currentRootFolder && window.LIBRARY_NAMES[currentRootFolder.replace(/[\\\/]+$/, '')]))) || (currentRootFolder ? currentRootFolder.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() : '') || currentRootFolder || '';
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

    const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));

    // Smart list debugging removed
    let bannerHtml = '';
    let isRead = false; // NEW: Define isRead here to use it for the button

    if (trackedTotalPages > 0) {
      isRead = lastRead >= trackedTotalPages - 1; // NEW: Assign the value here
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

    const isComicDownloaded = downloadedComicIds.has(comic.id);
    const downloadIcon = isComicDownloaded ? ICONS.READ : ICONS.DOWNLOAD;
    
    // Don't show download button for local/device comics
    const downloadButtonHtml = isLocal ? '' : `<button class="download-btn absolute top-2 right-2 ${isComicDownloaded ? 'text-green-400' : 'text-gray-400 hover:text-white'}" 
          data-comic-id="${comic.id}" 
          data-is-downloaded="${isComicDownloaded}"
          title="${isComicDownloaded ? 'Delete from device' : 'Download comic'}">
        ${downloadIcon}
      </button>`;

    // NEW: Add the read/unread toggle button HTML
    const toggleStatusIcon = isRead
      ? ICONS.READ
      : ICONS.UNREAD;

    const toggleStatusButtonHtml = isLocal ? '' : `
      <button class="status-toggle-btn absolute top-2 left-2 ${isRead ? 'text-green-400' : 'text-gray-400'} hover:text-white" title="Toggle Read Status" data-comic-id="${comic.id}" data-current-status="${isRead ? 'read' : 'unread'}">
        ${toggleStatusIcon}
      </button>
    `;

    const titleIconHtml = isComicDownloaded
      ? `<span class="inline-block mb-0.5 mr-1 text-green-400" style="width: 0.75rem; height: 0.75rem;">${ICONS.READ}</span>`
      : '';

    let coverHtml = '';
    if (comic.thumbnailPath) {
      coverHtml = `<img src="${API_BASE_URL}/thumbnails/${comic.thumbnailPath}" alt="${escapeHtml(altText)}" class="comic-cover-image">`;
    } else if (isLocal) {
      coverHtml = `
        <div class="comic-cover-image flex items-center justify-center bg-gray-900 text-purple-500">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
      `;
    } else {
      coverHtml = `<img src="https://placehold.co/400x600/1e1e1e/e0e0e0?text=No+Cover" alt="${escapeHtml(altText)}" class="comic-cover-image">`;
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
    searchLibraryLocally,
  };

  global.LibraryRender = LibraryRender;
  Object.assign(global, LibraryRender);
})(typeof window !== 'undefined' ? window : globalThis);
