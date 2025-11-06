(function (global) {
  'use strict';

  async function getPageUrl(pageName) {
    if (global.pageUrlCache?.has(pageName)) {
      return global.pageUrlCache.get(pageName);
    }

    const downloadedComic = await global.getComicFromDB?.(global.currentComic?.id);
    if (downloadedComic) {
      const jszip = new JSZip();
      const zip = await jszip.loadAsync(downloadedComic.fileBlob);
      const pageFile = zip.file(pageName);
      if (pageFile) {
        const blob = await pageFile.async('blob');
        const url = URL.createObjectURL(blob);
        global.pageUrlCache?.set(pageName, url);
        return url;
      }
    }

    const url = `${API_BASE_URL}/api/v1/comics/pages/image?path=${encodeURIComponent(encodePath(global.currentComic.path))}&page=${encodeURIComponent(pageName)}`;
    global.pageUrlCache?.set(pageName, url);
    return url;
  }

  function preloadPages(currentIndex, pages) {
    if (!Array.isArray(pages)) return;

    // Only preload for online comics (not downloaded ones)
    const isDownloaded = global.downloadedComicIds?.has(global.currentComic?.id);
    if (isDownloaded) {
      
      return; // Don't preload for local comics - they're already local!
    }

    const start = currentIndex + 1;
    const end = Math.min(pages.length, start + (global.PRELOAD_AHEAD_COUNT || 0));

    for (let i = start; i < end; i++) {
      const pageName = pages[i];
      (async () => {
        try {
          const pageUrl = await getPageUrl(pageName);
          if (!global.preloadedImages?.has(pageUrl)) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = pageUrl;
            img.onload = () => 
            global.preloadedImages?.set(pageUrl, img);
          } else {
            
          }
        } catch (error) {
          
        }
      })();
    }
  }

  function prunePreloadedImages(currentIndex, pages) {
    if (!Array.isArray(pages)) return;

    // Only prune for online comics (not downloaded ones)
    const isDownloaded = global.downloadedComicIds?.has(global.currentComic?.id);
    if (isDownloaded) return; // Don't prune for local comics

    (async () => {
      try {
        const urlsToKeep = new Set();
        const PRELOAD_BEHIND_COUNT = 5; // Keep previous 5 pages

        // Keep previous 5 pages
        const start = Math.max(0, currentIndex - PRELOAD_BEHIND_COUNT);
        // Keep next 5 pages (PRELOAD_AHEAD_COUNT)
        const end = Math.min(pages.length, currentIndex + (global.PRELOAD_AHEAD_COUNT || 0) + 1);

        for (let i = start; i < end; i++) {
          const url = await getPageUrl(pages[i]);
          urlsToKeep.add(url);
        }

        const beforeCount = global.preloadedImages?.size || 0;
        for (const key of Array.from(global.preloadedImages?.keys?.() || [])) {
          if (!urlsToKeep.has(key)) {
            global.preloadedImages.delete(key);
          }
        }
        const afterCount = global.preloadedImages?.size || 0;
        
      } catch (error) {
        
      }
    })();
  }

  /**
   * Update end-of-comic navigation visibility and button states
   */
  async function updateEndOfComicNavigation() {
    const pages = global.getViewerPages?.() || [];
    const currentIndex = global.currentPageIndex;
    const isMangaMode = global.currentComic?.mangaMode || false;

    console.log('[End Nav] Update called - Index:', currentIndex, 'Pages:', pages.length, 'Manga:', isMangaMode);

    // Check if at last page (same for both standard and manga mode - only navigation direction changes)
    const isAtEnd = currentIndex === pages.length - 1;

    console.log('[End Nav] Is at end?', isAtEnd);

    // Regular viewer elements
    const container = document.getElementById('end-of-comic-navigation');
    const buttonsContainer = document.getElementById('end-nav-buttons');
    const seriesBtn = document.getElementById('next-in-series-btn');
    const readingListBtn = document.getElementById('next-in-reading-list-btn');

    // Fullscreen viewer elements
    const fullscreenContainer = document.getElementById('fullscreen-end-of-comic-navigation');
    const fullscreenButtonsContainer = document.getElementById('fullscreen-end-nav-buttons');
    const fullscreenSeriesBtn = document.getElementById('fullscreen-next-in-series-btn');
    const fullscreenReadingListBtn = document.getElementById('fullscreen-next-in-reading-list-btn');

    // Hide containers if not at end
    if (!isAtEnd) {
      if (container) container.classList.add('hidden');
      if (fullscreenContainer) fullscreenContainer.classList.add('hidden');
      return;
    }

    console.log('[End Nav] At end! Checking for next comics...');

    // At end - show container and update buttons
    let hasVisibleButtons = false;

    // Check for next comic in series
    let nextInSeries = null;
    if (typeof global.getNextComicInSeries === 'function') {
      nextInSeries = await global.getNextComicInSeries();
      console.log('[End Nav] Next in series:', nextInSeries?.name || 'none');

      if (nextInSeries) {
        if (seriesBtn) seriesBtn.classList.remove('hidden');
        if (fullscreenSeriesBtn) fullscreenSeriesBtn.classList.remove('hidden');
        hasVisibleButtons = true;
      } else {
        if (seriesBtn) seriesBtn.classList.add('hidden');
        if (fullscreenSeriesBtn) fullscreenSeriesBtn.classList.add('hidden');
      }
    }

    // Check for next comic in reading list
    let nextInList = null;
    if (typeof global.getNextComicInReadingList === 'function') {
      nextInList = await global.getNextComicInReadingList();
      console.log('[End Nav] Next in reading list:', nextInList?.name || 'none');

      if (nextInList) {
        if (readingListBtn) readingListBtn.classList.remove('hidden');
        if (fullscreenReadingListBtn) fullscreenReadingListBtn.classList.remove('hidden');
        hasVisibleButtons = true;
      } else {
        if (readingListBtn) readingListBtn.classList.add('hidden');
        if (fullscreenReadingListBtn) fullscreenReadingListBtn.classList.add('hidden');
      }
    }

    // Update regular viewer container positioning based on manga mode
    if (buttonsContainer) {
      console.log('[End Nav] Updating position for manga mode:', isMangaMode);
      if (isMangaMode) {
        buttonsContainer.classList.remove('justify-end');
        buttonsContainer.classList.add('justify-start');
      } else {
        buttonsContainer.classList.remove('justify-start');
        buttonsContainer.classList.add('justify-end');
      }
    }

    // Show containers only if there are visible buttons
    console.log('[End Nav] Has visible buttons?', hasVisibleButtons);
    if (hasVisibleButtons) {
      if (container) container.classList.remove('hidden');
      if (fullscreenContainer) fullscreenContainer.classList.remove('hidden');
    } else {
      if (container) container.classList.add('hidden');
      if (fullscreenContainer) fullscreenContainer.classList.add('hidden');
    }
  }

  async function renderPage() {
    console.log('[renderPage] START - currentPageIndex:', global.currentPageIndex);
    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) {
      console.log('[renderPage] No pages found');
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-gray-400">No pages found.</div>`;
      }
      global.updateViewerPageCounter?.([]);
      return false;
    }

    global.currentPageIndex = Math.max(0, Math.min(global.currentPageIndex, pages.length - 1));
    const requestedIndex = global.currentPageIndex;
    console.log('[renderPage] Rendering page index:', requestedIndex);

    global.updateViewerPageCounter?.(pages);
    global.hidePageJumpInput?.({ focusButton: false });

    if (global.pageLoader) {
      console.log('[renderPage] Showing normal page loader');
      global.pageLoader.classList.remove('hidden');
      global.pageLoader.classList.add('flex');
    }

    // Show fullscreen loader if in fullscreen mode
    const fullscreenPageLoader = document.getElementById('fullscreen-page-loader');
    const isFullscreenActive = global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden');
    console.log('[renderPage] Fullscreen active?', isFullscreenActive, 'Loader element?', !!fullscreenPageLoader);
    if (isFullscreenActive && fullscreenPageLoader) {
      console.log('[renderPage] Showing fullscreen loader');
      fullscreenPageLoader.classList.remove('hidden');
      fullscreenPageLoader.classList.add('flex');
    }

    try {
      // In manga mode, button roles are reversed, so disable logic must be reversed too
      const isMangaMode = global.currentComic?.mangaMode || false;

      // Update normal viewer navigation buttons
      if (global.prevPageBtn) {
        global.prevPageBtn.disabled = isMangaMode
          ? requestedIndex === pages.length - 1  // In manga mode, prev goes forward
          : requestedIndex === 0;                // In normal mode, prev goes backward
      }
      if (global.nextPageBtn) {
        global.nextPageBtn.disabled = isMangaMode
          ? requestedIndex === 0                 // In manga mode, next goes backward
          : requestedIndex === pages.length - 1; // In normal mode, next goes forward
      }

      // Update bottom navigation buttons with same logic
      if (global.prevPageBtnBottom) {
        global.prevPageBtnBottom.disabled = isMangaMode
          ? requestedIndex === pages.length - 1
          : requestedIndex === 0;
      }
      if (global.nextPageBtnBottom) {
        global.nextPageBtnBottom.disabled = isMangaMode
          ? requestedIndex === 0
          : requestedIndex === pages.length - 1;
      }

      // Update fullscreen navigation buttons with same logic
      if (global.fullscreenPrevPageBtn) {
        global.fullscreenPrevPageBtn.disabled = isMangaMode
          ? requestedIndex === pages.length - 1
          : requestedIndex === 0;
      }
      if (global.fullscreenNextPageBtn) {
        global.fullscreenNextPageBtn.disabled = isMangaMode
          ? requestedIndex === 0
          : requestedIndex === pages.length - 1;
      }

      console.log('[renderPage] Getting page URL for page:', pages[requestedIndex]);
      const pageUrl = await getPageUrl(pages[requestedIndex]);
      console.log('[renderPage] Got page URL:', pageUrl);
      let img = global.preloadedImages?.get(pageUrl);
      console.log('[renderPage] Image in cache?', !!img);
      if (!img) {
        console.log('[renderPage] Creating new image element');
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = pageUrl;
        global.preloadedImages?.set(pageUrl, img);
      }

      console.log('[renderPage] Waiting for image to load, img.complete=', img.complete);
      await new Promise((resolve, reject) => {
        if (img.complete) {
          console.log('[renderPage] Image already complete');
          resolve();
        } else {
          console.log('[renderPage] Waiting for image onload...');
          img.onload = () => {
            console.log('[renderPage] Image loaded successfully');
            resolve();
          };
          img.onerror = (err) => {
            console.error('[renderPage] Image load error:', err);
            reject(err);
          };
        }
      });
      console.log('[renderPage] Image loading complete');

      img.alt = `Page ${requestedIndex + 1}`;
      img.className = 'viewer-image rounded-lg shadow-xl';

      if (requestedIndex !== global.currentPageIndex) {
        return false;
      }

      if (global.viewerPagesDiv) {
        const oldImg = global.viewerPagesDiv.querySelector('img.viewer-image');
        if (oldImg) oldImg.remove();
        global.viewerPagesDiv.appendChild(img);
      }

      global.applyOrientationToElement?.(img);
      global.applyViewerFitMode?.(img);

      // Update fullscreen image if fullscreen is active
      if (global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden') && global.fullscreenImage) {
        global.fullscreenImage.src = img.src;
        global.applyOrientationToElement?.(global.fullscreenImage);
        global.applyFullscreenFitMode?.();

        // Update fullscreen page indicator
        global.updateFullscreenPageStatus?.(global.currentPageIndex + 1, pages.length);
      }

      prunePreloadedImages(global.currentPageIndex, pages);
      preloadPages(global.currentPageIndex, pages);
      console.log('[renderPage] SUCCESS - returning true');
      return true;
    } catch (error) {
      console.error('[renderPage] ERROR:', error);
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-red-400">Failed to load page.</div>`;
      }
      return false;
    } finally {
      console.log('[renderPage] FINALLY - hiding loaders');
      if (global.pageLoader) {
        global.pageLoader.classList.add('hidden');
        global.pageLoader.classList.remove('flex');
      }

      // Hide fullscreen loader if in fullscreen mode
      const fullscreenPageLoader = document.getElementById('fullscreen-page-loader');
      const isFullscreenActive = global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden');
      if (isFullscreenActive && fullscreenPageLoader) {
        console.log('[renderPage] Hiding fullscreen loader');
        fullscreenPageLoader.classList.add('hidden');
        fullscreenPageLoader.classList.remove('flex');
      }

      // Update end-of-comic navigation
      await updateEndOfComicNavigation();

      console.log('[renderPage] END');
    }
  }

  async function saveProgress(page) {
    if (!global.currentComic) return;
    try {
      // Update local progress immediately
      if (!global.currentComic.progress) {
        global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
      }
      global.currentComic.progress.lastReadPage = page;

      // Save progress via sync manager (per-device tracking)
      if (global.window.syncManager) {
        try {
          await global.window.syncManager.updateProgress(global.currentComic.id, page);
        } catch (error) {
          
        }
      }
    } catch (error) {
      
    }
  }

  let isNavigating = false;

  async function navigatePage(direction) {
    console.log('[navigatePage] Called with direction:', direction, 'currentPageIndex:', global.currentPageIndex, 'isNavigating:', isNavigating);

    // PREVENT CONCURRENT NAVIGATIONS
    if (isNavigating) {
      console.log('[navigatePage] BLOCKED - Already navigating, ignoring this call');
      return;
    }

    if (global.isFullscreenZoomed) {
      console.log('[navigatePage] Blocked - fullscreen is zoomed');
      return;
    }
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }

    isNavigating = true;
    console.log('[navigatePage] Set isNavigating = true');

    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) {
      console.log('[navigatePage] No pages available');
      isNavigating = false;
      return;
    }

    // Apply manga mode direction reversal
    const effectiveDirection = global.getNavigationDirection ? global.getNavigationDirection(direction) : direction;
    console.log('[navigatePage] Effective direction:', effectiveDirection);

    const newIndex = global.currentPageIndex + effectiveDirection;
    console.log('[navigatePage] New index would be:', newIndex, 'pages.length:', pages.length);
    if (newIndex < 0 || newIndex >= pages.length) {
      console.log('[navigatePage] New index out of bounds, returning');
      isNavigating = false;
      return;
    }

    const scrollY = global.window.scrollY;
    global.currentPageIndex = newIndex;
    console.log('[navigatePage] Updated currentPageIndex to:', global.currentPageIndex);
    global.hidePageJumpInput?.({ focusButton: false });

    try {
      console.log('[navigatePage] Starting page load and progress save...');
      const comicFromDB = await global.getComicFromDB?.(global.currentComic.id);
      const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id) || !!comicFromDB;

      if (isDownloaded) {
        // Save to IndexedDB for offline access
        try {
          await saveProgressToDB(
            global.currentComic.id,
            global.currentPageIndex,
            global.currentComic.progress?.totalPages,
            global.currentComic.path,
          );
        } catch (error) {
          
        }

        // Update local progress
        if (!global.currentComic.progress) {
          global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
        }
        global.currentComic.progress.lastReadPage = global.currentPageIndex;
        global.downloadedComicIds?.add(global.currentComic.id);
        global.updateLibraryProgress?.(global.currentComic.id, global.currentPageIndex, global.currentComic.progress.totalPages);

        // ALSO sync to server with per-device progress (same as online comics)
        if (navigator.onLine) {
          await saveProgress(global.currentPageIndex);
        }
      } else {
        try {
          await saveProgress(global.currentPageIndex);
          // Also update the library data so it has the latest progress
          if (global.updateLibraryProgress) {
            global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
          }
        } catch (error) {
          
        }
      }

      console.log('[navigatePage] Calling renderPage...');
      const rendered = await renderPage();
      console.log('[navigatePage] renderPage returned:', rendered);
      if (rendered) {
        global.window.scrollTo(0, scrollY);
      }
      console.log('[navigatePage] COMPLETE');
    } catch (error) {
      console.error('[navigatePage] ERROR:', error);
    } finally {
      isNavigating = false;
      console.log('[navigatePage] Set isNavigating = false (released lock)');
    }
  }

  async function loadComicSummary() {
    resetComicSummary();
    try {
      // First check if we have the metadata cached in the current comic object
      if (global.currentComic?.metadata?.Summary) {
        global.currentMetadata = global.currentComic.metadata;
        setComicSummary(global.currentComic.metadata.Summary);
        return;
      }

      // Try to fetch from server if online
      if (navigator.onLine) {
        const response = await fetch(`${API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(global.currentComic.path))}`);
        if (!response.ok) throw new Error('Summary not found.');
        global.currentMetadata = await response.json();
        setComicSummary(global.currentMetadata.Summary);
        return;
      }

      // If offline, try to get from IndexedDB
      const downloadedComic = await global.getComicFromDB?.(global.currentComic?.id);
      if (downloadedComic?.metadata?.Summary) {
        global.currentMetadata = downloadedComic.metadata;
        setComicSummary(downloadedComic.metadata.Summary);
        return;
      }

      // No summary available
      throw new Error('Summary not available offline');
    } catch (error) {
      
      resetComicSummary();
    }
  }

  function resetComicSummary() {
    if (global.comicSummaryContent) {
      global.comicSummaryContent.textContent = '';
      global.comicSummaryContent.classList.add('hidden');
      global.comicSummaryContent.scrollTop = 0;
    }
    if (global.comicSummaryToggle) {
      global.comicSummaryToggle.setAttribute('aria-expanded', 'false');
      global.comicSummaryToggle.textContent = 'Show Summary';
    }
    if (global.comicSummarySection) {
      global.comicSummarySection.classList.add('hidden');
    }
  }

  function setComicSummary(summaryText, { preserveExpansion = false } = {}) {
    if (!global.comicSummarySection || !global.comicSummaryContent || !global.comicSummaryToggle) return;
    const text = typeof summaryText === 'string' ? summaryText.trim() : '';
    if (!text) {
      resetComicSummary();
      return;
    }

    const wasExpanded = global.comicSummaryToggle.getAttribute('aria-expanded') === 'true';
    global.comicSummaryContent.textContent = text;
    if (!preserveExpansion || !wasExpanded) {
      global.comicSummaryContent.scrollTop = 0;
    }
    global.comicSummarySection.classList.remove('hidden');

    // By default, keep summary collapsed (hidden) - user must click to show
    const shouldExpand = preserveExpansion && wasExpanded;
    toggleComicSummaryVisibility(shouldExpand);
  }

  function toggleComicSummaryVisibility(forceExpanded) {
    if (!global.comicSummaryToggle || !global.comicSummaryContent) {
      return;
    }

    // Only proceed if section is visible (meaning summary content was loaded)
    if (global.comicSummarySection && global.comicSummarySection.classList.contains('hidden')) {
      return;
    }

    let shouldExpand = forceExpanded;
    if (typeof shouldExpand !== 'boolean') {
      shouldExpand = global.comicSummaryToggle.getAttribute('aria-expanded') !== 'true';
    }

    if (shouldExpand) {
      global.comicSummaryContent.classList.remove('hidden');
      global.comicSummaryToggle.setAttribute('aria-expanded', 'true');
      global.comicSummaryToggle.textContent = 'Hide Summary';
    } else {
      global.comicSummaryContent.classList.add('hidden');
      global.comicSummaryToggle.setAttribute('aria-expanded', 'false');
      global.comicSummaryToggle.textContent = 'Show Summary';
    }
  }

  function initializeViewer() {
    global.initializeViewerUIControls?.();

    if (global.pageCounterSpan && !global.pageCounterSpan._jumpListener) {
      global.pageCounterSpan._jumpListener = (event) => {
        event.preventDefault();
        global.showPageJumpInput?.();
      };
      global.pageCounterSpan.addEventListener('click', global.pageCounterSpan._jumpListener);
    }

    if (global.pageJumpInput && !global.pageJumpInput._submitListener) {
      global.pageJumpInput._submitListener = (event) => {
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        event.preventDefault();
        global.commitPageJump?.();
      };
      global.pageJumpInput.addEventListener('keydown', global.pageJumpInput._submitListener);
      global.pageJumpInput.addEventListener('blur', () => {
        global.hidePageJumpInput?.({ focusButton: false });
      });
    }

    if (global.pageCounterSpanBottom && !global.pageCounterSpanBottom._jumpListener) {
      global.pageCounterSpanBottom._jumpListener = (event) => {
        event.preventDefault();
        global.showPageJumpInputBottom?.();
      };
      global.pageCounterSpanBottom.addEventListener('click', global.pageCounterSpanBottom._jumpListener);
    }

    if (global.pageJumpInputBottom && !global.pageJumpInputBottom._submitListener) {
      global.pageJumpInputBottom._submitListener = (event) => {
        if (event.type === 'keydown' && event.key !== 'Enter') return;
        event.preventDefault();
        global.commitPageJumpBottom?.();
      };
      global.pageJumpInputBottom.addEventListener('keydown', global.pageJumpInputBottom._submitListener);
      global.pageJumpInputBottom.addEventListener('blur', () => {
        global.hidePageJumpInputBottom?.({ focusButton: false });
      });
    }

    if (global.prevPageBtn && !global.prevPageBtn._navListener) {
      global.prevPageBtn._navListener = (event) => {
        event.preventDefault();
        navigatePage(-1);
      };
      global.prevPageBtn.addEventListener('click', global.prevPageBtn._navListener);
    }

    if (global.nextPageBtn && !global.nextPageBtn._navListener) {
      global.nextPageBtn._navListener = (event) => {
        event.preventDefault();
        navigatePage(1);
      };
      global.nextPageBtn.addEventListener('click', global.nextPageBtn._navListener);
    }

    if (global.prevPageBtnBottom && !global.prevPageBtnBottom._navListener) {
      global.prevPageBtnBottom._navListener = (event) => {
        event.preventDefault();
        navigatePage(-1);
      };
      global.prevPageBtnBottom.addEventListener('click', global.prevPageBtnBottom._navListener);
    }

    if (global.nextPageBtnBottom && !global.nextPageBtnBottom._navListener) {
      global.nextPageBtnBottom._navListener = (event) => {
        event.preventDefault();
        navigatePage(1);
      };
      global.nextPageBtnBottom.addEventListener('click', global.nextPageBtnBottom._navListener);
    }

    if (global.viewerTabBtn && !global.viewerTabBtn._toggleListener) {
      global.viewerTabBtn._toggleListener = (event) => {
        event.preventDefault();
        global.viewerTabBtn.classList.add('active');
        global.metadataTabBtn?.classList.remove('active');
        global.viewerContent?.classList.remove('hidden');
        global.metadataContent?.classList.add('hidden');
      };
      global.viewerTabBtn.addEventListener('click', global.viewerTabBtn._toggleListener);
    }

    if (global.metadataTabBtn && !global.metadataTabBtn._toggleListener) {
      global.metadataTabBtn._toggleListener = (event) => {
        event.preventDefault();
        global.viewerTabBtn?.classList.remove('active');
        global.metadataTabBtn.classList.add('active');
        global.viewerContent?.classList.add('hidden');
        global.metadataContent?.classList.remove('hidden');
      };
      global.metadataTabBtn.addEventListener('click', global.metadataTabBtn._toggleListener);
    }

    if (global.comicSummaryToggle && !global.comicSummaryToggle._toggleListener) {
      global.comicSummaryToggle._toggleListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleComicSummaryVisibility();
      };
      global.comicSummaryToggle.addEventListener('click', global.comicSummaryToggle._toggleListener);
    }

    if (global.metadataTabBtn && !global.metadataTabBtn._loadListener) {
      global.metadataTabBtn._loadListener = async () => {
        if (global.currentComic) {
          // Load summary (separate from metadata fields)
          if (!global.currentMetadata) {
            await loadComicSummary();
          }
          // Load metadata fields for editing
          if (typeof global.loadMetadata === 'function') {
            await global.loadMetadata();
          }
        }
      };
      global.metadataTabBtn.addEventListener('click', global.metadataTabBtn._loadListener);
    }

    // End-of-comic navigation buttons
    const nextInSeriesBtn = document.getElementById('next-in-series-btn');
    const nextInReadingListBtn = document.getElementById('next-in-reading-list-btn');

    if (nextInSeriesBtn && !nextInSeriesBtn._clickListener) {
      nextInSeriesBtn._clickListener = async () => {
        if (typeof global.getNextComicInSeries === 'function' &&
            typeof global.navigateToNextComic === 'function') {
          const nextComic = await global.getNextComicInSeries();
          if (nextComic) {
            // Don't pass reading list context for series navigation
            await global.navigateToNextComic(nextComic, {});
          }
        }
      };
      nextInSeriesBtn.addEventListener('click', nextInSeriesBtn._clickListener);
    }

    if (nextInReadingListBtn && !nextInReadingListBtn._clickListener) {
      nextInReadingListBtn._clickListener = async () => {
        if (typeof global.getNextComicInReadingList === 'function' &&
            typeof global.navigateToNextComic === 'function') {
          const nextComic = await global.getNextComicInReadingList();
          const readingListId = global.viewerReturnContext?.readingListId;
          if (nextComic && readingListId) {
            // Pass reading list context to maintain context chain
            await global.navigateToNextComic(nextComic, { readingListId });
          }
        }
      };
      nextInReadingListBtn.addEventListener('click', nextInReadingListBtn._clickListener);
    }

    // Fullscreen end-of-comic navigation buttons
    const fullscreenNextInSeriesBtn = document.getElementById('fullscreen-next-in-series-btn');
    const fullscreenNextInReadingListBtn = document.getElementById('fullscreen-next-in-reading-list-btn');

    if (fullscreenNextInSeriesBtn && !fullscreenNextInSeriesBtn._clickListener) {
      fullscreenNextInSeriesBtn._clickListener = async () => {
        if (typeof global.getNextComicInSeries === 'function' &&
            typeof global.navigateToNextComic === 'function') {
          const nextComic = await global.getNextComicInSeries();
          if (nextComic) {
            // Don't pass reading list context for series navigation
            await global.navigateToNextComic(nextComic, {});
          }
        }
      };
      fullscreenNextInSeriesBtn.addEventListener('click', fullscreenNextInSeriesBtn._clickListener);
    }

    if (fullscreenNextInReadingListBtn && !fullscreenNextInReadingListBtn._clickListener) {
      fullscreenNextInReadingListBtn._clickListener = async () => {
        if (typeof global.getNextComicInReadingList === 'function' &&
            typeof global.navigateToNextComic === 'function') {
          const nextComic = await global.getNextComicInReadingList();
          const readingListId = global.viewerReturnContext?.readingListId;
          if (nextComic && readingListId) {
            // Pass reading list context to maintain context chain
            await global.navigateToNextComic(nextComic, { readingListId });
          }
        }
      };
      fullscreenNextInReadingListBtn.addEventListener('click', fullscreenNextInReadingListBtn._clickListener);
    }

    global.document.addEventListener('keyup', (event) => {
      if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        return;
      }
      // Note: navigatePage already handles manga mode direction internally
      if (event.key === 'ArrowLeft') {
        navigatePage(-1);
      } else if (event.key === 'ArrowRight') {
        navigatePage(1);
      }
    });
  }

  const ViewerOrchestrator = {
    getPageUrl,
    preloadPages,
    prunePreloadedImages,
    renderPage,
    navigatePage,
    saveProgress,
    loadComicSummary,
    resetComicSummary,
    setComicSummary,
    toggleComicSummaryVisibility,
  };

  Object.assign(global, ViewerOrchestrator);
  initializeViewer();
})(typeof window !== 'undefined' ? window : globalThis);
