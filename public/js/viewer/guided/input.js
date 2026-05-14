(function (global) {
  'use strict';

  let lastDblZoomAt = 0;
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_MOVE_TOLERANCE = 30;
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;

  function getImg() { return document.getElementById('fullscreen-image'); }
  function getStage() { return document.getElementById('fullscreen-viewer'); }

  /**
   * Delegates clicks to the active mode if applicable.
   */
  function handleImageClick(e) {
    const registry = global.GuidedView.ModeRegistry;
    const activeMode = registry.getActiveMode();
    const manualOverrideBox = registry.getManualOverrideBox();

    if (!activeMode && !manualOverrideBox) return;

    if (manualOverrideBox) {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - lastDblZoomAt < 500) { e.preventDefault(); e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      registry.setManualOverrideBox(null);
      if (typeof global.GuidedView.refreshRender === 'function') {
        global.GuidedView.refreshRender();
      }
      return;
    }

    const img = getImg();
    if (!img || !img.naturalWidth) return;

    const rect = img.getBoundingClientRect();
    const outsideImage = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    if (outsideImage) {
      global.showFullscreenControls?.(true);
      return;
    }

    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    const nx = rx * (img.naturalWidth / rect.width);
    const ny = ry * (img.naturalHeight / rect.height);

    if (activeMode && activeMode.handleImageClick) {
      const handled = activeMode.handleImageClick(nx, ny);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        // Not handled by the mode -> show menu
        global.showFullscreenControls?.(true);
      }
    } else {
      // No active mode or no click handler -> show menu
      global.showFullscreenControls?.(true);
    }
  }

  /**
   * Handles double click or double tap to zoom in/out manually.
   */
  function handleDoubleClickZoom(event) {
    if (global.isFullImageMode) return;
    const registry = global.GuidedView.ModeRegistry;
    const activeModeName = registry.getActiveModeName();
    if (activeModeName !== 'hot-zoom' && activeModeName !== 'bubble' && activeModeName !== 'manga-bubble-hot') return;
    
    const img = getImg();
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDblZoomAt < 250) return;
    lastDblZoomAt = now;
    if (typeof global.cancelPendingSideNav === 'function') global.cancelPendingSideNav();
    const isPointerEvt = event && (event.type === 'pointerup' || event.type === 'pointerdown');

    const manualOverrideBox = registry.getManualOverrideBox();
    if (manualOverrideBox) {
      registry.setManualOverrideBox(null);
      if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
      if (typeof global.GuidedView.refreshRender === 'function') {
        global.GuidedView.refreshRender();
      }
      return;
    }

    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const boxW = img.naturalWidth * 0.4;
    const boxH = img.naturalHeight * 0.4;
    const cx = ratioX * img.naturalWidth;
    const cy = ratioY * img.naturalHeight;
    registry.setManualOverrideBox([cx - boxW / 2, cy - boxH / 2, boxW, boxH]);
    if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
    if (typeof global.GuidedView.refreshRender === 'function') {
      global.GuidedView.refreshRender();
    }
  }

  /**
   * Detects double taps on touch devices.
   */
  function handlePointerUpForDblTap(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const registry = global.GuidedView.ModeRegistry;
    const activeModeName = registry.getActiveModeName();
    if (activeModeName !== 'hot-zoom' && activeModeName !== 'bubble' && activeModeName !== 'manga-bubble-hot') { lastTapAt = 0; return; }
    
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const dx = event.clientX - lastTapX, dy = event.clientY - lastTapY;
    if ((now - lastTapAt) <= DOUBLE_TAP_MS && (dx * dx + dy * dy) <= (DOUBLE_TAP_MOVE_TOLERANCE * DOUBLE_TAP_MOVE_TOLERANCE)) {
      lastTapAt = 0; handleDoubleClickZoom(event); return;
    }
    lastTapAt = now; lastTapX = event.clientX; lastTapY = event.clientY;
  }

  function init() {
    const stage = getStage();
    if (stage) {
      stage.addEventListener('click', handleImageClick, true);
      stage.addEventListener('contextmenu', (e) => {
        if (global.GuidedView.isAnyGuidedActive?.()) e.preventDefault();
      });
    }
    document.addEventListener('pointerup', handlePointerUpForDblTap, { capture: true });
    document.addEventListener('dblclick', handleDoubleClickZoom, { capture: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Export for verification or other modules
  global.GuidedView.handleImageClick = handleImageClick;
  global.GuidedView.handleDoubleClickZoom = handleDoubleClickZoom;

})(typeof window !== 'undefined' ? window : globalThis);
