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

  const PORTRAIT_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12" y2="18"></line></svg>`;
  const LANDSCAPE_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="18" y1="12" x2="18" y2="12"></line></svg>`;
  const CONTINUOUS_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><path d="M12 6v12"></path><path d="M9 9l3-3 3 3"></path><path d="M9 15l3 3 3-3"></path></svg>`;
  const MANGA_ICON_HTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3c-1.1 0-2 .9-2 2 0 .52.21 1.04.59 1.41L15 7h-1l-1.5-1.5c-.37-.38-.89-.5-1.41-.5-1.1 0-2 .9-2 2 0 .52.21 1.04.59 1.41L7 11v1l-3 5v2h2l5-3h1l3.59-2.41c.38-.38.5-.89.5-1.41 0-1.1-.9-2-2-2-.52 0-1.04.21-1.41.59L11 10V9l1.5-1.5c.38-.37.89-.5 1.41-.5 1.1 0 2 .9 2 2 0 .52-.21 1.04-.59 1.41L17 12h1l2.41-3.59c.38-.38.59-.9.59-1.41 0-1.1-.9-2-2-2z"></path><path d="M11 13l1 1"></path><path d="M15 9l1 1"></path><path d="M8 16l-4 4"></path></svg>`;

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

  global.computeViewerAvailableHeight = computeViewerAvailableHeight;
  global.applyOrientationToElement = applyOrientationToElement;
  global.applyViewerOrientation = applyViewerOrientation;
  global.applyViewerFitMode = applyViewerFitMode;
  global.setFitToHeightMode = setFitToHeightMode;
  global.refreshToolbarLabels = refreshToolbarLabels;
  global.updateOrientationButtons = updateOrientationButtons;
  global.applyFullscreenOrientation = applyFullscreenOrientation;
  global.setOrientationMode = setOrientationMode;

export {
  computeViewerAvailableHeight,
  applyOrientationToElement,
  applyViewerOrientation,
  applyViewerFitMode,
  setFitToHeightMode,
  refreshToolbarLabels,
  updateOrientationButtons,
  applyFullscreenOrientation,
  setOrientationMode
};

state.computeViewerAvailableHeight = computeViewerAvailableHeight;
state.applyOrientationToElement = applyOrientationToElement;
state.applyViewerOrientation = applyViewerOrientation;
state.applyViewerFitMode = applyViewerFitMode;
state.setFitToHeightMode = setFitToHeightMode;
state.refreshToolbarLabels = refreshToolbarLabels;
state.updateOrientationButtons = updateOrientationButtons;
state.applyFullscreenOrientation = applyFullscreenOrientation;
state.setOrientationMode = setOrientationMode;

if (typeof window !== 'undefined') {
  window.computeViewerAvailableHeight = computeViewerAvailableHeight;
  window.applyOrientationToElement = applyOrientationToElement;
  window.applyViewerOrientation = applyViewerOrientation;
  window.applyViewerFitMode = applyViewerFitMode;
  window.setFitToHeightMode = setFitToHeightMode;
  window.refreshToolbarLabels = refreshToolbarLabels;
  window.updateOrientationButtons = updateOrientationButtons;
  window.applyFullscreenOrientation = applyFullscreenOrientation;
  window.setOrientationMode = setOrientationMode;
}
