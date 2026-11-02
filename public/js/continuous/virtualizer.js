import { state } from '../globals.js';
import {
  clear,
  renderContent,
  safeHtml,
  continuousState,
  isEinkActive
} from './state.js';
import {
  updateContinuousModeUI,
  setupScrollProgressTracking
} from './progress.js';

export function getViewerWidthPx() {
  if (continuousState.continuousContainer && continuousState.continuousContainer.clientWidth) {
    return continuousState.continuousContainer.clientWidth;
  }
  const fsViewer = document.getElementById('fullscreen-viewer');
  if (fsViewer && !fsViewer.classList.contains('hidden')) {
    return fsViewer.clientWidth || window.innerWidth;
  }
  return window.innerWidth;
}

export function applyLandscapeToPage(container, img) {
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
  if (!continuousState.continuousContainer) return;
  const containers = continuousState.continuousContainer.querySelectorAll('.page-container');
  containers.forEach(c => {
    const img = c.querySelector('img');
    if (img) applyLandscapeToPage(c, img);
  });
}

/**
 * Initialize IntersectionObserver for lazy loading pages as they enter viewport
 */
export function initIntersectionObserver() {
  if (continuousState.intersectionObserver) {
    continuousState.intersectionObserver.disconnect();
  }

  const options = {
    root: null,
    rootMargin: '500px',
    threshold: 0
  };

  continuousState.intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageName = entry.target.dataset.page;
        if (pageName && !continuousState.loadedPages.has(pageName)) {
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
export async function loadPage(pageName, container) {
  if (continuousState.loadedPages.has(pageName)) return;

  try {
    continuousState.loadedPages.add(pageName);

    const getPageUrl = state.getPageUrl || window.getPageUrl;
    if (typeof getPageUrl !== 'function') {
      throw new Error('getPageUrl function not available');
    }

    const pageUrl = await getPageUrl(pageName);

    const img = document.createElement('img');
    img.alt = `Page ${pageName}`;
    const eink = isEinkActive();
    if (!eink) {
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.2s';
    }

    img.onload = () => {
      if (!eink) {
        img.style.opacity = '1';
      }
      applyLandscapeToPage(container, img);
    };

    img.onerror = () => {
      console.error('[CONTINUOUS] Failed to load image:', pageName, pageUrl);
      renderContent(container, safeHtml`<div class="text-red-400 p-4">Failed to load: ${pageName}</div>`);
    };

    clear(container);
    container.appendChild(img);
    continuousState.pageElements.set(pageName, img);

    img.src = pageUrl;
  } catch (error) {
    console.error('[CONTINUOUS] Error loading page:', pageName, error);
    renderContent(container, safeHtml`<div class="text-red-400 p-4">Error: ${error.message}</div>`);
  }
}

/**
 * Render all pages in vertical continuous scroll mode
 */
export async function renderContinuousMode() {
  const getViewerPages = state.getViewerPages || window.getViewerPages;
  const pages = getViewerPages?.() || [];
  if (!pages.length) {
    return;
  }

  const continuousContainer = continuousState.continuousContainer;
  if (!continuousContainer) {
    console.error('[CONTINUOUS] Container not found');
    return;
  }

  clear(continuousContainer);
  continuousState.loadedPages.clear();
  continuousState.pageElements.clear();

  pages.forEach((pageName, index) => {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-container w-full';
    pageContainer.dataset.page = pageName;
    pageContainer.dataset.index = index;

    renderContent(pageContainer, safeHtml`
      <div class="animate-pulse bg-gray-700 h-96 w-full max-w-2xl rounded"></div>
    `);

    continuousContainer.appendChild(pageContainer);

    if (continuousState.intersectionObserver) {
      continuousState.intersectionObserver.observe(pageContainer);
    }
  });

  updateContinuousModeUI(true);

  const currentIndex = state.currentPageIndex || 0;
  const targetContainer = continuousContainer.querySelector(
    `.page-container[data-index="${currentIndex}"]`
  );
  if (targetContainer) {
    continuousState.isInitializingScroll = true;
    try {
      targetContainer.scrollIntoView({ behavior: 'auto', block: 'center' });
    } catch (_) {
      try { targetContainer.scrollIntoView(true); } catch (e) {}
    }

    setTimeout(() => {
      continuousState.isInitializingScroll = false;
    }, 300);

    setTimeout(() => {
      setupScrollProgressTracking();
    }, 350);
  } else {
    setupScrollProgressTracking();
  }
}
