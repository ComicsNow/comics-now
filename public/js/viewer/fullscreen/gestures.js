import { state, global as canonicalGlobal } from '../../globals.js';
import { isCinemaPanningActive, stopCinemaPan } from './cinema-pan.js';
import { getHasDragged, clamp, applyFullscreenZoom } from './zoom-pan.js';
import { showFullscreenControls, hideFullscreenControls } from './controls.js';
import { clearLongPress, makeLongPressHandlers, bindFullscreenLongPress, consumeLongPressJustFired, cancelLocalPendingSideNav } from './long-press.js';

export { clearLongPress, makeLongPressHandlers, bindFullscreenLongPress, consumeLongPressJustFired };

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export const FS_DOUBLE_TAP_MS = 380;
export const FS_DOUBLE_TAP_TOLERANCE = 48;

let pendingSideNavTimer = null;
let pendingUIToggleTimer = null;
let fsLastTapAt = 0;
let fsLastTapX = 0;
let fsLastTapY = 0;
let lastDoubleTapAt = 0;

export function getLastDoubleTapAt() {
  return lastDoubleTapAt;
}

export function cancelPendingSideNav() {
  if (pendingSideNavTimer) {
    clearTimeout(pendingSideNavTimer);
    pendingSideNavTimer = null;
  }
  if (typeof cancelLocalPendingSideNav === 'function') {
    cancelLocalPendingSideNav();
  }
}

export function handleFullscreenImageClick(event) {
  if (isCinemaPanningActive()) {
    stopCinemaPan();
    return;
  }
  if (getHasDragged()) return;
  if (global.isFullImageMode) {
    global.showFullscreenControls?.(false);
    return;
  }

  if (typeof consumeLongPressJustFired === 'function' && consumeLongPressJustFired()) {
    return;
  }

  // Never dismiss or intercept if the click target is a control element
  if (event.target && typeof event.target.closest === 'function') {
    if (event.target.closest('#comic-page-grid-overlay, #fullscreen-controls, #fullscreen-title, #fullscreen-close-btn, #fullscreen-scrubber-container, #reader-scrubber-preview, #reader-thumbnail-filmstrip, button, input, a, select')) {
      return;
    }
  }

  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastDoubleTapAt < 500) return;

  const controls = global.fullscreenControls || document.getElementById('fullscreen-controls');
  if (controls && !controls.classList.contains('hidden')) {
    clearTimeout(pendingUIToggleTimer);
    pendingUIToggleTimer = null;
    global.hideFullscreenControls?.();
    return;
  }

  const image = event.currentTarget || global.fullscreenImage;
  if (image && typeof image.getBoundingClientRect === 'function') {
    const rect = image.getBoundingClientRect();
    // Exclude only the outer 10% side margins so the central 80% surfaces controls
    const margin = rect.width * 0.10;
    if (event.clientX < (rect.left + margin) || event.clientX > (rect.right - margin)) {
      return;
    }
  }

  clearTimeout(pendingUIToggleTimer);
  pendingUIToggleTimer = setTimeout(() => {
    pendingUIToggleTimer = null;
    const c = global.fullscreenControls || document.getElementById('fullscreen-controls');
    if (c && !c.classList.contains('hidden')) {
      global.hideFullscreenControls?.();
    } else {
      global.showFullscreenControls?.(true);
    }
  }, FS_DOUBLE_TAP_MS);
}



export function handleHotspotDblClick(event) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastDoubleTapAt < 250) return;
  lastDoubleTapAt = now;
  cancelPendingSideNav();
  triggerZoomAtClient(event.clientX, event.clientY);
}

export function triggerZoomAtClient(clientX, clientY) {
  if (global.isFullImageMode) return;
  if (typeof global.hideFullscreenControls === 'function') {
    global.hideFullscreenControls();
  }

  const gv = global.GuidedView;
  const registry = gv?.ModeRegistry;
  const activeModeName = registry?.getActiveModeName?.();
  const isGuidedInteractive = activeModeName === 'western-speech-zoom' || activeModeName === 'manga-panel-zoom' || activeModeName === 'bubble' || activeModeName === 'manga-speech-zoom';

  if (isGuidedInteractive) {
    const img = global.fullscreenImage || document.getElementById('fullscreen-image');
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const manualBox = registry.getManualOverrideBox?.();
    const recentlyDismissed = (now - (global.lastManualOverrideDismissAt || 0)) <= (FS_DOUBLE_TAP_MS + 100);
    const activeMode = registry.getActiveMode?.();
    if (manualBox || recentlyDismissed) {
      registry.setManualOverrideBox(null);
      activeMode?.onPageRendered?.();
    } else {
      activeMode?.onPageRendered?.();
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratioX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ratioY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const boxW = Math.round(img.naturalWidth * 0.25);
      const boxH = Math.round(img.naturalHeight * 0.22);
      const cx = ratioX * img.naturalWidth;
      const cy = ratioY * img.naturalHeight;
      const maxX = Math.max(0, img.naturalWidth - boxW);
      const maxY = Math.max(0, img.naturalHeight - boxH);
      const x = Math.max(0, Math.min(maxX, Math.round(cx - boxW / 2)));
      const y = Math.max(0, Math.min(maxY, Math.round(cy - boxH / 2)));
      registry.setManualOverrideBox([x, y, boxW, boxH]);
    }
    if (typeof gv.refreshRender === 'function') {
      gv.refreshRender();
    }
    if (typeof global.triggerEinkFlash === 'function') {
      global.triggerEinkFlash();
    }
    return;
  }

  const image = global.fullscreenImage || document.getElementById('fullscreen-image');
  if (!image) return;
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratioX = clamp(rect.width ? (clientX - rect.left) / rect.width : 0.5, 0, 1);
  const ratioY = clamp(rect.height ? (clientY - rect.top) / rect.height : 0.5, 0, 1);

  if (!global.isFullscreenZoomed) {
    if (typeof applyFullscreenZoom === 'function') {
      applyFullscreenZoom(2, ratioX, ratioY);
    } else {
      global.applyFullscreenZoom?.(2, ratioX, ratioY);
    }
  } else {
    global.endFullscreenPan?.();
    global.resetFullscreenZoom?.();
  }
  syncZoomToggleButton();
}

