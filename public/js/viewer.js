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

  async function renderPage() {
    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) {
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-gray-400">No pages found.</div>`;
      }
      global.updateViewerPageCounter?.([]);
      return false;
    }

    global.currentPageIndex = Math.max(0, Math.min(global.currentPageIndex, pages.length - 1));
    const requestedIndex = global.currentPageIndex;

    global.updateViewerPageCounter?.(pages);
    global.hidePageJumpInput?.({ focusButton: false });

    if (global.pageLoader) {
      global.pageLoader.classList.remove('hidden');
      global.pageLoader.classList.add('flex');
    }

    try {
      // In manga mode, button roles are reversed, so disable logic must be reversed too
      const isMangaMode = global.currentComic?.mangaMode || false;

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

      const pageUrl = await getPageUrl(pages[requestedIndex]);
      let img = global.preloadedImages?.get(pageUrl);
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = pageUrl;
        global.preloadedImages?.set(pageUrl, img);
      }

      await new Promise((resolve, reject) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = resolve;
          img.onerror = reject;
        }
      });

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
      return true;
    } catch (error) {
      
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-red-400">Failed to load page.</div>`;
      }
      return false;
    } finally {
      if (global.pageLoader) {
        global.pageLoader.classList.add('hidden');
        global.pageLoader.classList.remove('flex');
      }
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

  async function navigatePage(direction) {
    if (global.isFullscreenZoomed) return;
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }

    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) return;

    // Apply manga mode direction reversal
    const effectiveDirection = global.getNavigationDirection ? global.getNavigationDirection(direction) : direction;

    const newIndex = global.currentPageIndex + effectiveDirection;
    if (newIndex < 0 || newIndex >= pages.length) return;

    const scrollY = global.window.scrollY;
    global.currentPageIndex = newIndex;
    global.hidePageJumpInput?.({ focusButton: false });

    try {
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

      const rendered = await renderPage();
      if (rendered) {
        global.window.scrollTo(0, scrollY);
      }
    } catch (error) {
      
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
