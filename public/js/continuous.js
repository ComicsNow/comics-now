/**
 * Continuous Mode - Vertical scroll through all pages like webtoon/manga reader
 */
(function (global) {
  'use strict';

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

    console.log('[CONTINUOUS] IntersectionObserver initialized');
  }

  /**
   * Load individual page when it enters viewport
   * @param {string} pageName - Name of the page to load
   * @param {HTMLElement} container - Container element for this page
   */
  async function loadPage(pageName, container) {
    if (loadedPages.has(pageName)) return;

    try {
      console.log('[CONTINUOUS] Loading page:', pageName);
      loadedPages.add(pageName);

      // Use global getPageUrl function (defined in viewer.js)
      if (typeof global.getPageUrl !== 'function') {
        throw new Error('getPageUrl function not available');
      }

      const pageUrl = await global.getPageUrl(pageName);

      const img = document.createElement('img');
      img.src = pageUrl;
      img.alt = `Page ${pageName}`;
      img.className = 'w-full h-auto block';
      img.loading = 'lazy'; // Browser native lazy loading as backup

      // Clear placeholder and add image
      container.innerHTML = '';
      container.appendChild(img);
      pageElements.set(pageName, img);

      console.log('[CONTINUOUS] Page loaded:', pageName);
    } catch (error) {
      console.error('[CONTINUOUS] Failed to load page:', pageName, error);
      container.innerHTML = '<div class="text-red-400 p-4">Failed to load page</div>';
    }
  }

  // ============================================================================
  // CONTINUOUS MODE RENDERING
  // ============================================================================

  /**
   * Render all pages in vertical continuous scroll mode
   */
  async function renderContinuousMode() {
    console.log('[CONTINUOUS] Rendering continuous mode');

    const pages = global.getViewerPages?.() || [];
    if (!pages.length) {
      console.log('[CONTINUOUS] No pages to render');
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

    console.log('[CONTINUOUS] Creating containers for', pages.length, 'pages');

    // Create container for each page
    pages.forEach((pageName, index) => {
      const pageContainer = document.createElement('div');
      pageContainer.className = 'page-container w-full flex justify-center';
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

    console.log('[CONTINUOUS] Continuous mode rendering complete');
  }

  // ============================================================================
  // MODE SWITCHING
  // ============================================================================

  /**
   * Enable continuous scroll mode (fullscreen only)
   */
  async function enableContinuousMode() {
    console.log('[CONTINUOUS] Enabling continuous mode');
    isContinuousMode = true;
    global.isContinuousMode = true;

    // Continuous mode only works in fullscreen
    const fullscreenViewer = document.getElementById('fullscreen-viewer');
    const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');

    if (!isFullscreen) {
      console.warn('[CONTINUOUS] Continuous mode requires fullscreen - ignored');
      return;
    }

    console.log('[CONTINUOUS] Enabling in fullscreen mode');

    // Hide fullscreen single image
    const fullscreenImage = document.getElementById('fullscreen-image');
    if (fullscreenImage) {
      fullscreenImage.classList.add('hidden');
      console.log('[CONTINUOUS] Hidden fullscreen image');
    }

    // Show fullscreen continuous container
    continuousContainer = document.getElementById('fullscreen-pages-continuous');
    if (continuousContainer) {
      continuousContainer.classList.remove('hidden');
      console.log('[CONTINUOUS] Showing fullscreen continuous viewer');

      // Add click handler to show/hide fullscreen controls
      continuousClickHandler = () => {
        if (typeof global.showFullscreenControls === 'function') {
          global.showFullscreenControls(true); // true = auto-hide after 3 seconds
        }
      };
      continuousContainer.addEventListener('click', continuousClickHandler);
      console.log('[CONTINUOUS] Added click handler for controls');
    }

    // Hide navigation buttons (not needed in continuous mode)
    hideNavigationButtons();

    // Render continuous mode
    await renderContinuousMode();

    // Setup scroll progress tracking
    setupScrollProgressTracking();

    // Update UI
    updateContinuousModeUI(true);

    console.log('[CONTINUOUS] Continuous mode enabled');
  }

  /**
   * Disable continuous mode and return to page-by-page (fullscreen only)
   */
  async function disableContinuousMode() {
    console.log('[CONTINUOUS] Disabling continuous mode');
    isContinuousMode = false;
    global.isContinuousMode = false;

    // Continuous mode only works in fullscreen
    const fullscreenViewer = document.getElementById('fullscreen-viewer');
    const isFullscreen = fullscreenViewer && !fullscreenViewer.classList.contains('hidden');

    if (!isFullscreen) {
      console.warn('[CONTINUOUS] Not in fullscreen - nothing to disable');
      return;
    }

    console.log('[CONTINUOUS] Disabling in fullscreen mode');

    // Show fullscreen single image
    const fullscreenImage = document.getElementById('fullscreen-image');
    if (fullscreenImage) {
      fullscreenImage.classList.remove('hidden');
      console.log('[CONTINUOUS] Showing fullscreen image');
    }

    // Hide fullscreen continuous container
    if (continuousContainer) {
      // Remove click handler
      if (continuousClickHandler) {
        continuousContainer.removeEventListener('click', continuousClickHandler);
        continuousClickHandler = null;
        console.log('[CONTINUOUS] Removed click handler');
      }

      continuousContainer.classList.add('hidden');
      console.log('[CONTINUOUS] Hidden fullscreen continuous viewer');
    }

    // Show navigation buttons
    showNavigationButtons();

    // Cleanup observer
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      console.log('[CONTINUOUS] Disconnected observer');
    }

    // Render current page in fullscreen to populate the image
    if (typeof global.renderPage === 'function') {
      await global.renderPage();
      console.log('[CONTINUOUS] Rendered current page in fullscreen mode');
    }

    // Update UI
    updateContinuousModeUI(false);

    console.log('[CONTINUOUS] Continuous mode disabled');
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
    console.log('[CONTINUOUS] Scroll tracking setup complete');
  }

  /**
   * Update current page index based on scroll position
   */
  async function updateCurrentPageFromScroll() {
    if (!continuousContainer) return;

    const pageContainers = continuousContainer.querySelectorAll('.page-container');
    if (!pageContainers.length) return;

    // Find which page is in the middle of viewport
    const viewportMiddle = window.innerHeight / 2;
    let closestPage = 0;
    let closestDistance = Infinity;

    pageContainers.forEach((container, index) => {
      const rect = container.getBoundingClientRect();
      const containerMiddle = rect.top + (rect.height / 2);
      const distance = Math.abs(containerMiddle - viewportMiddle);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = index;
      }
    });

    // Update global page index
    if (global.currentPageIndex !== closestPage) {
      global.currentPageIndex = closestPage;

      // Update page counter
      if (typeof global.updateViewerPageCounter === 'function') {
        const pages = global.getViewerPages?.() || [];
        global.updateViewerPageCounter(pages);
      }

      // Save progress to persist reading position
      if (typeof global.saveProgress === 'function') {
        await global.saveProgress(closestPage);
      }

      console.log('[CONTINUOUS] Current page updated to:', closestPage);
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

    console.log('[CONTINUOUS] Navigation buttons hidden');
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

    console.log('[CONTINUOUS] Navigation buttons shown');
  }

  /**
   * Update continuous mode button UI state
   * @param {boolean} isActive - Whether continuous mode is active
   */
  function updateContinuousModeUI(isActive) {
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

    console.log('[CONTINUOUS] UI updated, active:', isActive);
  }

  // ============================================================================
  // API INTEGRATION
  // ============================================================================

  /**
   * Toggle continuous mode via API
   * @param {string} comicId - The comic ID
   * @param {boolean} currentMode - Current continuous mode state
   * @returns {Promise<boolean>} - New continuous mode state
   */
  async function toggleContinuousMode(comicId, currentMode) {
    const newMode = !currentMode;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/comics/continuous-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comicId,
          continuousMode: newMode
        })
      });

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.message || 'Failed to toggle continuous mode');
      }

      console.log('[CONTINUOUS] API toggle successful:', newMode);
      return data.continuousMode;
    } catch (error) {
      console.log('[CONTINUOUS] API call failed, using local toggle:', error.message);
      return newMode;
    }
  }

  /**
   * Update continuous mode in cache (IndexedDB)
   * @param {string} comicId - Comic ID
   * @param {boolean} continuousMode - New continuous mode value
   * @returns {Promise<boolean>} - Success status
   */
  async function updateContinuousModeInCache(comicId, continuousMode) {
    try {
      if (typeof global.loadLibraryCacheFromDB !== 'function') {
        return false;
      }

      const cachedRecord = await global.loadLibraryCacheFromDB();
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

      if (comicFound && typeof global.saveLibraryCacheToDB === 'function') {
        await global.saveLibraryCacheToDB(cachedLibrary);
        console.log('[CONTINUOUS] Cache updated successfully');
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
      if (!global.currentComic) {
        console.log('[CONTINUOUS] No current comic');
        return;
      }

      try {
        const currentMode = global.currentComic.continuousMode || false;
        console.log('[CONTINUOUS] Toggling from', currentMode, 'to', !currentMode);

        const newMode = await toggleContinuousMode(
          global.currentComic.id,
          currentMode
        );

        global.currentComic.continuousMode = newMode;

        // Update library object
        if (typeof global.updateComicInLibrary === 'function') {
          global.updateComicInLibrary(global.currentComic.id, { continuousMode: newMode });
        }

        // Update cache
        await updateContinuousModeInCache(global.currentComic.id, newMode);

        // Update downloaded comic if applicable
        const isDownloaded = global.downloadedComicIds?.has(global.currentComic.id);
        if (isDownloaded && typeof global.updateDownloadedComicInfo === 'function') {
          await global.updateDownloadedComicInfo(global.currentComic.id, { continuousMode: newMode });
          console.log('[CONTINUOUS] Updated downloaded comic');
        }

        // Update downloaded smart list
        if (typeof global.updateDownloadedSmartListComic === 'function') {
          global.updateDownloadedSmartListComic(global.currentComic.id, { continuousMode: newMode });
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

    console.log('[CONTINUOUS] Button handler setup for', button.id);
  }

  /**
   * Initialize continuous mode - setup observers and button handlers (fullscreen only)
   */
  function initializeContinuousMode() {
    console.log('[CONTINUOUS] Initializing continuous mode');

    // Setup intersection observer
    initIntersectionObserver();

    // Setup button handler for fullscreen continuous mode button only
    setupContinuousModeButtonHandler(document.getElementById('fullscreen-continuous-mode-btn'));

    console.log('[CONTINUOUS] Initialization complete');
  }

  // ============================================================================
  // EXPOSE PUBLIC API
  // ============================================================================

  global.ContinuousMode = {
    enableContinuousMode,
    disableContinuousMode,
    toggleContinuousMode,
    renderContinuousMode,
    initializeContinuousMode,
    updateContinuousModeInCache,
    updateContinuousModeUI
  };

  // Legacy global scope exposure (for backward compatibility)
  global.enableContinuousMode = enableContinuousMode;
  global.disableContinuousMode = disableContinuousMode;
  global.toggleContinuousMode = toggleContinuousMode;
  global.initializeContinuousMode = initializeContinuousMode;
  global.updateContinuousModeUI = updateContinuousModeUI;
  global.updateContinuousModeInCache = updateContinuousModeInCache;
  global.isContinuousMode = isContinuousMode; // Will be updated dynamically

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeContinuousMode);
  } else {
    initializeContinuousMode();
  }

})(typeof window !== 'undefined' ? window : globalThis);
