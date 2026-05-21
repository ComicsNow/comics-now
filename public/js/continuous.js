/**
 * Continuous Mode - Vertical scroll through all pages like webtoon/manga reader
 */

import { state } from './globals.js';
import { saveProgressToDB, updateLibraryProgress } from './progress.js';

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let isContinuousMode = false;
let continuousContainer = null;
let pageElements = new Map(); // pageName -> img element
let intersectionObserver = null;
let loadedPages = new Set();
let scrollTimeout = null;
let continuousClickHandler = null;
let isInitializingScroll = false;

// Store original navigation state for restoration
let originalNavigationState = {
  prevBtnText: '←',
  nextBtnText: '→',
  prevBtnHandler: null,
  nextBtnHandler: null,
  navLeftHandler: null,
  navRightHandler: null
};

// ============================================================================
// INTERSECTION OBSERVER - LAZY LOADING
// ============================================================================

/**
 * Initialize IntersectionObserver for lazy loading pages as they enter viewport
 */
function initIntersectionObserver() {
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }

  const options = {
    root: null, // Use viewport
    rootMargin: '500px', // Load pages 500px before they enter viewport
    threshold: 0 // Trigger as soon as any part is visible
  };

  intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageName = entry.target.dataset.page;
        if (pageName && !loadedPages.has(pageName)) {
          loadPage(pageName, entry.target);
        }
      }
    });
  }, options);
}

/**
 * Load individual page when it enters viewport
 * @param {string} pageName - Name of the page to load
 * @param {HTMLElement} container - Container element for this page
 */
async function loadPage(pageName, container) {
  if (loadedPages.has(pageName)) return;

  try {
    loadedPages.add(pageName);

    const getPageUrl = state.getPageUrl || window.getPageUrl;
    // Use global getPageUrl function (defined in viewer.js)
    if (typeof getPageUrl !== 'function') {
      throw new Error('getPageUrl function not available');
    }

    const pageUrl = await getPageUrl(pageName);

    const img = document.createElement('img');
    img.alt = `Page ${pageName}`;
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.2s';

    // Set up load handler
    img.onload = () => {
      img.style.opacity = '1';
      applyLandscapeToPage(container, img);
    };

    // Set up error handler
    img.onerror = () => {
      console.error('[CONTINUOUS] Failed to load image:', pageName, pageUrl);
      container.innerHTML = `<div class="text-red-400 p-4">Failed to load: ${pageName}</div>`;
    };

    // Clear placeholder and add image to DOM
    container.innerHTML = '';
    container.appendChild(img);
    pageElements.set(pageName, img);

    // Set src to trigger loading (after image is in DOM)
    img.src = pageUrl;

  } catch (error) {
    console.error('[CONTINUOUS] Error loading page:', pageName, error);
    container.innerHTML = `<div class="text-red-400 p-4">Error: ${error.message}</div>`;
  }
}

// ============================================================================
// CONTINUOUS MODE RENDERING
// ============================================================================

/**
 * Render all pages in vertical continuous scroll mode
 */
export async function renderContinuousMode() {
  const getViewerPages = state.getViewerPages || window.getViewerPages;
  const pages = getViewerPages?.() || [];
  if (!pages.length) {
    return;
  }

  // Use the container set by enableContinuousMode() (either normal or fullscreen)
  if (!continuousContainer) {
    console.error('[CONTINUOUS] Container not found');
    return;
  }

  // Clear previous content
  continuousContainer.innerHTML = '';
  loadedPages.clear();
  pageElements.clear();

  // Create container for each page
  pages.forEach((pageName, index) => {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-container w-full';
    pageContainer.dataset.page = pageName;
    pageContainer.dataset.index = index;

    // Add loading placeholder
    pageContainer.innerHTML = `
      <div class="animate-pulse bg-gray-700 h-96 w-full max-w-2xl rounded"></div>
    `;

    continuousContainer.appendChild(pageContainer);

    // Observe for lazy loading
    if (intersectionObserver) {
      intersectionObserver.observe(pageContainer);
    }
  });

  // Update UI to show continuous mode is active
  updateContinuousModeUI(true);

  // Scroll to current page position
  const currentIndex = state.currentPageIndex || 0;
  const targetContainer = continuousContainer.querySelector(
    `.page-container[data-index="${currentIndex}"]`
  );
  if (targetContainer) {
    // Use instant scroll (no animation) for initial position
    isInitializingScroll = true;
    targetContainer.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Clear initialization flag after scroll settles
    setTimeout(() => {
      isInitializingScroll = false;
    }, 300);

    // Setup scroll tracking after initialization is complete
    setTimeout(() => {
      setupScrollProgressTracking();
    }, 350);
  } else {
    // No scroll needed, setup tracking immediately
    setupScrollProgressTracking();
  }
}

