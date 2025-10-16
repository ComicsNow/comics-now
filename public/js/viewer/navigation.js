(function (global) {
  'use strict';

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
    if (!comic || typeof global.getComicFromDB !== 'function') {
      return [];
    }

    try {
      const record = await global.getComicFromDB(comic.id);
      if (!record || !record.fileBlob) {
        return [];
      }

      const JSZipCtor = global.JSZip;
      if (!JSZipCtor) {
        
        return [];
      }

      const zip = await new JSZipCtor().loadAsync(record.fileBlob);
      const pageNames = Object.keys(zip.files)
        .filter(name => {
          const entry = zip.files[name];
          if (!entry || entry.dir) return false;
          if (name.startsWith(MAC_OS_RESOURCE_PREFIX)) return false;
          return IMAGE_FILE_REGEX.test(name);
        })
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      if (!global.downloadedComicIds) {
        global.downloadedComicIds = new Set();
      }
      global.downloadedComicIds.add(comic.id);

      if (!global.currentComic?.progress) {
        global.currentComic.progress = {};
      }
      if (typeof global.currentComic.progress.totalPages !== 'number' && pageNames.length > 0) {
        global.currentComic.progress.totalPages = pageNames.length;
      }

      return pageNames;
    } catch (error) {
      
      return [];
    }
  }

  function navigateBackFromViewer(targetContext) {
    const useOverride = arguments.length > 0;
    const context = useOverride ? targetContext : global.viewerReturnContext;
    global.viewerReturnContext = null;

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

    if (context.view === 'converted') {
      global.showLatestConvertedSmartList?.();
      return;
    }

    if (context.view === 'downloaded') {
      global.showDownloadedSmartList?.();
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

  async function openComicViewer(comic) {
    global.viewerReturnContext = {
      view: global.currentView,
      rootFolder: global.currentRootFolder,
      publisher: global.currentPublisher,
      series: global.currentSeries,
    };
    global.currentView = 'comic';
    // Also update the global currentView variable (not just window.currentView)
    if (typeof currentView !== 'undefined') {
      currentView = 'comic';
    }

    setLibraryControlsVisibility(false);
    global.updateOrientationButtons?.();

    global.comicListDiv?.classList.add('hidden');
    if (global.smartListView) global.smartListView.classList.add('hidden');
    global.searchResultsView?.classList.add('hidden');
    if (global.comicViewerDiv) {
      global.comicViewerDiv.classList.remove('hidden');
      global.comicViewerDiv.style.display = '';
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
    global.preloadedImages?.clear?.();
    global.pageUrlCache?.clear?.();
    global.hidePageJumpInput?.({ focusButton: false });
    global.updateViewerPageCounter?.([]);

    // Update manga mode UI based on comic's manga mode setting
    if (typeof global.updateMangaModeUI === 'function') {
      global.updateMangaModeUI(comic.mangaMode || false);
    }

    if (global.viewerPagesDiv) {
      global.viewerPagesDiv.dataset.pages = JSON.stringify([]);
    }

    global.viewerTabBtn?.click?.();
    if (global.viewerPagesDiv) {
      global.viewerPagesDiv.innerHTML = '';
      if (global.pageLoader) {
        global.viewerPagesDiv.appendChild(global.pageLoader);
      }
    }

    let pages = [];
    let offlinePages = [];
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const isDownloaded = global.downloadedComicIds?.has?.(comic.id);

    if (isOffline || isDownloaded) {
      try {
        offlinePages = await loadOfflineComicPages(comic);
        if (offlinePages.length > 0) {
          pages = offlinePages;
        } else if (isOffline) {
          
        }
      } catch (offlineError) {
        
      }
    }

    if (!Array.isArray(pages) || pages.length === 0) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/comics/pages?path=${encodeURIComponent(encodePath(comic.path))}`);
        let data = null;
        try {
          data = await response.json();
        } catch (parseError) {
          data = null;
        }

        if (!response.ok || data?.offline) {
          const status = response.status || 503;
          throw new Error(`Failed to load pages: ${status}`);
        }

        pages = normalizePagesResponse(data);
      } catch (error) {
        const offlineFallback = offlinePages.length > 0 ? offlinePages : await loadOfflineComicPages(comic);
        if (Array.isArray(offlineFallback) && offlineFallback.length > 0) {
          pages = offlineFallback;
          
        } else {
          
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

    // Set currentPageIndex based on saved progress
    const savedProgress = global.currentComic?.progress?.lastReadPage || 0;
    global.currentPageIndex = Math.max(0, Math.min(savedProgress, pages.length - 1));

    // Check for sync conflicts from other devices
    if (global.window.syncManager) {
      try {
        const syncResult = await global.window.syncManager.checkSyncStatus(comic.id, global.currentPageIndex);
      } catch (error) {
        
      }
    }

    await global.renderPage?.();
    global.preloadPages?.(global.currentPageIndex, pages);

    if (global.viewerPagesDiv) {
      global.viewerPagesDiv.scrollTop = 0;
    }

    // Load summary immediately when viewer opens
    if (typeof global.loadComicSummary === 'function') {
      try {
        await global.loadComicSummary();
      } catch (error) {
        
      }
    }

    if (global.window.syncManager) {
      global.window.syncManager.startPolling(comic);
    }
  }

  const ViewerNavigation = {
    setLibraryControlsVisibility,
    navigateBackFromViewer,
    openComicViewer,
  };

  global.ViewerNavigation = ViewerNavigation;
  Object.assign(global, ViewerNavigation);
})(typeof window !== 'undefined' ? window : globalThis);
