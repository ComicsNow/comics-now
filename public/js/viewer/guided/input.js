import { state } from '../../globals.js';

state.GuidedView = state.GuidedView || {};
if (typeof window !== 'undefined') {
  window.GuidedView = window.GuidedView || {};
}

let lastDblZoomAt = 0;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_MOVE_TOLERANCE = 30;
let lastTapAt = 0, lastTapX = 0, lastTapY = 0;

function getImg() { return document.getElementById('fullscreen-image'); }
function getStage() { return document.getElementById('fullscreen-viewer'); }

/**
 * Delegates clicks to the active mode if applicable.
 */
export function handleImageClick(e) {
  const registry = state.GuidedView.ModeRegistry;
  const activeMode = registry.getActiveMode();
  const manualOverrideBox = registry.getManualOverrideBox();

  if (!activeMode && !manualOverrideBox) return;

  if (manualOverrideBox) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastDblZoomAt < 500) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
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
  const outsideImage = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  if (outsideImage) {
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    showControls?.(true);
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
      if (typeof state.triggerEinkFlash === 'function') {
        state.triggerEinkFlash();
      }
    } else {
      // Not handled by the mode -> show menu
      const showControls = state.showFullscreenControls || window.showFullscreenControls;
      showControls?.(true);
    }
  } else {
    // No active mode or no click handler -> show menu
    const showControls = state.showFullscreenControls || window.showFullscreenControls;
    showControls?.(true);
  }
}

/**
 * Handles double click or double tap to zoom in/out manually.
 */
export function handleDoubleClickZoom(event) {
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
  const boxW = img.naturalWidth * 0.4;
  const boxH = img.naturalHeight * 0.4;
  const cx = ratioX * img.naturalWidth;
  const cy = ratioY * img.naturalHeight;
  registry.setManualOverrideBox([cx - boxW / 2, cy - boxH / 2, boxW, boxH]);
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
      if (typeof state.GuidedView.isAnyGuidedActive === 'function' && state.GuidedView.isAnyGuidedActive()) e.preventDefault();
      else if (typeof window.GuidedView.isAnyGuidedActive === 'function' && window.GuidedView.isAnyGuidedActive()) e.preventDefault();
    });
  }
  document.addEventListener('pointerup', handlePointerUpForDblTap, { capture: true });
  document.addEventListener('dblclick', handleDoubleClickZoom, { capture: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// Export for verification or other modules
state.GuidedView.handleImageClick = handleImageClick;
state.GuidedView.handleDoubleClickZoom = handleDoubleClickZoom;

if (typeof window !== 'undefined') {
  window.GuidedView.handleImageClick = handleImageClick;
  window.GuidedView.handleDoubleClickZoom = handleDoubleClickZoom;
}