// ============================================================================
// MODE SWITCHING
// ============================================================================

/**
 * Enable continuous scroll mode (fullscreen only)
 */
export async function enableContinuousMode() {
  // Continuous scrolls a vertical stream of pages and is incompatible with
  // any of the guided-view overlays.
  const GuidedView = state.GuidedView || window.GuidedView;
  GuidedView?.disableAll?.();
  isContinuousMode = true;
  state.isContinuousMode = true;
  
  const refreshGuidedToggle = state.refreshGuidedToggle || window.refreshGuidedToggle;
  if (typeof refreshGuidedToggle === 'function') {
    try { await refreshGuidedToggle(); } catch (_) {}
  }

  // Continuous mode only works in fullscreen
  const fullscreenViewer = document.getElementById('fullscreen-viewer');
  const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');

  if (!isFullscreen) {
    return;
  }

  // Hide fullscreen single image
  const fullscreenImage = document.getElementById('fullscreen-image');
  if (fullscreenImage) {
    fullscreenImage.classList.add('hidden');
  }

  // Show fullscreen continuous container
  continuousContainer = document.getElementById('fullscreen-pages-continuous');
  if (continuousContainer) {
    continuousContainer.classList.remove('hidden');

    const showFullscreenControls = state.showFullscreenControls || window.showFullscreenControls;
    // Add click handler to show/hide fullscreen controls
    continuousClickHandler = () => {
      if (typeof showFullscreenControls === 'function') {
        showFullscreenControls(true); // true = auto-hide after 3 seconds
      }
    };
    continuousContainer.addEventListener('click', continuousClickHandler);
  }

  // Render continuous mode
  await renderContinuousMode();

  // Replace left/right arrows with up/down arrows
  const prevBtn = document.getElementById('fullscreen-prev-page-btn');
  const nextBtn = document.getElementById('fullscreen-next-page-btn');
  const navLeft = document.getElementById('fullscreen-nav-left');
  const navRight = document.getElementById('fullscreen-nav-right');

  if (prevBtn && nextBtn) {
    // Store original handlers if not already stored
    if (!originalNavigationState.prevBtnHandler) {
      originalNavigationState.prevBtnText = prevBtn.textContent;
      originalNavigationState.nextBtnText = nextBtn.textContent;
      originalNavigationState.prevBtnHandler = prevBtn._navListener;
      originalNavigationState.nextBtnHandler = nextBtn._navListener;
    }

    // Replace arrow text with up/down arrows
    prevBtn.textContent = '↑';
    nextBtn.textContent = '↓';

    // Replace click handlers with continuous mode navigation
    if (prevBtn._navListener) {
      prevBtn.removeEventListener('click', prevBtn._navListener);
    }
    if (nextBtn._navListener) {
      nextBtn.removeEventListener('click', nextBtn._navListener);
    }

    // Add new handlers for continuous mode
    prevBtn._continuousListener = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToPreviousPage();
    };
    nextBtn._continuousListener = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToNextPage();
    };

    prevBtn.addEventListener('click', prevBtn._continuousListener);
    nextBtn.addEventListener('click', nextBtn._continuousListener);

    // Update button titles
    prevBtn.setAttribute('title', 'Previous page (scroll up)');
    prevBtn.setAttribute('aria-label', 'Previous page (scroll up)');
    nextBtn.setAttribute('title', 'Next page (scroll down)');
    nextBtn.setAttribute('aria-label', 'Next page (scroll down)');
  }

  // Replace side navigation areas with up/down scroll
  if (navLeft && navRight) {
    // Store original handlers if not already stored
    if (!originalNavigationState.navLeftHandler) {
      originalNavigationState.navLeftHandler = navLeft.onclick;
      originalNavigationState.navRightHandler = navRight.onclick;
    }

    // Replace with continuous mode navigation
    navLeft.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToPreviousPage();
    };
    navRight.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollToNextPage();
    };
  }

  // Update UI
  updateContinuousModeUI(true);
}

/**
 * Disable continuous mode and return to page-by-page
 */
