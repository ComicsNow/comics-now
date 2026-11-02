import { state } from '../../globals.js';

let lastDblZoomAt = 0;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_MOVE_TOLERANCE = 48;
let lastTapAt = 0, lastTapX = 0, lastTapY = 0;

function getImg() { return document.getElementById('fullscreen-image'); }
function getStage() { return document.getElementById('fullscreen-viewer'); }

/**
 * Delegates clicks to the active mode if applicable.
 */
export function handleImageClick(e) {
  // Never intercept clicks on modals or controls
  if (e.target && typeof e.target.closest === 'function') {
    if (e.target.closest('#comic-page-grid-overlay, #fullscreen-controls, #fullscreen-title, #fullscreen-close-btn, #fullscreen-scrubber-container, #reader-scrubber-preview, #reader-thumbnail-filmstrip, button, input, a, select')) {
      return;
    }
  }

  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const getExternalDblAt = state.getLastDoubleTapAt || (typeof window !== 'undefined' ? window.getLastDoubleTapAt : null);
  const effectiveLastDblAt = Math.max(lastDblZoomAt, typeof getExternalDblAt === 'function' ? getExternalDblAt() : 0);
  if (now - effectiveLastDblAt < 500) {
    e.preventDefault?.();
    e.stopPropagation?.();
    return;
  }

  const controls = document.getElementById('fullscreen-controls') || state.fullscreenControls;
  const isControlsOpen = controls && !controls.classList.contains('hidden');
  if (isControlsOpen) {
    const hideControls = state.hideFullscreenControls || window.hideFullscreenControls;
    hideControls?.();
    e.preventDefault?.();
    e.stopPropagation?.();
    return;
  }

  const registry = state.GuidedView.ModeRegistry;
  const activeMode = registry.getActiveMode();
  const manualOverrideBox = registry.getManualOverrideBox();

  if (!activeMode && !manualOverrideBox) return;

  // Clicking directly on the zoom overlay itself (or its inner image) closes/dismisses
  // the zoom rather than hitting whatever panel or bubble is hidden behind it.
  const isOverlayClick = e.target && typeof e.target.closest === 'function' && e.target.closest('#bubble-magnifier-overlay');
  if (isOverlayClick) {
    e.preventDefault?.();
    e.stopPropagation?.();
    state.lastManualOverrideDismissAt = now;
    if (manualOverrideBox) {
      registry.setManualOverrideBox(null);
    }
    if (activeMode && typeof activeMode.handleImageClick === 'function') {
      activeMode.handleImageClick(-9999, -9999);
    }
    if (typeof state.GuidedView.refreshRender === 'function') {
      state.GuidedView.refreshRender();
    }
    if (typeof state.triggerEinkFlash === 'function') {
      state.triggerEinkFlash();
    }
    return;
  }

  if (manualOverrideBox) {
    e.preventDefault();
    e.stopPropagation();
    state.lastManualOverrideDismissAt = now;
    registry.setManualOverrideBox(null);
    if (typeof state.GuidedView.refreshRender === 'function') {
      state.GuidedView.refreshRender();
    }
    if (typeof state.triggerEinkFlash === 'function') {
      state.triggerEinkFlash();
    }
    return;
  }

  const img = getImg();
  if (!img || !img.naturalWidth) return;

  const rect = img.getBoundingClientRect();
  let renderedLeft = rect.left;
  let renderedTop = rect.top;
  let renderedW = rect.width;
  let renderedH = rect.height;
  if (img.naturalWidth > 0 && img.naturalHeight > 0 && rect.width > 0 && rect.height > 0) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = rect.width / rect.height;
    if (boxRatio > imgRatio + 0.01) {
      renderedH = rect.height;
      renderedW = rect.height * imgRatio;
      renderedLeft = rect.left + (rect.width - renderedW) / 2;
    } else if (boxRatio < imgRatio - 0.01) {
      renderedW = rect.width;
      renderedH = rect.width / imgRatio;
      renderedTop = rect.top + (rect.height - renderedH) / 2;
    }
  }

  const isAboveOrBelow = e.clientY < renderedTop || e.clientY > (renderedTop + renderedH);
  const isSideHotspot = !!(e.target && typeof e.target.closest === 'function' && e.target.closest('#fullscreen-nav-left, #fullscreen-nav-right'));
  if (isSideHotspot && !isAboveOrBelow) {
    return;
  }

  const outsideImage = isAboveOrBelow || e.clientX < renderedLeft || e.clientX > (renderedLeft + renderedW);
  if (outsideImage) {
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    showControls?.(true);
    e.preventDefault?.();
    e.stopPropagation?.();
    return;
  }

  const rx = e.clientX - renderedLeft;
  const ry = e.clientY - renderedTop;
  const nx = rx * (img.naturalWidth / renderedW);
  const ny = ry * (img.naturalHeight / renderedH);

  if (activeMode && activeMode.handleImageClick) {
    const handled = activeMode.handleImageClick(nx, ny);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof state.triggerEinkFlash === 'function') {
        state.triggerEinkFlash();
      }
    } else {
      // Not handled by the mode -> show menu
      e.preventDefault?.();
      e.stopPropagation?.();
      const showControls = state.showFullscreenControls || window.showFullscreenControls;
      showControls?.(true);
    }
  } else {
    // No active mode or no click handler -> show menu
    e.preventDefault?.();
    e.stopPropagation?.();
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    showControls?.(true);
  }
}

