(function (global) {
  'use strict';

  const PAGE_COUNTER_PLACEHOLDER = '\u2014 / \u2014';
  let isPageJumpInputOpen = false;

  const PORTRAIT_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12" y2="18"></line></svg>`;
  const LANDSCAPE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="18" y1="12" x2="18" y2="12"></line></svg>`;
  const CONTINUOUS_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><path d="M12 6v12"></path><path d="M9 9l3-3 3 3"></path><path d="M9 15l3 3 3-3"></path></svg>`;
  const MANGA_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3c-1.1 0-2 .9-2 2 0 .52.21 1.04.59 1.41L15 7h-1l-1.5-1.5c-.37-.38-.89-.5-1.41-.5-1.1 0-2 .9-2 2 0 .52.21 1.04.59 1.41L7 11v1l-3 5v2h2l5-3h1l3.59-2.41c.38-.38.5-.89.5-1.41 0-1.1-.9-2-2-2-.52 0-1.04.21-1.41.59L11 10V9l1.5-1.5c.38-.37.89-.5 1.41-.5 1.1 0 2 .9 2 2 0 .52-.21 1.04-.59 1.41L17 12h1l2.41-3.59c.38-.38.59-.9.59-1.41 0-1.1-.9-2-2-2z"></path><path d="M11 13l1 1"></path><path d="M15 9l1 1"></path><path d="M8 16l-4 4"></path></svg>`;

  function getViewerPages() {
    if (!global.viewerPagesDiv) return [];
    try {
      const raw = global.viewerPagesDiv.dataset.pages;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      
      return [];
    }
  }

  function getPageCounterTotal() {
    const pages = getViewerPages();
    return Array.isArray(pages) ? pages.length : 0;
  }

  function updateFullscreenPageStatusProxy(current, total) {
    if (typeof global.updateFullscreenPageStatus === 'function') {
      global.updateFullscreenPageStatus(current, total);
    }
  }

  function updateViewerPageCounter(pages) {
    if (window.currentComic) {
      const newPath = `/comic/${window.currentComic.id}/page/${window.currentPageIndex + 1}`;
      if (getRelativePath() !== newPath) {
        const fullPath = window.router ? window.router.getFullPath(newPath) : newPath;
        window.history.replaceState({ path: fullPath }, '', fullPath);
      }
    }

    const counter = global.pageCounterSpan;
    const counterBottom = global.pageCounterSpanBottom;
    if (!counter && !counterBottom) return;

    const pageList = Array.isArray(pages) ? pages : getViewerPages();
    const totalPages = pageList.length;

    if (totalPages <= 0) {
      if (counter) {
        counter.textContent = PAGE_COUNTER_PLACEHOLDER;
        counter.dataset.totalPages = '0';
        counter.disabled = true;
        counter.setAttribute('aria-disabled', 'true');
        counter.setAttribute('aria-expanded', 'false');
        counter.setAttribute('aria-label', 'Page navigation unavailable');
      }
      if (counterBottom) {
        counterBottom.textContent = PAGE_COUNTER_PLACEHOLDER;
        counterBottom.dataset.totalPages = '0';
        counterBottom.disabled = true;
        counterBottom.setAttribute('aria-disabled', 'true');
        counterBottom.setAttribute('aria-expanded', 'false');
        counterBottom.setAttribute('aria-label', 'Page navigation unavailable');
      }
      if (global.pageJumpInput) {
        global.pageJumpInput.setAttribute('max', '0');
      }
      if (global.pageJumpInputBottom) {
        global.pageJumpInputBottom.setAttribute('max', '0');
      }
      updateFullscreenPageStatusProxy(0, 0);
      return;
    }

    const current = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
    const text = `${current} / ${totalPages}`;
    const ariaLabel = `Current page ${current} of ${totalPages}. Activate to jump to a specific page.`;

    if (counter) {
      counter.textContent = text;
      counter.dataset.totalPages = String(totalPages);
      counter.disabled = false;
      counter.removeAttribute('aria-disabled');
      counter.setAttribute('aria-label', ariaLabel);
      counter.setAttribute('aria-expanded', isPageJumpInputOpen ? 'true' : 'false');
      counter.classList.toggle('page-counter-hidden', isPageJumpInputOpen);
    }

    if (counterBottom) {
      counterBottom.textContent = text;
      counterBottom.dataset.totalPages = String(totalPages);
      counterBottom.disabled = false;
      counterBottom.removeAttribute('aria-disabled');
      counterBottom.setAttribute('aria-label', ariaLabel);
      counterBottom.setAttribute('aria-expanded', 'false');
    }

    if (global.pageJumpInput) {
      global.pageJumpInput.setAttribute('max', String(totalPages));
    }

    if (global.pageJumpInputBottom) {
      global.pageJumpInputBottom.setAttribute('max', String(totalPages));
    }

    updateFullscreenPageStatusProxy(current, totalPages);
  }

  /**
   * Updates navigation button labels and disabled states based on current index and manga mode.
   */
  function updateNavigationButtons(requestedIndex, totalPages, isMangaMode) {
    // Normal viewer buttons
    if (global.prevPageBtn) {
      const label = isMangaMode ? 'Next page' : 'Previous page';
      global.prevPageBtn.setAttribute('aria-label', label);
      global.prevPageBtn.setAttribute('title', label);
      global.prevPageBtn.disabled = isMangaMode
        ? requestedIndex === totalPages - 1
        : requestedIndex === 0;
    }
    if (global.nextPageBtn) {
      const label = isMangaMode ? 'Previous page' : 'Next page';
      global.nextPageBtn.setAttribute('aria-label', label);
      global.nextPageBtn.setAttribute('title', label);
      global.nextPageBtn.disabled = isMangaMode
        ? requestedIndex === 0
        : requestedIndex === totalPages - 1;
    }

    // Bottom navigation buttons
    if (global.prevPageBtnBottom) {
      const label = isMangaMode ? 'Next page' : 'Previous page';
      global.prevPageBtnBottom.setAttribute('aria-label', label);
      global.prevPageBtnBottom.setAttribute('title', label);
      global.prevPageBtnBottom.disabled = isMangaMode
        ? requestedIndex === totalPages - 1
        : requestedIndex === 0;
    }
    if (global.nextPageBtnBottom) {
      const label = isMangaMode ? 'Previous page' : 'Next page';
      global.nextPageBtnBottom.setAttribute('aria-label', label);
      global.nextPageBtnBottom.setAttribute('title', label);
      global.nextPageBtnBottom.disabled = isMangaMode
        ? requestedIndex === 0
        : requestedIndex === totalPages - 1;
    }

    // Fullscreen navigation buttons
    if (global.fullscreenPrevPageBtn) {
      const label = isMangaMode ? 'Next page' : 'Previous page';
      global.fullscreenPrevPageBtn.setAttribute('aria-label', label);
      global.fullscreenPrevPageBtn.setAttribute('title', label);
      global.fullscreenPrevPageBtn.disabled = isMangaMode
        ? requestedIndex === totalPages - 1
        : requestedIndex === 0;
    }
    if (global.fullscreenNextPageBtn) {
      const label = isMangaMode ? 'Previous page' : 'Next page';
      global.fullscreenNextPageBtn.setAttribute('aria-label', label);
      global.fullscreenNextPageBtn.setAttribute('title', label);
      global.fullscreenNextPageBtn.disabled = isMangaMode
        ? requestedIndex === 0
        : requestedIndex === totalPages - 1;
    }
  }

  function showPageJumpInput() {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input || counter.disabled) return;

    const totalPages = getPageCounterTotal();
    if (totalPages <= 0) return;

    isPageJumpInputOpen = true;
    const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
    input.setAttribute('min', '1');
    input.setAttribute('max', String(totalPages));
    input.value = String(currentPage);
    input.classList.remove('hidden');
    counter.classList.add('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function hidePageJumpInput({ focusButton = true, resetValue = true } = {}) {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input) return;

    if (resetValue) {
      input.value = '';
    }

    if (!isPageJumpInputOpen && input.classList.contains('hidden')) {
      return;
    }

    isPageJumpInputOpen = false;
    input.classList.add('hidden');
    counter.classList.remove('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'false');

    if (focusButton && !counter.disabled) {
      counter.focus();
    }
  }

  async function commitPageJump() {
    const counter = global.pageCounterSpan;
    const input = global.pageJumpInput;
    if (!counter || !input) return;

    const totalPages = getPageCounterTotal();
    if (totalPages <= 0) {
      hidePageJumpInput({ focusButton: false });
      return;
    }

    const rawValue = input.value.trim();
    if (rawValue === '') {
      hidePageJumpInput({ focusButton: true });
      return;
    }

    const targetPage = Number.parseInt(rawValue, 10);
    if (Number.isNaN(targetPage)) {
      const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
      input.value = String(currentPage);
      input.select();
      return;
    }

    const clampedPage = Math.min(totalPages, Math.max(1, targetPage));
    hidePageJumpInput({ focusButton: false });

    if (clampedPage - 1 === global.currentPageIndex) {
      updateViewerPageCounter(totalPages);
      if (!counter.disabled) {
        counter.focus();
      }
      return;
    }

    const previousIndex = global.currentPageIndex;
    global.currentPageIndex = clampedPage - 1;

    try {
      // Save progress before rendering
      if (global.currentComic) {
        const comicFromDB = await global.getComicFromDB?.(global.currentComic.id);
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id) || !!comicFromDB;

        if (isDownloaded) {
          // Save to IndexedDB for offline access
          try {
            if (typeof saveProgressToDB === 'function') {
              saveProgressToDB(
                global.currentComic.id,
                global.currentPageIndex,
                global.currentComic.progress?.totalPages,
                global.currentComic.path,
              );
            }
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
          if (navigator.onLine && typeof saveProgress === 'function') {
            saveProgress(global.currentPageIndex);
          }
        } else {
          try {
            if (typeof saveProgress === 'function') {
              saveProgress(global.currentPageIndex);
            }
            // Also update the library data so it has the latest progress
            if (global.updateLibraryProgress) {
              global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
            }
          } catch (error) {

          }
        }
      }

      const rendered = await global.renderPage?.();
      if (rendered === false) {
        global.currentPageIndex = previousIndex;
        updateViewerPageCounter(totalPages);
      }
    } catch (error) {
      global.currentPageIndex = previousIndex;

      updateViewerPageCounter(totalPages);
    } finally {
      if (!counter.disabled) {
        counter.focus();
      }
    }
  }

  function showPageJumpInputBottom() {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input || counter.disabled) return;

    const totalPages = getPageCounterTotal();
    if (totalPages <= 0) return;

    const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
    input.setAttribute('min', '1');
    input.setAttribute('max', String(totalPages));
    input.value = String(currentPage);
    input.classList.remove('hidden');
    counter.classList.add('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function hidePageJumpInputBottom({ focusButton = true, resetValue = true } = {}) {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input) return;

    if (resetValue) {
      input.value = '';
    }

    if (input.classList.contains('hidden')) {
      return;
    }

    input.classList.add('hidden');
    counter.classList.remove('page-counter-hidden');
    counter.setAttribute('aria-expanded', 'false');

    if (focusButton && !counter.disabled) {
      counter.focus();
    }
  }

  async function commitPageJumpBottom() {
    const counter = global.pageCounterSpanBottom;
    const input = global.pageJumpInputBottom;
    if (!counter || !input) return;

    const totalPages = getPageCounterTotal();
    if (totalPages <= 0) {
      hidePageJumpInputBottom({ focusButton: false });
      return;
    }

    const rawValue = input.value.trim();
    if (rawValue === '') {
      hidePageJumpInputBottom({ focusButton: true });
      return;
    }

    const targetPage = Number.parseInt(rawValue, 10);
    if (Number.isNaN(targetPage)) {
      const currentPage = Math.min(totalPages, Math.max(1, global.currentPageIndex + 1));
      input.value = String(currentPage);
      input.select();
      return;
    }

    const clampedPage = Math.min(totalPages, Math.max(1, targetPage));
    hidePageJumpInputBottom({ focusButton: false });

    if (clampedPage - 1 === global.currentPageIndex) {
      updateViewerPageCounter(totalPages);
      if (!counter.disabled) {
        counter.focus();
      }
      return;
    }

    const previousIndex = global.currentPageIndex;
    global.currentPageIndex = clampedPage - 1;

    try {
      // Save progress before rendering
      if (global.currentComic) {
        const comicFromDB = await global.getComicFromDB?.(global.currentComic.id);
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id) || !!comicFromDB;

        if (isDownloaded) {
          // Save to IndexedDB for offline access
          try {
            if (typeof saveProgressToDB === 'function') {
              saveProgressToDB(
                global.currentComic.id,
                global.currentPageIndex,
                global.currentComic.progress?.totalPages,
                global.currentComic.path,
              );
            }
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
          if (navigator.onLine && typeof saveProgress === 'function') {
            saveProgress(global.currentPageIndex);
          }
        } else {
          try {
            if (typeof saveProgress === 'function') {
              saveProgress(global.currentPageIndex);
            }
            // Also update the library data so it has the latest progress
            if (global.updateLibraryProgress) {
              global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
            }
          } catch (error) {

          }
        }
      }

      const rendered = await global.renderPage?.();
      if (rendered === false) {
        global.currentPageIndex = previousIndex;
        updateViewerPageCounter(totalPages);
      }
    } catch (error) {
      global.currentPageIndex = previousIndex;

      updateViewerPageCounter(totalPages);
    } finally {
      if (!counter.disabled) {
        counter.focus();
      }
    }
  }

  function computeViewerAvailableHeight() {
    const headerHeight = global.document.querySelector('#comic-viewer > .w-full:nth-child(1)')?.offsetHeight || 0;
    const tabsHeight = global.document.querySelector('#comic-viewer .w-full.flex.justify-center')?.offsetHeight || 0;
    const totalHeight = global.window.innerHeight || 0;
    return totalHeight - headerHeight - tabsHeight - 120;
  }

  function applyOrientationToElement(element) {
    if (!element) return;
    const target = element;
    if (global.isLandscapeOrientation) {
      target.classList.add('orientation-landscape');
    } else {
      target.classList.remove('orientation-landscape');
      target.style.transform = '';
      target.style.transformOrigin = '';
    }
  }

  function applyViewerOrientation() {
    const images = global.viewerPagesDiv?.querySelectorAll('img.viewer-image') || [];
    images.forEach(img => applyOrientationToElement(img));
  }

  function applyViewerFitMode(imgElement) {
    const availableHeight = computeViewerAvailableHeight();
    const target = imgElement || global.viewerPagesDiv?.querySelector('img.viewer-image');
    if (!target) return;

    if (global.isFitToHeight) {
      // Fit to height: limit height, let width adjust
      target.style.setProperty('max-height', `${availableHeight}px`, 'important');
      target.style.setProperty('width', 'auto', 'important');
      target.style.setProperty('max-width', '100%', 'important');
      target.style.setProperty('height', 'auto', 'important');
    } else {
      // Fit to width: limit width, let height adjust
      target.style.setProperty('max-height', 'none', 'important');
      target.style.setProperty('width', '100%', 'important');
      target.style.setProperty('max-width', '100%', 'important');
      target.style.setProperty('height', 'auto', 'important');
    }
  }

  function setFitToHeightMode(enable) {
    global.isFitToHeight = Boolean(enable);
    // Also update the local variable in globals.js if it exists
    if (typeof window !== 'undefined' && 'isFitToHeight' in window) {
      window.isFitToHeight = global.isFitToHeight;
    }
    if (global.fitHeightBtn) {
      global.fitHeightBtn.setAttribute('aria-pressed', global.isFitToHeight ? 'true' : 'false');
      global.fitHeightBtn.classList.toggle('bg-purple-600', global.isFitToHeight);
      global.fitHeightBtn.classList.toggle('hover:bg-purple-500', global.isFitToHeight);
      global.fitHeightBtn.classList.toggle('bg-gray-700', !global.isFitToHeight);
      global.fitHeightBtn.classList.toggle('hover:bg-gray-600', !global.isFitToHeight);
    }
    applyViewerFitMode();
    if (typeof global.applyFullscreenFitMode === 'function') {
      global.applyFullscreenFitMode();
    }
  }

  function refreshToolbarLabels() {
    const isMobile = typeof global.isMobileDevice === 'function' && global.isMobileDevice();
    const isDesktop = !isMobile;
    
    // Orientation
    const orientationLabel = global.isLandscapeOrientation ? LANDSCAPE_ICON_HTML : PORTRAIT_ICON_HTML;
    
    const orientationBtns = [
      global.orientationToggleBtn,
      global.fullscreenOrientationBtn,
      document.getElementById('fullscreen-orientation-btn')
    ];
    orientationBtns.forEach(btn => {
      if (btn) {
        btn.innerHTML = orientationLabel;
        btn.setAttribute('aria-pressed', global.isLandscapeOrientation ? 'true' : 'false');
      }
    });

    // Continuous Mode
    const continuousBtn = document.getElementById('fullscreen-continuous-mode-btn');
    if (continuousBtn) {
      continuousBtn.innerHTML = CONTINUOUS_ICON_HTML;
    }

    // Manga Mode
    const mangaBtn = document.getElementById('fullscreen-manga-mode-btn');
    if (mangaBtn) {
      mangaBtn.innerHTML = MANGA_ICON_HTML;
    }

    // Guided/Bubble/Hot Zoom labels are handled in guided.js refreshGuidedToggle()
    // but we can call it from here if needed.
    if (typeof global.refreshGuidedToggle === 'function') {
      global.refreshGuidedToggle();
    }
  }

  function updateOrientationButtons() {
    refreshToolbarLabels();
  }

  function applyFullscreenOrientation() {
    if (typeof global.applyOrientationToElement === 'function') {
      global.applyOrientationToElement(global.fullscreenImage);
    }
  }

  function setOrientationMode(orientation, options = {}) {
    const requested = orientation === 'landscape' || orientation === true ? 'landscape' : 'portrait';
    const newIsLandscape = requested === 'landscape';
    const persist = options.persist !== false; // default: persist user-driven changes

    if (global.isLandscapeOrientation === newIsLandscape) {
      updateOrientationButtons();
      applyViewerOrientation();
      applyFullscreenOrientation();
      return;
    }

    // Switching into landscape disables guided overlays — their math assumes
    // the portrait fit-to-stage layout.
    if (newIsLandscape) {
      global.GuidedView?.disableAll?.();
    }

    global.isLandscapeOrientation = newIsLandscape;
    if (typeof global.resetLandscapePan === 'function') global.resetLandscapePan();
    if (typeof global.refreshGuidedToggle === 'function') global.refreshGuidedToggle();
    updateOrientationButtons();
    applyViewerOrientation();
    applyFullscreenOrientation();
    if (typeof global.applyContinuousOrientation === 'function') {
      global.applyContinuousOrientation();
    }
    applyViewerFitMode();

    if (global.isFullscreenZoomed) {
      global.resetFullscreenZoom?.();
    } else {
      global.applyFullscreenFitMode?.();
    }

    // Persist landscape preference per comic so the next open of this issue
    // restores it. Mirrors the per-comic save pattern used by guided/bubble/etc.
    const comic = global.currentComic;
    if (persist && comic && comic.id != null) {
      comic.landscapeMode = newIsLandscape;
      if (typeof global.updateComicInLibrary === 'function') {
        global.updateComicInLibrary(comic.id, { landscapeMode: newIsLandscape });
      }
      const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
      fetch(`${base}/api/v1/comics/${encodeURIComponent(comic.id)}/landscape-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ landscapeMode: newIsLandscape })
      }).catch(() => { /* non-fatal */ });
    }
  }

  function initializeViewerUIControls() {
    // Check if required functions are available, if not retry later
    if (typeof global.navigateBackFromViewer !== 'function' ||
        typeof global.setFitToHeightMode !== 'function' ||
        typeof global.setOrientationMode !== 'function' ||
        typeof global.openFullscreen !== 'function' ||
        typeof global.closeFullscreen !== 'function' ||
        typeof global.navigatePage !== 'function') {
      setTimeout(initializeViewerUIControls, 100);
      return;
    }

    refreshToolbarLabels();

    // Tab switching logic
    if (global.viewerTabBtn && !global.viewerTabBtn._tabListener) {
      global.viewerTabBtn._tabListener = (e) => {
        if (e) e.preventDefault();
        global.viewerTabBtn.classList.add('active');
        global.metadataTabBtn?.classList.remove('active');
        global.viewerContent?.classList.remove('hidden');
        global.metadataContent?.classList.add('hidden');
      };
      global.viewerTabBtn.addEventListener('click', global.viewerTabBtn._tabListener);
    }

    if (global.metadataTabBtn && !global.metadataTabBtn._tabListener) {
      global.metadataTabBtn._tabListener = (e) => {
        if (e) e.preventDefault();

        // Security check: Only admins can access metadata
        const isAdmin = window.syncManager && window.syncManager.userRole === 'admin';
        if (!isAdmin) {
          console.warn('[Viewer] Non-admin user tried to access metadata view');
          return;
        }

        global.metadataTabBtn.classList.add('active');
        global.viewerTabBtn?.classList.remove('active');
        global.metadataContent?.classList.remove('hidden');
        global.viewerContent?.classList.add('hidden');
        if (typeof global.loadMetadata === 'function') {
          global.loadMetadata();
        }
      };
      global.metadataTabBtn.addEventListener('click', global.metadataTabBtn._tabListener);
    }

    if (global.viewerLibrariesBtn && !global.viewerLibrariesBtn._navListener) {
      global.viewerLibrariesBtn._navListener = (event) => {
        event.preventDefault();
        global.navigateBackFromViewer(null);
      };
      global.viewerLibrariesBtn.addEventListener('click', global.viewerLibrariesBtn._navListener);
    }

    if (global.viewerPublisherBtn && !global.viewerPublisherBtn._navListener) {
      global.viewerPublisherBtn._navListener = (event) => {
        event.preventDefault();
        if (global.currentRootFolder) {
          global.navigateBackFromViewer({ view: 'publishers', rootFolder: global.currentRootFolder });
        } else {
          global.navigateBackFromViewer(null);
        }
      };
      global.viewerPublisherBtn.addEventListener('click', global.viewerPublisherBtn._navListener);
    }

    if (global.viewerSeriesBtn && !global.viewerSeriesBtn._navListener) {
      global.viewerSeriesBtn._navListener = (event) => {
        event.preventDefault();
        if (global.currentRootFolder && global.currentPublisher) {
          global.navigateBackFromViewer({
            view: 'series',
            rootFolder: global.currentRootFolder,
            publisher: global.currentPublisher,
          });
        } else if (global.currentRootFolder) {
          global.navigateBackFromViewer({ view: 'publishers', rootFolder: global.currentRootFolder });
        } else {
          global.navigateBackFromViewer(null);
        }
      };
      global.viewerSeriesBtn.addEventListener('click', global.viewerSeriesBtn._navListener);
    }

    if (global.fitHeightBtn && !global.fitHeightBtn._toggleListener) {
      global.fitHeightBtn._toggleListener = () => {
        global.setFitToHeightMode(!global.isFitToHeight);
      };
      global.fitHeightBtn.addEventListener('click', global.fitHeightBtn._toggleListener);
      global.setFitToHeightMode(global.isFitToHeight);
    }


    if (global.orientationToggleBtn && !global.orientationToggleBtn._toggleListener) {
      global.orientationToggleBtn._toggleListener = () => {
        global.setOrientationMode(global.isLandscapeOrientation ? 'portrait' : 'landscape');
      };
      global.orientationToggleBtn.addEventListener('click', global.orientationToggleBtn._toggleListener);
    }

    if (global.fullscreenOrientationBtn && !global.fullscreenOrientationBtn._toggleListener) {
      global.fullscreenOrientationBtn._toggleListener = () => {
        global.setOrientationMode(global.isLandscapeOrientation ? 'portrait' : 'landscape');
      };
      global.fullscreenOrientationBtn.addEventListener('click', global.fullscreenOrientationBtn._toggleListener);
    }

    if (global.fullscreenBtn && !global.fullscreenBtn._openListener) {
      global.fullscreenBtn._openListener = (event) => {
        event.preventDefault();
        global.openFullscreen();
      };
      global.fullscreenBtn.addEventListener('click', global.fullscreenBtn._openListener);
    }

    if (global.fullscreenCloseBtn && !global.fullscreenCloseBtn._closeListener) {
      global.fullscreenCloseBtn._closeListener = (event) => {
        event.preventDefault();
        global.closeFullscreen();
      };
      global.fullscreenCloseBtn.addEventListener('click', global.fullscreenCloseBtn._closeListener);
    }

    if (global.fullscreenCloseBtnBottom && !global.fullscreenCloseBtnBottom._closeListener) {
      global.fullscreenCloseBtnBottom._closeListener = (event) => {
        event.preventDefault();
        global.closeFullscreen();
      };
      global.fullscreenCloseBtnBottom.addEventListener('click', global.fullscreenCloseBtnBottom._closeListener);
    }

    // Side-nav hotspots (#fullscreen-nav-left / -right) are exclusively long-press
    // triggers — no single-click navigation. Long-press is handled by
    // bindFullscreenLongPress on the viewer; the overlay divs let pointer events
    // through to the viewer (and CSS gates them off entirely when zoomed).

    const fullscreenImage = global.fullscreenImage;
    const fullscreenViewer = global.fullscreenViewer;
    if (fullscreenViewer && !fullscreenViewer._viewerPointerListenersAttached) {
      fullscreenViewer.addEventListener('pointerdown', global.handleFullscreenPointerDown);
      fullscreenViewer.addEventListener('pointermove', global.handleFullscreenPointerMove);
      fullscreenViewer.addEventListener('pointerup', global.handleFullscreenPointerUp);
      fullscreenViewer.addEventListener('pointercancel', global.handleFullscreenPointerUp);
      fullscreenViewer._viewerPointerListenersAttached = true;
    }
    if (typeof global.bindFullscreenLongPress === 'function') {
      global.bindFullscreenLongPress();
    }
    if (typeof global.bindFullscreenZoomToggle === 'function') {
      global.bindFullscreenZoomToggle();
    }
    if (fullscreenImage && !fullscreenImage._viewerListenersAttached) {
      fullscreenImage.addEventListener('click', global.handleFullscreenImageClick);
      fullscreenImage._viewerListenersAttached = true;
    }

    // Tapping the viewer background (the dark borders above / below / beside
    // the comic page) should also surface controls — same behaviour as a
    // single tap on the image itself.
    if (fullscreenViewer && !fullscreenViewer._bgClickAttached) {
      fullscreenViewer._bgClickAttached = true;
      fullscreenViewer.addEventListener('click', (event) => {
        if (event.target !== fullscreenViewer) return;
        global.showFullscreenControls?.(true);
      });
    }

    if (!document._viewerEscListener) {
      document._viewerEscListener = (event) => {
        if (event.key === 'Escape' && global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden')) {
          event.preventDefault();
          closeFullscreen();
        }
      };
      document.addEventListener('keydown', document._viewerEscListener);
    }

    if (!document._viewerFullscreenListener) {
      document._viewerFullscreenListener = () => {
        if (!document.fullscreenElement && global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden')) {
          closeFullscreen();
        }
      };
      document.addEventListener('fullscreenchange', document._viewerFullscreenListener);
    }

    setOrientationMode(global.isLandscapeOrientation ? 'landscape' : 'portrait');
    global.debugLog?.('UI', 'Viewer controls initialized');
  }

  const ViewerUI = {
    PAGE_COUNTER_PLACEHOLDER,
    isPageJumpInputOpen: () => isPageJumpInputOpen,
    getViewerPages,
    getPageCounterTotal,
    updateViewerPageCounter,
    showPageJumpInput,
    hidePageJumpInput,
    commitPageJump,
    showPageJumpInputBottom,
    hidePageJumpInputBottom,
    commitPageJumpBottom,
    computeViewerAvailableHeight,
    applyOrientationToElement,
    applyViewerOrientation,
    applyViewerFitMode,
    setFitToHeightMode,
    updateOrientationButtons,
    updateNavigationButtons,
    setOrientationMode,
    initializeViewerUIControls,
  };

  global.ViewerUI = ViewerUI;
  Object.assign(global, ViewerUI);
})(typeof window !== 'undefined' ? window : globalThis);