export async function disableContinuousMode() {
  isContinuousMode = false;
  state.isContinuousMode = false;
  
  const refreshGuidedToggle = state.refreshGuidedToggle || window.refreshGuidedToggle;
  if (typeof refreshGuidedToggle === 'function') {
    try { await refreshGuidedToggle(); } catch (_) {}
  }

  // Check if in fullscreen mode
  const fullscreenViewer = document.getElementById('fullscreen-viewer');
  const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');

  if (isFullscreen) {
    // Show fullscreen single image
    const fullscreenImage = document.getElementById('fullscreen-image');
    if (fullscreenImage) {
      fullscreenImage.classList.remove('hidden');
    }

    // Hide fullscreen continuous container
    if (continuousContainer) {
      // Remove click handler
      if (continuousClickHandler) {
        continuousContainer.removeEventListener('click', continuousClickHandler);
        continuousClickHandler = null;
      }

      continuousContainer.classList.add('hidden');
    }

    const renderPage = state.renderPage || window.renderPage;
    // Render current page in fullscreen to populate the image
    if (typeof renderPage === 'function') {
      await renderPage();
    }
  } else {
    // Just clean up state, no UI changes needed
    if (continuousContainer) {
      if (continuousClickHandler) {
        continuousContainer.removeEventListener('click', continuousClickHandler);
        continuousClickHandler = null;
      }
    }
  }

  // Cleanup observer (always do this)
  if (intersectionObserver) {
    intersectionObserver.disconnect();
  }

  // Restore left/right arrows and original handlers
  const prevBtn = document.getElementById('fullscreen-prev-page-btn');
  const nextBtn = document.getElementById('fullscreen-next-page-btn');
  const navLeft = document.getElementById('fullscreen-nav-left');
  const navRight = document.getElementById('fullscreen-nav-right');

  if (prevBtn && nextBtn) {
    // Remove continuous mode handlers
    if (prevBtn._continuousListener) {
      prevBtn.removeEventListener('click', prevBtn._continuousListener);
      prevBtn._continuousListener = null;
    }
    if (nextBtn._continuousListener) {
      nextBtn.removeEventListener('click', nextBtn._continuousListener);
      nextBtn._continuousListener = null;
    }

    // Restore original arrow text
    prevBtn.textContent = originalNavigationState.prevBtnText;
    nextBtn.textContent = originalNavigationState.nextBtnText;

    // Restore original handlers
    if (originalNavigationState.prevBtnHandler) {
      prevBtn.addEventListener('click', originalNavigationState.prevBtnHandler);
    }
    if (originalNavigationState.nextBtnHandler) {
      nextBtn.addEventListener('click', originalNavigationState.nextBtnHandler);
    }

    // Restore button titles
    prevBtn.setAttribute('title', 'Previous page');
    prevBtn.setAttribute('aria-label', 'Previous page');
    nextBtn.setAttribute('title', 'Next page');
    nextBtn.setAttribute('aria-label', 'Next page');
  }

  // Restore side navigation areas
  if (navLeft && navRight) {
    navLeft.onclick = originalNavigationState.navLeftHandler;
    navRight.onclick = originalNavigationState.navRightHandler;
  }

  // Update UI
  updateContinuousModeUI(false);
}

// ============================================================================
// SCROLL PROGRESS TRACKING
// ============================================================================

/**
 * Setup scroll event listener for progress tracking
 */
function setupScrollProgressTracking() {
  if (!continuousContainer) return;

  const handleScroll = () => {
    // Debounce scroll events
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(async () => {
      await updateCurrentPageFromScroll();
    }, 200); // 200ms debounce
  };

  continuousContainer.addEventListener('scroll', handleScroll);
}

/**
 * Update current page index based on scroll position
 */