/**
 * Handles double click or double tap to zoom in/out manually.
 */
export function handleDoubleClickZoom(event) {
  // Never zoom the page behind the open page-preview grid.
  if (event && event.target && typeof event.target.closest === 'function' && event.target.closest('#comic-page-grid-overlay')) return;
  const isFullImageMode = state.isFullImageMode || window.isFullImageMode;
  if (isFullImageMode) return;
  const registry = state.GuidedView.ModeRegistry;
  const activeModeName = registry.getActiveModeName();
  if (activeModeName !== 'western-speech-zoom' && activeModeName !== 'manga-panel-zoom' && activeModeName !== 'bubble' && activeModeName !== 'manga-speech-zoom') return;
  
  const img = getImg();
  if (!img || !img.naturalWidth || !img.naturalHeight) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastDblZoomAt < 250) return;
  lastDblZoomAt = now;
  const cancelSideNav = state.cancelPendingSideNav || window.cancelPendingSideNav;
  if (typeof cancelSideNav === 'function') cancelSideNav();
  const hideControls = state.hideFullscreenControls || window.hideFullscreenControls;
  hideControls?.();
  const isPointerEvt = event && (event.type === 'pointerup' || event.type === 'pointerdown');

  const manualOverrideBox = registry.getManualOverrideBox();
  if (manualOverrideBox) {
    registry.setManualOverrideBox(null);
    if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
    if (typeof state.GuidedView.refreshRender === 'function') {
      state.GuidedView.refreshRender();
    }
    if (typeof state.triggerEinkFlash === 'function') {
      state.triggerEinkFlash();
    }
    return;
  }

  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratioX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const ratioY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  const boxW = Math.round(img.naturalWidth * 0.25);
  const boxH = Math.round(img.naturalHeight * 0.22);
  const cx = ratioX * img.naturalWidth;
  const cy = ratioY * img.naturalHeight;
  const maxX = Math.max(0, img.naturalWidth - boxW);
  const maxY = Math.max(0, img.naturalHeight - boxH);
  const x = Math.max(0, Math.min(maxX, Math.round(cx - boxW / 2)));
  const y = Math.max(0, Math.min(maxY, Math.round(cy - boxH / 2)));
  registry.setManualOverrideBox([x, y, boxW, boxH]);
  if (!isPointerEvt) { event.preventDefault?.(); event.stopPropagation?.(); }
  if (typeof state.GuidedView.refreshRender === 'function') {
    state.GuidedView.refreshRender();
  }
  if (typeof state.triggerEinkFlash === 'function') {
    state.triggerEinkFlash();
  }
}

/**
 * Detects double taps on touch devices.
 */
export function handlePointerUpForDblTap(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  // Grid taps are the grid's business — keep them out of dbl-tap zoom.
  if (event.target && typeof event.target.closest === 'function' && event.target.closest('#comic-page-grid-overlay')) { lastTapAt = 0; return; }
  const registry = state.GuidedView.ModeRegistry;
  const activeModeName = registry.getActiveModeName();
  if (activeModeName !== 'western-speech-zoom' && activeModeName !== 'manga-panel-zoom' && activeModeName !== 'bubble' && activeModeName !== 'manga-speech-zoom') { lastTapAt = 0; return; }
  
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
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('#comic-page-grid-overlay')) return;
      if (typeof state.GuidedView.isAnyGuidedActive === 'function' && state.GuidedView.isAnyGuidedActive()) e.preventDefault();
      else if (typeof window.GuidedView.isAnyGuidedActive === 'function' && window.GuidedView.isAnyGuidedActive()) e.preventDefault();
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Export for verification or other modules
state.GuidedView.handleImageClick = handleImageClick;
state.GuidedView.handleDoubleClickZoom = handleDoubleClickZoom;

if (typeof window !== 'undefined' && window.GuidedView && window.GuidedView !== state.GuidedView) {
  window.GuidedView.handleImageClick = handleImageClick;
  window.GuidedView.handleDoubleClickZoom = handleDoubleClickZoom;
}
