import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const LONG_PRESS_MS = 250;
const LONG_PRESS_MOVE_TOLERANCE = 12;
const HOTSPOT_DOUBLE_TAP_MS = 380;

let longPressTimer = null;
let longPressPointerId = null;
let longPressStartX = 0;
let longPressStartY = 0;
let longPressJustFired = false;
let pendingSideNavTimer = null;

export function consumeLongPressJustFired() {
  if (longPressJustFired) {
    longPressJustFired = false;
    return true;
  }
  return false;
}

export function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressPointerId = null;
}

export function cancelLocalPendingSideNav() {
  if (pendingSideNavTimer) {
    clearTimeout(pendingSideNavTimer);
    pendingSideNavTimer = null;
  }
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
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const lastDbl = typeof global.getLastDoubleTapAt === 'function' ? global.getLastDoubleTapAt() : 0;
    if (now - lastDbl < 500) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (global.isFullscreenZoomed) return;
    if (global.isFullImageMode) return;
    if (global.GuidedView?.isPanning) return;

    global.cancelPendingSideNav?.();
    cancelLocalPendingSideNav();
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
    }, HOTSPOT_DOUBLE_TAP_MS + 20);
  }

  return { down, move, end, click };
}

export function bindFullscreenLongPress() {
  const left = global.fullscreenNavLeft;
  const right = global.fullscreenNavRight;
  const onHotspotDblClick = (e) => global.handleHotspotDblClick?.(e);
  if (left && !left._longPressBound) {
    left._longPressBound = true;
    const h = makeLongPressHandlers(-1);
    left.addEventListener('pointerdown', h.down);
    left.addEventListener('pointermove', h.move);
    left.addEventListener('pointerup', h.end);
    left.addEventListener('pointercancel', h.end);
    left.addEventListener('pointerleave', h.end);
    left.addEventListener('click', h.click);
    left.addEventListener('dblclick', onHotspotDblClick);
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
    right.addEventListener('dblclick', onHotspotDblClick);
    right.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

global.consumeLongPressJustFired = consumeLongPressJustFired;
global.cancelLocalPendingSideNav = cancelLocalPendingSideNav;
global.bindFullscreenLongPress = bindFullscreenLongPress;