async function updateCurrentPageFromScroll() {
  if (!continuousContainer) return;

  // Skip scroll tracking during initial positioning to prevent page jumps
  if (isInitializingScroll) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) return;

  // Find which page is in the middle of viewport
  const viewportMiddle = window.innerHeight / 2;
  let closestPage = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = pageIndex;
    }
  });

  // Update global page index
  if (state.currentPageIndex !== closestPage) {
    state.currentPageIndex = closestPage;

    const getViewerPages = state.getViewerPages || window.getViewerPages;
    const updateViewerPageCounter = state.updateViewerPageCounter || window.updateViewerPageCounter;
    // Update page counter
    if (typeof updateViewerPageCounter === 'function') {
      const pages = getViewerPages?.() || [];
      updateViewerPageCounter(pages);
    }

    const currentComic = state.currentComic || window.currentComic;
    const getComicFromDB = state.getComicFromDB || window.getComicFromDB;
    const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
    const updateLibraryProgressFn = state.updateLibraryProgress || updateLibraryProgress;

    // Save progress to persist reading position
    try {
      const comicFromDB = await getComicFromDB?.(currentComic.id);
      const isDownloaded = downloadedComicIds?.has(currentComic.id) || !!comicFromDB;

      if (isDownloaded) {
        // Save to IndexedDB for offline access
        try {
          await saveProgressToDB(
            currentComic.id,
            closestPage,
            currentComic.progress?.totalPages,
            currentComic.path,
          );
        } catch (error) {
          console.error('[CONTINUOUS] Failed to save to IndexedDB:', error);
        }

        // Update local progress
        if (!currentComic.progress) {
          currentComic.progress = { totalPages: 0, lastReadPage: 0 };
        }
        currentComic.progress.lastReadPage = closestPage;
        downloadedComicIds?.add(currentComic.id);
        updateLibraryProgressFn(currentComic.id, closestPage, currentComic.progress.totalPages);

        const saveProgress = state.saveProgress || window.saveProgress;
        // ALSO sync to server with per-device progress
        if (navigator.onLine && typeof saveProgress === 'function') {
          saveProgress(closestPage);
        }
      } else {
        const saveProgress = state.saveProgress || window.saveProgress;
        // Online comics - save to server directly
        if (typeof saveProgress === 'function') {
          saveProgress(closestPage);
        }
        // Also update the library data
        if (updateLibraryProgressFn) {
          updateLibraryProgressFn(currentComic.id, closestPage, currentComic.progress?.totalPages);
        }
      }
    } catch (error) {
      console.error('[CONTINUOUS] Error saving progress:', error);
    }
  }
}

// ============================================================================
// UI HELPER FUNCTIONS
// ============================================================================

/**
 * Hide navigation buttons when in continuous mode
 */
function hideNavigationButtons() {
  const buttons = [
    'prev-page-btn', 'next-page-btn',
    'prev-page-btn-bottom', 'next-page-btn-bottom',
    'fullscreen-prev-page-btn', 'fullscreen-next-page-btn'
  ];

  buttons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.add('hidden');
    }
  });
}

/**
 * Show navigation buttons when exiting continuous mode
 */
function showNavigationButtons() {
  const buttons = [
    'prev-page-btn', 'next-page-btn',
    'prev-page-btn-bottom', 'next-page-btn-bottom',
    'fullscreen-prev-page-btn', 'fullscreen-next-page-btn'
  ];

  buttons.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.remove('hidden');
    }
  });
}

/**
 * Update continuous mode button UI state
 * @param {boolean} isActive - Whether continuous mode is active
 */
export function updateContinuousModeUI(isActive) {
  const buttons = [
    document.getElementById('continuous-mode-btn'),
    document.getElementById('fullscreen-continuous-mode-btn')
  ];

  buttons.forEach(btn => {
    if (!btn) return;

    if (isActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Scroll to the next page in continuous mode
 */
export function scrollToNextPage() {
  if (!continuousContainer) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) {
    return;
  }

  // Find currently visible page (closest to viewport middle)
  const viewportMiddle = window.innerHeight / 2;
  let currentPageIndex = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      currentPageIndex = pageIndex;
    }
  });

  // Scroll to next page
  const nextPageIndex = currentPageIndex + 1;
  const nextContainer = continuousContainer.querySelector(
    `.page-container[data-index="${nextPageIndex}"]`
  );

  if (nextContainer) {
    nextContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    // At last page, scroll to bottom
    continuousContainer.scrollTo({
      top: continuousContainer.scrollHeight,
      behavior: 'smooth'
    });
  }
}

/**
 * Scroll to the previous page in continuous mode
 */
