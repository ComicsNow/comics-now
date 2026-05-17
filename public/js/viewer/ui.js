(function (global) {
  'use strict';

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
        counter.textContent = global.PAGE_COUNTER_PLACEHOLDER;
        counter.dataset.totalPages = '0';
        counter.disabled = true;
        counter.setAttribute('aria-disabled', 'true');
        counter.setAttribute('aria-expanded', 'false');
        counter.setAttribute('aria-label', 'Page navigation unavailable');
      }
      if (counterBottom) {
        counterBottom.textContent = global.PAGE_COUNTER_PLACEHOLDER;
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

    const isPageJumpInputOpen = global.isPageJumpInputOpenGetter ? global.isPageJumpInputOpenGetter() : false;

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

  const ViewerUI = {
    PAGE_COUNTER_PLACEHOLDER: global.PAGE_COUNTER_PLACEHOLDER,
    isPageJumpInputOpen: global.isPageJumpInputOpenGetter,
    getViewerPages,
    getPageCounterTotal,
    updateViewerPageCounter,
    showPageJumpInput: global.showPageJumpInput,
    hidePageJumpInput: global.hidePageJumpInput,
    commitPageJump: global.commitPageJump,
    showPageJumpInputBottom: global.showPageJumpInputBottom,
    hidePageJumpInputBottom: global.hidePageJumpInputBottom,
    commitPageJumpBottom: global.commitPageJumpBottom,
    computeViewerAvailableHeight: global.computeViewerAvailableHeight,
    applyOrientationToElement: global.applyOrientationToElement,
    applyViewerOrientation: global.applyViewerOrientation,
    applyViewerFitMode: global.applyViewerFitMode,
    setFitToHeightMode: global.setFitToHeightMode,
    updateOrientationButtons: global.updateOrientationButtons,
    updateNavigationButtons,
    setOrientationMode: global.setOrientationMode,
    initializeViewerUIControls: global.initializeViewerUIControls,
    resetComicSummary: global.resetComicSummary,
    setComicSummary: global.setComicSummary,
    loadComicSummary: global.loadComicSummary,
  };

  global.ViewerUI = ViewerUI;
  Object.assign(global, ViewerUI);
})(typeof window !== 'undefined' ? window : globalThis);
