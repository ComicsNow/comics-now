// Full Image mode: image displayed at natural size; user can only pan.
// Reuses the same scroll-based pan path as the dblclick zoom so the
// boundaries clamp correctly. Continuous, double-tap zoom, page nav are
// disabled while active. Composes with landscape (rotation).
(function (global) {
  'use strict';

  function getImage() {
    return global.fullscreenImage || document.getElementById('fullscreen-image');
  }
  function getViewer() {
    return global.fullscreenViewer || document.getElementById('fullscreen-viewer');
  }

  function applyLayout() {
    const image = getImage();
    const viewer = getViewer();
    if (!image || !viewer) return;
    if (!global.isFullImageMode) return;

    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!w || !h) return; // image not yet loaded; load handler will retry

    // Mirror applyFullscreenZoom's "scale > MIN" branch so the existing
    // pointerdown/move/up handlers (which gate on isFullscreenZoomed) drive
    // scroll-based panning with proper clamping.
    viewer.classList.remove('fullscreen-fit-mode');
    viewer.classList.add('full-image-mode');
    global.isFullscreenZoomed = true;
    global.fullscreenZoomScale = 1;
    global.fullscreenZoomBaseWidth = w;
    global.fullscreenZoomBaseHeight = h;

    image.style.width = `${w}px`;
    image.style.height = `${h}px`;
    image.style.maxWidth = 'none';
    image.style.maxHeight = 'none';
    image.style.cursor = 'grab';
    image.style.touchAction = 'none';
    image.style.margin = '0 auto';

    if (typeof global.updateFullscreenViewerCentering === 'function') {
      global.updateFullscreenViewerCentering();
    }
    if (typeof global.updateFullscreenScrollFromRatios === 'function') {
      // Start centered.
      global.updateFullscreenScrollFromRatios(0.5, 0.5);
    }
  }

  function clearLayout() {
    const image = getImage();
    const viewer = getViewer();
    if (!image || !viewer) return;

    viewer.classList.remove('full-image-mode');
    global.isFullscreenZoomed = false;
    global.fullscreenZoomScale = 1;
    global.fullscreenZoomBaseWidth = 0;
    global.fullscreenZoomBaseHeight = 0;

    image.style.width = '';
    image.style.height = '';
    image.style.maxWidth = '';
    image.style.maxHeight = '';
    image.style.cursor = '';
    image.style.touchAction = '';
    image.style.margin = '';
  }

  async function setFullImageMode(enable, options = {}) {
    const newVal = !!enable;
    const persist = options.persist !== false;
    global.isFullImageMode = newVal;
    if (typeof global.refreshGuidedToggle === 'function') global.refreshGuidedToggle();

    const btn = document.getElementById('fullscreen-full-image-btn');
    if (btn) btn.classList.toggle('active', newVal);

    if (newVal) {
      if (global.isContinuousMode && typeof global.disableContinuousMode === 'function') {
        try { await global.disableContinuousMode(); } catch (_) {}
      }
      global.GuidedView?.disableAll?.();
      applyLayout();
      global.showFullscreenControls?.(false);
    } else {
      clearLayout();
      if (typeof global.applyFullscreenFitMode === 'function') {
        global.applyFullscreenFitMode();
      }
      global.showFullscreenControls?.(true);
    }

    const comic = global.currentComic;
    if (persist && comic && comic.id != null) {
      comic.fullImageMode = newVal;
      if (typeof global.updateComicInLibrary === 'function') {
        global.updateComicInLibrary(comic.id, { fullImageMode: newVal });
      }
      const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
      fetch(`${base}/api/v1/comics/${encodeURIComponent(comic.id)}/full-image-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullImageMode: newVal })
      }).catch(() => {});
    }
  }

  function toggleFullImageMode() {
    setFullImageMode(!global.isFullImageMode);
  }

  function bindButton() {
    const btn = document.getElementById('fullscreen-full-image-btn');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleFullImageMode();
    });
  }

  function init() {
    bindButton();
    const img = getImage();
    if (img && !img._fullImageLoadBound) {
      img._fullImageLoadBound = true;
      img.addEventListener('load', () => {
        if (global.isFullImageMode) applyLayout();
      });
    }
  }

  global.isFullImageMode = false;
  global.setFullImageMode = setFullImageMode;
  global.toggleFullImageMode = toggleFullImageMode;
  global.applyFullImageLayout = applyLayout;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