export function scrollToPreviousPage() {
  if (!continuousContainer) {
    return;
  }

  const pageContainers = continuousContainer.querySelectorAll('.page-container');
  if (!pageContainers.length) {
    return;
  }

  // Find currently visible page (closest to viewport middle)
  const viewportMiddle = window.innerHeight / 2;
  let currentPageIndex = 0;
  let closestDistance = Infinity;

  pageContainers.forEach((container) => {
    const pageIndex = parseInt(container.dataset.index, 10);
    const rect = container.getBoundingClientRect();
    const containerMiddle = rect.top + (rect.height / 2);
    const distance = Math.abs(containerMiddle - viewportMiddle);

    if (distance < closestDistance) {
      closestDistance = distance;
      currentPageIndex = pageIndex;
    }
  });

  // Scroll to previous page
  const prevPageIndex = currentPageIndex - 1;
  const prevContainer = continuousContainer.querySelector(
    `.page-container[data-index="${prevPageIndex}"]`
  );

  if (prevContainer) {
    prevContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    // At first page, scroll to top
    continuousContainer.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }
}

// ============================================================================
// API INTEGRATION
// ============================================================================

/**
 * Toggle continuous mode (local state only)
 * @param {string} comicId - The comic ID
 * @param {boolean} currentMode - Current continuous mode state
 * @returns {boolean} - New continuous mode state
 */
export function toggleContinuousMode(comicId, currentMode) {
  const newMode = !currentMode;
  return newMode;
}

/**
 * Update continuous mode in cache (IndexedDB)
 * @param {string} comicId - Comic ID
 * @param {boolean} continuousMode - New continuous mode value
 * @returns {Promise<boolean>} - Success status
 */