export function handleFullscreenPointerUpForDblTap(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (global.isContinuousMode || (event.target && typeof event.target.closest === 'function'
      && event.target.closest('#fullscreen-pages-continuous'))) {
    fsLastTapAt = 0;
    return;
  }
  if (event.target && typeof event.target.closest === 'function'
      && event.target.closest('button, input, a, select, #fullscreen-controls, #comic-page-grid-overlay, #fullscreen-scrubber-container, #reader-scrubber-preview, #reader-thumbnail-filmstrip')) {
    fsLastTapAt = 0;
    return;
  }
  const viewer = global.fullscreenViewer || document.getElementById('fullscreen-viewer');
  if (!viewer || viewer.classList.contains('hidden')) {
    fsLastTapAt = 0;
    return;
  }
  if (event.target && typeof event.target.closest === 'function' && !viewer.contains(event.target)) {
    fsLastTapAt = 0;
    return;
  }
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const dx = event.clientX - fsLastTapX;
  const dy = event.clientY - fsLastTapY;
  const within = (now - fsLastTapAt) <= FS_DOUBLE_TAP_MS &&
                 (dx * dx + dy * dy) <= (FS_DOUBLE_TAP_TOLERANCE * FS_DOUBLE_TAP_TOLERANCE);
  if (within) {
    fsLastTapAt = 0;
    lastDoubleTapAt = now;
    clearTimeout(pendingUIToggleTimer);
    pendingUIToggleTimer = null;
    cancelPendingSideNav();
    triggerZoomAtClient(event.clientX, event.clientY);
    return;
  }
  fsLastTapAt = now;
  fsLastTapX = event.clientX;
  fsLastTapY = event.clientY;
}

export function handleViewerDblClick(event) {
  if (event.target && typeof event.target.closest === 'function'
      && event.target.closest('button, input, a, select, #fullscreen-controls, #comic-page-grid-overlay, #fullscreen-scrubber-container, #reader-scrubber-preview, #reader-thumbnail-filmstrip')) {
    return;
  }
  const viewer = global.fullscreenViewer || document.getElementById('fullscreen-viewer');
  if (!viewer || viewer.classList.contains('hidden')) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastDoubleTapAt < 250) {
    return;
  }
  lastDoubleTapAt = now;
  cancelPendingSideNav();
  clearTimeout(pendingUIToggleTimer);
  pendingUIToggleTimer = null;
  triggerZoomAtClient(event.clientX, event.clientY);
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('pointerup', handleFullscreenPointerUpForDblTap, { capture: true });
  document.addEventListener('dblclick', handleViewerDblClick, { capture: true });
}

export function syncZoomToggleButton() {
  const btn = document.getElementById('fullscreen-zoom-toggle-btn');
  if (!btn) return;
  const on = !!global.isFullscreenZoomed;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function bindFullscreenZoomToggle() {
  const btn = document.getElementById('fullscreen-zoom-toggle-btn');
  if (!btn || btn._zoomBound) return;
  btn._zoomBound = true;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    if (global.isFullImageMode) return;
    const gv = global.GuidedView;
    if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
      return;
    }
    if (global.isFullscreenZoomed) {
      global.endFullscreenPan?.();
      global.resetFullscreenZoom?.();
    } else {
      if (typeof applyFullscreenZoom === 'function') {
        applyFullscreenZoom(2, 0.5, 0.5);
      } else {
        global.applyFullscreenZoom?.(2, 0.5, 0.5);
      }
    }
    syncZoomToggleButton();
  });
}



global.getLastDoubleTapAt = getLastDoubleTapAt;
global.cancelPendingSideNav = cancelPendingSideNav;
global.handleFullscreenImageClick = handleFullscreenImageClick;
global.handleHotspotDblClick = handleHotspotDblClick;
global.syncZoomToggleButton = syncZoomToggleButton;
global.bindFullscreenZoomToggle = bindFullscreenZoomToggle;
if (typeof bindFullscreenLongPress !== 'undefined') {
  global.bindFullscreenLongPress = bindFullscreenLongPress;
}
