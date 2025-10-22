(function (global) {
  'use strict';

  const PAGE_COUNTER_PLACEHOLDER = '\u2014 / \u2014';
  let isPageJumpInputOpen = false;

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

  function updateOrientationButtons() {
    const orientationLabel = global.isLandscapeOrientation ? 'Landscape' : 'Portrait';
    if (global.orientationToggleBtn) {
      global.orientationToggleBtn.textContent = orientationLabel;
      global.orientationToggleBtn.setAttribute('aria-pressed', global.isLandscapeOrientation ? 'true' : 'false');
    }
    if (global.fullscreenOrientationBtn) {
      global.fullscreenOrientationBtn.textContent = orientationLabel;
      global.fullscreenOrientationBtn.setAttribute('aria-pressed', global.isLandscapeOrientation ? 'true' : 'false');
    }
  }

  function applyFullscreenOrientation() {
    if (typeof global.applyOrientationToElement === 'function') {
      global.applyOrientationToElement(global.fullscreenImage);
    }
  }

  function setOrientationMode(orientation) {
    const requested = orientation === 'landscape' || orientation === true ? 'landscape' : 'portrait';
    const newIsLandscape = requested === 'landscape';

    if (global.isLandscapeOrientation === newIsLandscape) {
      updateOrientationButtons();
      applyViewerOrientation();
      applyFullscreenOrientation();
      return;
    }

    global.isLandscapeOrientation = newIsLandscape;
    updateOrientationButtons();
    applyViewerOrientation();
    applyFullscreenOrientation();
    applyViewerFitMode();

    if (global.isFullscreenZoomed) {
      global.resetFullscreenZoom?.();
    } else {
      global.applyFullscreenFitMode?.();
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

    if (global.viewerBackBtn && !global.viewerBackBtn._navListener) {
      global.viewerBackBtn._navListener = (event) => {
        event.preventDefault();
        global.navigateBackFromViewer();
      };
      global.viewerBackBtn.addEventListener('click', global.viewerBackBtn._navListener);
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

    if (global.fullscreenNavLeft && !global.fullscreenNavLeft._navListener) {
      global.fullscreenNavLeft._navListener = (event) => {
        event.preventDefault();
        global.hideFullscreenControls?.();
        global.navigatePage?.(-1);
      };
      global.fullscreenNavLeft.addEventListener('click', global.fullscreenNavLeft._navListener);
    }

    if (global.fullscreenNavRight && !global.fullscreenNavRight._navListener) {
      global.fullscreenNavRight._navListener = (event) => {
        event.preventDefault();
        global.hideFullscreenControls?.();
        global.navigatePage?.(1);
      };
      global.fullscreenNavRight.addEventListener('click', global.fullscreenNavRight._navListener);
    }

    const fullscreenImage = global.fullscreenImage;
    if (fullscreenImage && !fullscreenImage._viewerListenersAttached) {
      fullscreenImage.addEventListener('click', global.handleFullscreenImageClick);
      fullscreenImage.addEventListener('pointerdown', global.handleFullscreenPointerDown);
      fullscreenImage.addEventListener('pointermove', global.handleFullscreenPointerMove);
      fullscreenImage.addEventListener('pointerup', global.handleFullscreenPointerUp);
      fullscreenImage.addEventListener('pointercancel', global.handleFullscreenPointerUp);
      fullscreenImage.addEventListener('dblclick', (event) => {
        global.hideFullscreenControls?.();
        const rect = fullscreenImage.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        const ratioX = rect.width ? clickX / rect.width : 0.5;
        const ratioY = rect.height ? clickY / rect.height : 0.5;
        if (!global.isFullscreenZoomed) {
          global.applyFullscreenZoom?.(2, ratioX, ratioY);
        } else {
          global.endFullscreenPan?.();
          global.resetFullscreenZoom?.();
        }
      });
      fullscreenImage._viewerListenersAttached = true;
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
    setOrientationMode,
    initializeViewerUIControls,
  };

  global.ViewerUI = ViewerUI;
  Object.assign(global, ViewerUI);
})(typeof window !== 'undefined' ? window : globalThis);