export async function updateContinuousModeInCache(comicId, continuousMode) {
  try {
    const loadLibraryCacheFromDB = state.loadLibraryCacheFromDB || window.loadLibraryCacheFromDB;
    if (typeof loadLibraryCacheFromDB !== 'function') {
      return false;
    }

    const cachedRecord = await loadLibraryCacheFromDB();
    if (!cachedRecord?.data) return false;

    const cachedLibrary = cachedRecord.data;
    let comicFound = false;

    // Find and update comic in cache
    for (const rootFolder of Object.keys(cachedLibrary)) {
      const publishers = cachedLibrary[rootFolder]?.publishers || {};
      for (const publisherName of Object.keys(publishers)) {
        const seriesEntries = publishers[publisherName]?.series || {};
        for (const seriesName of Object.keys(seriesEntries)) {
          const comics = seriesEntries[seriesName];
          if (Array.isArray(comics)) {
            const comic = comics.find(c => c.id === comicId);
            if (comic) {
              comic.continuousMode = continuousMode;
              comicFound = true;
              break;
            }
          }
        }
        if (comicFound) break;
      }
      if (comicFound) break;
    }

    const saveLibraryCacheToDB = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
    if (comicFound && typeof saveLibraryCacheToDB === 'function') {
      await saveLibraryCacheToDB(cachedLibrary);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[CONTINUOUS] Cache update failed:', error);
    return false;
  }
}

// ============================================================================
// BUTTON HANDLERS
// ============================================================================

/**
 * Setup click handler for continuous mode button
 * @param {HTMLElement} button - Button element
 */
function setupContinuousModeButtonHandler(button) {
  if (!button) return;

  button.addEventListener('click', async () => {
    const currentComic = state.currentComic || window.currentComic;
    if (!currentComic) {
      return;
    }

    try {
      const currentMode = currentComic.continuousMode || false;

      const newMode = toggleContinuousMode(
        currentComic.id,
        currentMode
      );

      currentComic.continuousMode = newMode;

      const updateComicInLibrary = state.updateComicInLibrary || window.updateComicInLibrary;
      // Update library object
      if (typeof updateComicInLibrary === 'function') {
        updateComicInLibrary(currentComic.id, { continuousMode: newMode });
      }

      // Update cache
      await updateContinuousModeInCache(currentComic.id, newMode);

      const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
      const updateDownloadedComicInfo = state.updateDownloadedComicInfo || window.updateDownloadedComicInfo;
      // Update downloaded comic if applicable
      const isDownloaded = downloadedComicIds?.has(currentComic.id);
      if (isDownloaded && typeof updateDownloadedComicInfo === 'function') {
        await updateDownloadedComicInfo(currentComic.id, { continuousMode: newMode });
      }

      const updateDownloadedSmartListComic = state.updateDownloadedSmartListComic || window.updateDownloadedSmartListComic;
      // Update downloaded smart list
      if (typeof updateDownloadedSmartListComic === 'function') {
        updateDownloadedSmartListComic(currentComic.id, { continuousMode: newMode });
      }

      // Switch mode
      if (newMode) {
        await enableContinuousMode();
      } else {
        await disableContinuousMode();
      }

    } catch (error) {
      console.error('[CONTINUOUS] Error toggling continuous mode:', error);
      alert('Failed to toggle continuous mode. Please try again.');
    }
  });
}

/**
 * Initialize continuous mode - setup observers and button handlers (fullscreen only)
 */
export function initializeContinuousMode() {
  // Setup intersection observer
  initIntersectionObserver();

  // Setup button handler for fullscreen continuous mode button only
  setupContinuousModeButtonHandler(document.getElementById('fullscreen-continuous-mode-btn'));
}

// ============================================================================
// EXPOSE PUBLIC API
// ============================================================================

function getViewerWidthPx() {
  if (continuousContainer && continuousContainer.clientWidth) {
    return continuousContainer.clientWidth;
  }
  const fsViewer = document.getElementById('fullscreen-viewer');
  if (fsViewer && !fsViewer.classList.contains('hidden')) {
    return fsViewer.clientWidth || window.innerWidth;
  }
  return window.innerWidth;
}

function applyLandscapeToPage(container, img) {
  if (!container || !img) return;
  const isLandscapeOrientation = state.isLandscapeOrientation || window.isLandscapeOrientation;
  if (isLandscapeOrientation && img.naturalWidth && img.naturalHeight) {
    const viewportW = getViewerWidthPx();
    const visualHeight = viewportW * (img.naturalWidth / img.naturalHeight);
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = `${visualHeight}px`;
    container.style.overflow = 'hidden';
    container.style.margin = '0 auto';
    img.style.position = 'absolute';
    img.style.left = '50%';
    img.style.top = '50%';
    img.style.height = `${viewportW}px`;
    img.style.width = 'auto';
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    img.style.transformOrigin = 'center center';
    img.classList.add('orientation-landscape');
  } else {
    container.style.position = '';
    container.style.width = '';
    container.style.height = '';
    container.style.overflow = '';
    container.style.margin = '';
    img.style.position = '';
    img.style.left = '';
    img.style.top = '';
    img.style.height = '';
    img.style.width = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    img.style.transform = '';
    img.style.transformOrigin = '';
    img.classList.remove('orientation-landscape');
  }
}

export function applyContinuousOrientation() {
  if (!continuousContainer) return;
  const containers = continuousContainer.querySelectorAll('.page-container');
  containers.forEach(c => {
    const img = c.querySelector('img');
    if (img) applyLandscapeToPage(c, img);
  });
}

window.addEventListener('resize', () => {
  const isContinuousModeVal = state.isContinuousMode || window.isContinuousMode;
  if (isContinuousModeVal && continuousContainer) applyContinuousOrientation();
});

export const ContinuousMode = {
  enableContinuousMode,
  disableContinuousMode,
  toggleContinuousMode,
  renderContinuousMode,
  initializeContinuousMode,
  updateContinuousModeInCache,
  updateContinuousModeUI,
  applyContinuousOrientation,
  scrollToNextPage,
  scrollToPreviousPage
};

state.scrollToNextPage = scrollToNextPage;
state.scrollToPreviousPage = scrollToPreviousPage;
state.applyContinuousOrientation = applyContinuousOrientation;
state.ContinuousMode = ContinuousMode;
state.enableContinuousMode = enableContinuousMode;
state.disableContinuousMode = disableContinuousMode;
state.toggleContinuousMode = toggleContinuousMode;
state.initializeContinuousMode = initializeContinuousMode;
state.updateContinuousModeUI = updateContinuousModeUI;
state.updateContinuousModeInCache = updateContinuousModeInCache;
state.isContinuousMode = isContinuousMode;

if (typeof window !== 'undefined') {
  window.scrollToNextPage = scrollToNextPage;
  window.scrollToPreviousPage = scrollToPreviousPage;
  window.applyContinuousOrientation = applyContinuousOrientation;
  window.ContinuousMode = ContinuousMode;
  window.enableContinuousMode = enableContinuousMode;
  window.disableContinuousMode = disableContinuousMode;
  window.toggleContinuousMode = toggleContinuousMode;
  window.initializeContinuousMode = initializeContinuousMode;
  window.updateContinuousModeUI = updateContinuousModeUI;
  window.updateContinuousModeInCache = updateContinuousModeInCache;
  window.isContinuousMode = isContinuousMode;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContinuousMode);
} else {
  initializeContinuousMode();
}
