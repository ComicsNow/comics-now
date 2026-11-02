import { state, global as canonicalGlobal } from '../../globals.js';
import { isCinemaPanningActive, stopCinemaPan } from './cinema-pan.js';
import { getHasDragged, clamp, applyFullscreenZoom } from './zoom-pan.js';
import { showFullscreenControls, hideFullscreenControls } from './controls.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const FS_DOUBLE_TAP_MS = 300;
const FS_DOUBLE_TAP_TOLERANCE = 32;
const LONG_PRESS_MS = 250;
const LONG_PRESS_MOVE_TOLERANCE = 12;

let pendingSideNavTimer = null;
let pendingUIToggleTimer = null;
let longPressTimer = null;
let longPressPointerId = null;
let longPressStartX = 0;
let longPressStartY = 0;
let longPressJustFired = false;
let fsLastTapAt = 0;
let fsLastTapX = 0;
let fsLastTapY = 0;
let lastDoubleTapAt = 0;

export function cancelPendingSideNav() {
  if (pendingSideNavTimer) {
    clearTimeout(pendingSideNavTimer);
    pendingSideNavTimer = null;
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

  if (longPressJustFired) {
    longPressJustFired = false;
    return;
  }

  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastDoubleTapAt < 500) return;

  const image = event.currentTarget || global.fullscreenImage;
  if (image && typeof image.getBoundingClientRect === 'function') {
    const rect = image.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const halfW = rect.width / 6;
    const halfH = rect.height / 6;
    if (Math.abs(event.clientX - cx) > halfW) return;
    if (Math.abs(event.clientY - cy) > halfH) return;
  }

  clearTimeout(pendingUIToggleTimer);
  pendingUIToggleTimer = setTimeout(() => {
    pendingUIToggleTimer = null;
    global.showFullscreenControls?.(true);
  }, FS_DOUBLE_TAP_MS);
}

export function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressPointerId = null;
}

export function makeLongPressHandlers(dir) {
  function down(event) {
    if (event.pointerType === 'touch' && global.fullscreenTouchPointers?.size > 1) {
      clearLongPress();
      return;
    }
    if (global.isFullscreenZoomed) return;
    if (global.isFullImageMode) return;
    if (global.GuidedView?.isPanning) return;
    longPressPointerId = event.pointerId;
    longPressStartX = event.clientX;
    longPressStartY = event.clientY;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (global.GuidedView?.isPanning) return;
      longPressJustFired = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch (_) {}
      }
      global.hideFullscreenControls?.();
      if (global.isContinuousMode) {
        if (dir === -1 && typeof global.scrollToPreviousPage === 'function') {
          global.scrollToPreviousPage();
        } else if (dir === 1 && typeof global.scrollToNextPage === 'function') {
          global.scrollToNextPage();
        }
      } else {
        const logicalDir = global.getNavigationDirection ? global.getNavigationDirection(dir) : dir;
        global.navigatePage?.(logicalDir);
      }
    }, LONG_PRESS_MS);
  }

  function move(event) {
    if (longPressPointerId == null || event.pointerId !== longPressPointerId) return;
    const dx = event.clientX - longPressStartX;
    const dy = event.clientY - longPressStartY;
    if ((dx * dx + dy * dy) > (LONG_PRESS_MOVE_TOLERANCE * LONG_PRESS_MOVE_TOLERANCE)) {
      clearLongPress();
    }
  }

  function end(event) {
    if (longPressPointerId != null && event.pointerId !== longPressPointerId) return;
    clearLongPress();
  }

  function click(event) {
    if (longPressJustFired) {
      longPressJustFired = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (global.isFullscreenZoomed) return;
    if (global.isFullImageMode) return;
    if (global.GuidedView?.isPanning) return;

    cancelPendingSideNav();
    pendingSideNavTimer = setTimeout(() => {
      pendingSideNavTimer = null;
      if (global.isFullscreenZoomed) return;
      if (global.isFullImageMode) return;
      if (global.isContinuousMode) {
        if (dir === -1 && typeof global.scrollToPreviousPage === 'function') {
          global.scrollToPreviousPage();
        } else if (dir === 1 && typeof global.scrollToNextPage === 'function') {
          global.scrollToNextPage();
        }
      } else {
        const logicalDir = global.getNavigationDirection ? global.getNavigationDirection(dir) : dir;
        global.navigatePage?.(logicalDir);
      }
    }, 280);
  }

  return { down, move, end, click };
}

export function handleHotspotDblClick(event) {
  cancelPendingSideNav();
  triggerZoomAtClient(event.clientX, event.clientY);
}

export function triggerZoomAtClient(clientX, clientY) {
  if (global.isFullImageMode) return;
  if (global.GuidedView?.isAnyActive?.()) return;
  const image = global.fullscreenImage;
  if (!image) return;
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratioX = clamp(rect.width ? (clientX - rect.left) / rect.width : 0.5, 0, 1);
  const ratioY = clamp(rect.height ? (clientY - rect.top) / rect.height : 0.5, 0, 1);
  if (typeof global.hideFullscreenControls === 'function') {
    global.hideFullscreenControls();
  }
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
}

export function handleFullscreenPointerUpForDblTap(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const gv = global.GuidedView;
  if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
    fsLastTapAt = 0;
    return;
  }
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
  const viewer = global.fullscreenViewer;
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
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }
    cancelPendingSideNav();
    triggerZoomAtClient(event.clientX, event.clientY);
    return;
  }
  fsLastTapAt = now;
  fsLastTapX = event.clientX;
  fsLastTapY = event.clientY;
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('pointerup', handleFullscreenPointerUpForDblTap, { capture: true });
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

export function bindFullscreenLongPress() {
  const left = global.fullscreenNavLeft;
  const right = global.fullscreenNavRight;
  if (left && !left._longPressBound) {
    left._longPressBound = true;
    const h = makeLongPressHandlers(-1);
    left.addEventListener('pointerdown', h.down);
    left.addEventListener('pointermove', h.move);
    left.addEventListener('pointerup', h.end);
    left.addEventListener('pointercancel', h.end);
    left.addEventListener('pointerleave', h.end);
    left.addEventListener('click', h.click);
    left.addEventListener('dblclick', handleHotspotDblClick);
    left.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  if (right && !right._longPressBound) {
    right._longPressBound = true;
    const h = makeLongPressHandlers(1);
    right.addEventListener('pointerdown', h.down);
    right.addEventListener('pointermove', h.move);
    right.addEventListener('pointerup', h.end);
    right.addEventListener('pointercancel', h.end);
    right.addEventListener('pointerleave', h.end);
    right.addEventListener('click', h.click);
    right.addEventListener('dblclick', handleHotspotDblClick);
    right.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

global.cancelPendingSideNav = cancelPendingSideNav;
global.handleFullscreenImageClick = handleFullscreenImageClick;
global.syncZoomToggleButton = syncZoomToggleButton;
global.bindFullscreenZoomToggle = bindFullscreenZoomToggle;
global.bindFullscreenLongPress = bindFullscreenLongPress;
