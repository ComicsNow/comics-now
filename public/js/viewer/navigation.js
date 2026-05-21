import { state } from '../globals.js';

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

  const IMAGE_FILE_REGEX = /\.(jpg|jpeg|png|gif|webp)$/i;
  const MAC_OS_RESOURCE_PREFIX = '__MACOSX';

  function setLibraryControlsVisibility(isVisible) {
    const action = isVisible ? 'remove' : 'add';
    const searchContainer = global.document.getElementById('search-container');
    const filtersContainer = global.document.getElementById('filters-container');

    if (searchContainer) {
      searchContainer.classList[action]('hidden');
    }
    if (filtersContainer) {
      filtersContainer.classList[action]('hidden');
    }
  }

  function normalizePagesResponse(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.pages)) return data.pages;
    return [];
  }

  async function loadOfflineComicPages(comic) {
    if (!comic) {
      return [];
    }

    try {
      let zipData = null;

      // Try local file handle or File object (Device Library) first
      if (comic.handle) {
        try {
          zipData = await comic.handle.getFile();
        } catch (handleError) {
          console.error('[DEVICE] Failed to get file from handle:', handleError);
        }
      } else if (comic.file) {
        zipData = comic.file;
      }

      // Fallback to IndexedDB (Downloaded comics)
      if (!zipData && typeof global.getComicFromDB === 'function') {
        const record = await global.getComicFromDB(comic.id);
        if (record && record.fileBlob) {
          zipData = record.fileBlob;
        }
      }

      if (!zipData) {
        return [];
      }

      const JSZipCtor = global.JSZip;
      if (!JSZipCtor) {
        return [];
      }

      const zip = await new JSZipCtor().loadAsync(zipData);
      const pageNames = Object.keys(zip.files)
        .filter(name => {
          const entry = zip.files[name];
          if (!entry || entry.dir) return false;
          if (name.startsWith(MAC_OS_RESOURCE_PREFIX)) return false;
          return IMAGE_FILE_REGEX.test(name);
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      // If we're loading from a local handle, we might not have a downloadedComicIds set yet
      if (!global.downloadedComicIds) {
        global.downloadedComicIds = new Set();
      }

      // If it's a device library comic, we mark it as "downloaded" so the viewer
      // knows to use local extraction logic for pages.
      if (comic.handle || comic.file || zipData instanceof Blob) {
        global.downloadedComicIds.add(comic.id);
      }

      if (!global.currentComic?.progress) {
        global.currentComic.progress = {};
      }
      if (typeof global.currentComic.progress.totalPages !== 'number' && pageNames.length > 0) {
        global.currentComic.progress.totalPages = pageNames.length;
      }

      return pageNames;
    } catch (error) {
      console.error('[OFFLINE] Error loading local pages:', error);
      return [];
    }
  }
  function navigateBackFromViewer(targetContext) {
    const useOverride = arguments.length > 0;
    const context = useOverride ? targetContext : global.viewerReturnContext;
    global.viewerReturnContext = null;
    global.currentComicZipCache = null;

    if (global.window.syncManager) {
      global.window.syncManager.stopPolling();
    }

    setLibraryControlsVisibility(true);

    if (global.comicViewerDiv) {
      global.comicViewerDiv.classList.add('hidden');
      global.comicViewerDiv.style.display = 'none';
    }

    if (!context) {
      global.currentView = 'root';
      global.currentRootFolder = null;
      global.currentPublisher = null;
      global.currentSeries = null;
      global.showRootFolderList?.({ force: true });
      return;
    }

    if (context.view === 'search') {
      global.currentView = 'search';
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

    global.currentView = 'root';
    global.currentRootFolder = null;
    global.currentPublisher = null;
    global.currentSeries = null;
    global.showRootFolderList?.({ force: true });
  }

  function rebindViewerEvents() {
    // Clear existing listeners on nav buttons by replacing them with clones (standard pattern here)
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

  async function openComicViewer(comic, options = {}) {
    const isLocal = !!(comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));

    if (!window._isNavigatingFromRouter && window.router && !isLocal) {
       let navPath = `/comic/${comic.id}`;
       if (global.currentFolderPath) {
         navPath += `?folderPath=${encodeURIComponent(global.currentFolderPath)}`;
       }
       window.router.navigate(navPath, true);
       return;
    }

    global.viewerReturnContext = {
      view: global.currentView,
      rootFolder: global.currentRootFolder,
      publisher: global.currentPublisher,
      series: global.currentSeries,
      folderPath: global.currentFolderPath,
      readingListId: options.readingListId || null,
      readingListName: options.readingListName || null,
    };

    // Routing: Determine which viewer to use
    if (isLocal) {
      if (typeof global.initLocalViewer === 'function') {
        global.initLocalViewer();
      } else {
        console.error('[VIEWER] Local viewer initializer not found');
      }
    } else {
      if (typeof global.initServerViewer === 'function') {
        global.initServerViewer();
      } else {
        console.error('[VIEWER] Server viewer initializer not found');
      }
    }

    // Breadcrumb logic
    if (typeof global.updateBreadcrumb === 'function') {
      if (options.readingListId) {
        // Override breadcrumb when entering via a reading list
        const listName = options.readingListName || 'Reading List';
        global.updateBreadcrumb([
          { label: 'Libraries', action: () => global.showRootFolderList?.({ force: true }) },
          { label: 'Reading Lists', action: () => global.openReadingListModal?.() },
          { label: listName },
        ]);
      } else {
        // Standard breadcrumb path
        const root = global.currentRootFolder;
        const pub = global.currentPublisher;
        const series = global.currentSeries;
        const libLabel = root ? root.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || root : '';
        const displayInfo = global.applyDisplayInfoToComic?.(comic) || {};
        
        const crumbs = [
          { label: 'Libraries', action: () => global.showRootFolderList?.({ force: true }) }
        ];

        // Check if we're in folder mode
        const rootData = global.library?.[root];
        const isFolderMode = rootData?.hierarchyMode === 'folder' || global.currentView === 'folder' || !!global.currentFolderPath;

        // Recover folderPath if missing in folder mode (e.g. on refresh without query param)
        if (isFolderMode && !global.currentFolderPath && comic.path) {
          global.currentFolderPath = comic.path.substring(0, comic.path.lastIndexOf('/')).replace(/\\/g, '/');
        }

        if (isFolderMode && global.currentFolderPath && typeof global.showFolderView === 'function') {
          // Build Folder Mode Breadcrumbs
          const folderPath = global.currentFolderPath;
          const normPath = folderPath.replace(/[\\\/]+$/, '');
          const rootFolders = (global.configuredRootFolders || []).map(f => f.replace(/[\\\/]+$/, ''));
          const matchedRoot = rootFolders.find(d => normPath === d || normPath.startsWith(d + '/')) || root;

          if (matchedRoot) {
            const rootName = (window.LIBRARY_NAMES && window.LIBRARY_NAMES[matchedRoot]) || matchedRoot.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || matchedRoot;
            crumbs.push({
              label: rootName,
              action: () => global.showFolderView(matchedRoot, { force: true })
            });

            const relative = normPath.substring(matchedRoot.length).replace(/^\/+/, '');
            const parts = relative ? relative.split('/') : [];
            let currentPath = matchedRoot;
            
            parts.forEach((part) => {
              if (part) {
                currentPath += '/' + part;
                const targetPath = currentPath;
                crumbs.push({
                  label: part,
                  action: () => global.showFolderView(targetPath, { force: true })
                });
              }
            });
          }
        } else {
          // Standard Metadata Mode Breadcrumbs
          const rootName = (window.LIBRARY_NAMES && window.LIBRARY_NAMES[root]) || libLabel;
          if (rootName) {
            crumbs.push({ label: rootName, action: () => global.showPublisherList?.(root, { force: true }) });
          }

          // Recover metadata if missing from global state (e.g. on refresh)
          const effectivePub = pub || comic.publisher;
          const effectiveSeries = series || comic.series;

          if (effectivePub && effectivePub !== 'Unknown Publisher') {
            crumbs.push({ label: effectivePub, action: () => global.showSeriesList?.(effectivePub, { force: true }) });
          }
          if (effectiveSeries && effectiveSeries !== 'Unknown Series') {
            crumbs.push({ label: effectiveSeries, action: () => global.showComicList?.(effectiveSeries, { force: true }) });
          }
        }

        // Determine the label for the last segment (the comic itself)
        // In folder mode, we prefer the specific title (filename without extension) or name 
        // to avoid redundancy with the parent folder segments already in the breadcrumb.
        const breadcrumbLabel = isFolderMode 
          ? (displayInfo.titleText || comic.name || 'Comic') 
          : (displayInfo.displayTitle || comic.name || 'Comic');

        crumbs.push({ label: breadcrumbLabel });
        global.updateBreadcrumb(crumbs);
      }
    }

    global.currentView = 'comic';

    setLibraryControlsVisibility(false);
    global.updateOrientationButtons?.();
    global.showView?.(global.comicViewerDiv);

    if (global.comicViewerDiv) {
      global.comicViewerDiv.style.display = '';
    }

    // Toggle Metadata tab visibility based on comic source (Hide for local/device comics)
    if (global.metadataTabBtn) {
      if (isLocal) {
        global.metadataTabBtn.classList.add('hidden');
      } else {
        const isAdmin = window.syncManager && window.syncManager.userRole === 'admin';
        global.metadataTabBtn.classList.toggle('hidden', !isAdmin);
      }
    }

    const displayInfo = global.applyDisplayInfoToComic?.(comic) || {};
    if (global.comicTitleH2) {
      global.comicTitleH2.textContent = displayInfo.displayTitle || comic.name || '';
    }
    if (global.comicSubtitleP) {
      const subtitleText = displayInfo.subtitle;
      if (subtitleText) {
        global.comicSubtitleP.textContent = subtitleText;
        global.comicSubtitleP.classList.remove('hidden');
      } else {
        global.comicSubtitleP.textContent = '';
        global.comicSubtitleP.classList.add('hidden');
      }
    }

    global.resetComicSummary?.();
    global.currentComic = comic;
    global.currentMetadata = null;
    global.currentComicZipCache = null;
    global.preloadedImages?.clear?.();
    global.pageUrlCache?.clear?.();
    global.hidePageJumpInput?.({ focusButton: false });
    global.updateViewerPageCounter?.([]);

    // Automatically sync manga mode from library if available
    if (!isLocal && navigator.onLine && typeof global.library !== 'undefined') {
      try {
        let libraryComic = null;
        for (const rootFolder of Object.keys(global.library)) {
          const publishers = global.library[rootFolder]?.publishers || {};
          for (const publisherName of Object.keys(publishers)) {
            const seriesEntries = publishers[publisherName]?.series || {};
            for (const seriesName of Object.keys(seriesEntries)) {
              const comics = seriesEntries[seriesName];
              if (Array.isArray(comics)) {
                libraryComic = comics.find(c => c.id === comic.id);
                if (libraryComic) break;
              }
            }
            if (libraryComic) break;
          }
          if (libraryComic) break;
        }

        if (libraryComic && libraryComic.mangaMode !== undefined) {
          const syncedMangaMode = libraryComic.mangaMode;
          if (comic.mangaMode !== syncedMangaMode) {
            comic.mangaMode = syncedMangaMode;
            global.currentComic.mangaMode = syncedMangaMode;

            const isDownloaded = global.downloadedComicIds?.has(comic.id);
            if (isDownloaded && typeof global.updateDownloadedComicInfo === 'function') {
              try {
                await global.updateDownloadedComicInfo(comic.id, { mangaMode: syncedMangaMode });
              } catch (error) {}
            }
            if (typeof global.updateDownloadedSmartListComic === 'function') {
              global.updateDownloadedSmartListComic(comic.id, { mangaMode: syncedMangaMode });
            }
          }
        }
      } catch (error) {
        console.error('[MANGA] Error during automatic manga mode sync:', error);
      }
    }

    if (typeof global.updateMangaModeUI === 'function') {
      global.updateMangaModeUI(comic.mangaMode || false);
    }

    if (typeof global.setOrientationMode === 'function') {
      const wantLandscape = !!(comic.landscapeMode === true || comic.landscapeMode == 1);
      global.setOrientationMode(wantLandscape ? 'landscape' : 'portrait', { persist: false });
    }

    if (comic.continuousMode && typeof global.enableContinuousMode === 'function') {
      await global.enableContinuousMode();
    } else {
      if (typeof global.disableContinuousMode === 'function' && global.isContinuousMode) {
        await global.disableContinuousMode();
      }
      if (typeof global.updateContinuousModeUI === 'function') {
        global.updateContinuousModeUI(false);
      }
    }

    if (typeof global.setFullImageMode === 'function') {
      const wantFullImage = !!(comic.fullImageMode === true || comic.fullImageMode == 1);
      if (wantFullImage !== !!global.isFullImageMode) {
        global.setFullImageMode(wantFullImage, { persist: false });
      } else if (wantFullImage) {
        global.applyFullImageLayout?.();
      }
    }

    if (global.viewerPagesDiv) {
      global.viewerPagesDiv.dataset.pages = JSON.stringify([]);
      global.viewerPagesDiv.innerHTML = '';
      if (global.pageLoader) {
        global.viewerPagesDiv.appendChild(global.pageLoader);
      }
    }

    global.viewerTabBtn?.click?.();

    let pages = [];
    let offlinePages = [];
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    
    try {
      offlinePages = await loadOfflineComicPages(comic);
      if (offlinePages.length > 0) {
        pages = offlinePages;
      }
    } catch (offlineError) {}

    if (!Array.isArray(pages) || pages.length === 0) {
      if (isOffline) {
        console.error('[OFFLINE] No local pages found while offline');
      } else {
        try {
          const response = await fetch(`${global.API_BASE_URL}/api/v1/comics/pages?path=${encodeURIComponent(global.encodePath(comic.path))}`);
          let data = null;
          try {
            data = await response.json();
          } catch (parseError) {
            data = null;
          }

          if (!response.ok || data?.offline) {
            throw new Error(`Failed to load pages: ${response.status}`);
          }

          pages = normalizePagesResponse(data);
        } catch (error) {
          console.error('[VIEWER] API fetch failed:', error);
          if (offlinePages.length === 0) {
            pages = await loadOfflineComicPages(comic);
          }
        }
      }
    }

    global.pageLoader?.classList.add('hidden');
    global.pageLoader?.classList.remove('flex');

    if (!Array.isArray(pages) || pages.length === 0) {
      if (global.viewerPagesDiv) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const message = offline
          ? 'Failed to load pages while offline. Make sure this comic is downloaded for offline reading.'
          : 'Failed to load pages.';
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-red-400">${message}</div>`;
        global.viewerPagesDiv.dataset.pages = JSON.stringify([]);
      }
      global.updateViewerPageCounter?.([]);
      return;
    }

    if (global.viewerPagesDiv) {
      global.viewerPagesDiv.dataset.pages = JSON.stringify(pages);
    }

    const sessionSavedPage = sessionStorage.getItem(`progress_${comic.id}`);
    const savedProgress = sessionSavedPage !== null 
      ? parseInt(sessionSavedPage, 10) 
      : (comic.progress?.lastReadPage || 0);
    
    global.currentPageIndex = Math.max(0, Math.min(savedProgress, pages.length - 1));

    if (global.window.syncManager) {
      try {
        await global.window.syncManager.checkSyncStatus(comic.id, global.currentPageIndex);
      } catch (error) {}
    }

    await global.renderPage?.();
    global.preloadPages?.(global.currentPageIndex, pages);

    if (typeof global.refreshGuidedToggle === 'function') {
      try { await global.refreshGuidedToggle(); } catch (_) {}
    }

    if (global.viewerContent) {
      global.viewerContent.scrollTop = 0;
    }

    if (typeof global.loadComicSummary === 'function') {
      try {
        await global.loadComicSummary();
      } catch (error) {}
    }

    if (!isLocal && global.window.syncManager) {
      global.window.syncManager.startPolling(comic);
    }
  }

  const ViewerNavigation = {
    setLibraryControlsVisibility,
    navigateBackFromViewer,
    openComicViewer,
    rebindViewerEvents,
  };

  global.ViewerNavigation = ViewerNavigation;
  Object.assign(global, ViewerNavigation);

export {
  IMAGE_FILE_REGEX,
  MAC_OS_RESOURCE_PREFIX,
  setLibraryControlsVisibility,
  normalizePagesResponse,
  loadOfflineComicPages,
  navigateBackFromViewer,
  rebindViewerEvents,
  openComicViewer,
  ViewerNavigation
};

state.IMAGE_FILE_REGEX = IMAGE_FILE_REGEX;
state.MAC_OS_RESOURCE_PREFIX = MAC_OS_RESOURCE_PREFIX;
state.setLibraryControlsVisibility = setLibraryControlsVisibility;
state.normalizePagesResponse = normalizePagesResponse;
state.loadOfflineComicPages = loadOfflineComicPages;
state.navigateBackFromViewer = navigateBackFromViewer;
state.rebindViewerEvents = rebindViewerEvents;
state.openComicViewer = openComicViewer;
state.ViewerNavigation = ViewerNavigation;

if (typeof window !== 'undefined') {
  window.IMAGE_FILE_REGEX = IMAGE_FILE_REGEX;
  window.MAC_OS_RESOURCE_PREFIX = MAC_OS_RESOURCE_PREFIX;
  window.setLibraryControlsVisibility = setLibraryControlsVisibility;
  window.normalizePagesResponse = normalizePagesResponse;
  window.loadOfflineComicPages = loadOfflineComicPages;
  window.navigateBackFromViewer = navigateBackFromViewer;
  window.rebindViewerEvents = rebindViewerEvents;
  window.openComicViewer = openComicViewer;
  window.ViewerNavigation = ViewerNavigation;
}
