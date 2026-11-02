// ARCHITECTURAL_EXEMPTION: Integrated 2D gesture and viewport matrix transformation math
import { state, global as canonicalGlobal } from '../../globals.js';
import {
  isLandscapePanActive,
  beginLandscapePan,
  updateLandscapePan,
  endLandscapePan
} from './landscape-pan.js';
import { hideFullscreenControls } from './controls.js';
import { clamp, applyFullscreenZoom, FULLSCREEN_MIN_ZOOM_SCALE } from './zoom.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

let isFullscreenPanning = false;
let fullscreenPanPointerId = null;
let fullscreenPanStartX = 0;
let fullscreenPanStartY = 0;
let fullscreenPanScrollLeft = 0;
let fullscreenPanScrollTop = 0;
let fullscreenPanPointerType = '';
let fullscreenPanCurrentX = 0;
let fullscreenPanCurrentY = 0;
let fullscreenPanRAF = null;
const fullscreenTouchPointers = new Map();
let fullscreenInitialPinchDistance = 0;
let fullscreenInitialPinchScale = 1;
let fullscreenPinchRatioX = 0.5;
let fullscreenPinchRatioY = 0.5;

let pendingPanPointerId = null;
let pendingPanType = '';
let pendingPanStartX = 0;
let pendingPanStartY = 0;
const PAN_START_THRESHOLD = 5;

let hasDragged = false;
const PAN_DRAG_THRESHOLD = 5;
let fsStartX = 0;
let fsStartY = 0;

export function getHasDragged() {
  return hasDragged;
}

export function setHasDragged(val) {
  hasDragged = val;
}

export function animateFullscreenPan() {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image || !isFullscreenPanning) {
    fullscreenPanRAF = null;
    return;
  }

  const deltaX = fullscreenPanCurrentX - fullscreenPanStartX;
  const deltaY = fullscreenPanCurrentY - fullscreenPanStartY;

  const proposedScrollLeft = fullscreenPanScrollLeft - deltaX;
  const proposedScrollTop = fullscreenPanScrollTop - deltaY;

  const maxScrollLeft = viewer.scrollWidth - viewer.clientWidth;
  const maxScrollTop = viewer.scrollHeight - viewer.clientHeight;

  viewer.scrollLeft = clamp(proposedScrollLeft, 0, Math.max(maxScrollLeft, 0));
  viewer.scrollTop = clamp(proposedScrollTop, 0, Math.max(maxScrollTop, 0));

  fullscreenPanRAF = requestAnimationFrame(animateFullscreenPan);
}

export function beginFullscreenPan(pointerId, pointerType, clientX, clientY) {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer) return;

  isFullscreenPanning = true;
  fullscreenPanPointerId = pointerId;
  fullscreenPanPointerType = pointerType;
  fullscreenPanStartX = clientX;
  fullscreenPanStartY = clientY;
  fullscreenPanCurrentX = clientX;
  fullscreenPanCurrentY = clientY;
  fullscreenPanScrollLeft = viewer.scrollLeft;
  fullscreenPanScrollTop = viewer.scrollTop;

  if (viewer && typeof viewer.setPointerCapture === 'function') {
    try {
      viewer.setPointerCapture(pointerId);
    } catch (error) {}
  }

  if (image && (pointerType === 'mouse' || pointerType === 'pen')) {
    image.style.cursor = 'grabbing';
  }

  if (!fullscreenPanRAF) {
    fullscreenPanRAF = requestAnimationFrame(animateFullscreenPan);
  }
}

export function updateFullscreenPanPosition(clientX, clientY) {
  if (!isFullscreenPanning) return;
  fullscreenPanCurrentX = clientX;
  fullscreenPanCurrentY = clientY;
}

export function endFullscreenPan(pointerId) {
  const image = global.fullscreenImage;
  const viewer = global.fullscreenViewer;
  if (!isFullscreenPanning) return;

  const pointerIdToRelease = typeof pointerId === 'number' ? pointerId : fullscreenPanPointerId;

  if (viewer && typeof pointerIdToRelease === 'number' && typeof viewer.releasePointerCapture === 'function') {
    try {
      viewer.releasePointerCapture(pointerIdToRelease);
    } catch (error) {}
  }

  isFullscreenPanning = false;
  fullscreenPanPointerId = null;
  fullscreenPanPointerType = '';

  if (fullscreenPanRAF) {
    cancelAnimationFrame(fullscreenPanRAF);
    fullscreenPanRAF = null;
  }

  if (image && (image.style.cursor === 'grabbing' || image.style.cursor === 'grab')) {
    image.style.cursor = global.isFullscreenZoomed ? 'grab' : 'default';
  }
}

export function getDistanceBetweenPoints(pointA, pointB) {
  if (!pointA || !pointB) return 0;
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return Math.sqrt((dx * dx) + (dy * dy));
}

export function handleFullscreenPointerDown(event) {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  if (global.isContinuousMode || (event.target && typeof event.target.closest === 'function'
      && event.target.closest('#fullscreen-pages-continuous, #comic-page-grid-overlay, #reader-thumbnail-filmstrip, #fullscreen-scrubber-container, #reader-scrubber-preview'))) {
    if (!event.target.closest('button, input, a, select')) {
      hideFullscreenControls();
    }
    return;
  }

  fsStartX = event.clientX;
  fsStartY = event.clientY;
  hasDragged = false;

  if (!event.target.closest('button, input, a, select')) {
    hideFullscreenControls();
  }

  if (event.pointerType === 'touch') {
    fullscreenTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (fullscreenTouchPointers.size === 2) {
      const touchPoints = Array.from(fullscreenTouchPointers.values());
      fullscreenInitialPinchDistance = getDistanceBetweenPoints(touchPoints[0], touchPoints[1]);
      fullscreenInitialPinchScale = global.fullscreenZoomScale || FULLSCREEN_MIN_ZOOM_SCALE;
      const rect = image.getBoundingClientRect();
      const centerX = (touchPoints[0].x + touchPoints[1].x) / 2;
      const centerY = (touchPoints[0].y + touchPoints[1].y) / 2;
      fullscreenPinchRatioX = rect.width ? (centerX - rect.left) / rect.width : 0.5;
      fullscreenPinchRatioY = rect.height ? (centerY - rect.top) / rect.height : 0.5;
      image.style.touchAction = 'none';
      endFullscreenPan();
      return;
    }

    if (fullscreenTouchPointers.size === 1 && isLandscapePanActive()
        && !event.target.closest('#fullscreen-nav-left, #fullscreen-nav-right, button, input, a, select')) {
      beginLandscapePan(event.pointerId, event.clientX, event.clientY);
    } else if (fullscreenTouchPointers.size === 1 && global.isFullscreenZoomed
        && !event.target.closest('button, input, a, select')) {
      beginFullscreenPan(event.pointerId, 'touch', event.clientX, event.clientY);
    }

    return;
  }

  if (isLandscapePanActive() && (event.pointerType === 'mouse' || event.pointerType === 'pen')
      && !event.target.closest('#fullscreen-nav-left, #fullscreen-nav-right, button, input, a, select')) {
    event.preventDefault();
    beginLandscapePan(event.pointerId, event.clientX, event.clientY);
    return;
  }

  if (!global.isFullscreenZoomed) {
    return;
  }

  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
    return;
  }

  if (event.target.closest('button, input, a, select')) {
    return;
  }

  pendingPanPointerId = event.pointerId;
  pendingPanType = event.pointerType;
  pendingPanStartX = event.clientX;
  pendingPanStartY = event.clientY;
}

export function handleFullscreenPointerMove(event) {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  if (global.isContinuousMode || (event.target && typeof event.target.closest === 'function'
      && event.target.closest('#fullscreen-pages-continuous, #comic-page-grid-overlay, #reader-thumbnail-filmstrip, #fullscreen-scrubber-container, #reader-scrubber-preview'))) return;

  if (!hasDragged) {
    const dx = event.clientX - fsStartX;
    const dy = event.clientY - fsStartY;
    if (dx * dx + dy * dy > PAN_DRAG_THRESHOLD * PAN_DRAG_THRESHOLD) {
      hasDragged = true;
    }
  }

  if (event.pointerType === 'touch') {
    let touchPoint = fullscreenTouchPointers.get(event.pointerId);
    if (!touchPoint) {
      touchPoint = { x: event.clientX, y: event.clientY };
      fullscreenTouchPointers.set(event.pointerId, touchPoint);
    } else {
      touchPoint.x = event.clientX;
      touchPoint.y = event.clientY;
    }

    if (fullscreenTouchPointers.size === 2) {
      const touchPoints = Array.from(fullscreenTouchPointers.values());
      const currentDistance = getDistanceBetweenPoints(touchPoints[0], touchPoints[1]);
      if (!fullscreenInitialPinchDistance) {
        fullscreenInitialPinchDistance = currentDistance;
      }
      if (currentDistance > 0 && fullscreenInitialPinchDistance > 0) {
        const scaleRatio = currentDistance / fullscreenInitialPinchDistance;
        const targetScale = (fullscreenInitialPinchScale || FULLSCREEN_MIN_ZOOM_SCALE) * scaleRatio;
        applyFullscreenZoom(targetScale, fullscreenPinchRatioX, fullscreenPinchRatioY);
        event.preventDefault();
      }
      return;
    }

    const { isLandscapePanning, landscapePanPointerId } = global.getLandscapePanState ? global.getLandscapePanState() : {};
    if (isFullscreenPanning && event.pointerId === fullscreenPanPointerId) {
      updateFullscreenPanPosition(event.clientX, event.clientY);
      event.preventDefault();
    } else if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
      updateLandscapePan(event.clientX, event.clientY);
      event.preventDefault();
    }

    return;
  }

  const { isLandscapePanning, landscapePanPointerId } = global.getLandscapePanState ? global.getLandscapePanState() : {};
  if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
    updateLandscapePan(event.clientX, event.clientY);
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      event.preventDefault();
    }
    return;
  }

  if (pendingPanPointerId !== null && event.pointerId === pendingPanPointerId) {
    const dx = event.clientX - pendingPanStartX;
    const dy = event.clientY - pendingPanStartY;
    if ((dx * dx + dy * dy) >= (PAN_START_THRESHOLD * PAN_START_THRESHOLD)) {
      const pid = pendingPanPointerId;
      const ptype = pendingPanType;
      pendingPanPointerId = null;
      pendingPanType = '';
      beginFullscreenPan(pid, ptype, pendingPanStartX, pendingPanStartY);
      updateFullscreenPanPosition(event.clientX, event.clientY);
      event.preventDefault();
    }
    return;
  }

  if (!isFullscreenPanning || event.pointerId !== fullscreenPanPointerId) return;

  updateFullscreenPanPosition(event.clientX, event.clientY);

  if (fullscreenPanPointerType === 'mouse' || fullscreenPanPointerType === 'pen') {
    event.preventDefault();
  }
}

export function handleFullscreenPointerUp(event) {
  const image = global.fullscreenImage;

  if (global.isContinuousMode || (event.target && typeof event.target.closest === 'function'
      && event.target.closest('#fullscreen-pages-continuous, #comic-page-grid-overlay, #reader-thumbnail-filmstrip, #fullscreen-scrubber-container, #reader-scrubber-preview'))) {
    fullscreenTouchPointers.delete(event.pointerId);
    if (event.pointerId === fullscreenPanPointerId) endFullscreenPan(event.pointerId);
    const { landscapePanPointerId } = global.getLandscapePanState ? global.getLandscapePanState() : {};
    if (event.pointerId === landscapePanPointerId) endLandscapePan();
    if (pendingPanPointerId !== null && event.pointerId === pendingPanPointerId) {
      pendingPanPointerId = null;
      pendingPanType = '';
    }
    return;
  }

  if (event.pointerType === 'touch') {
    fullscreenTouchPointers.delete(event.pointerId);

    if (event.pointerId === fullscreenPanPointerId) {
      endFullscreenPan(event.pointerId);
    }

    const { isLandscapePanning, landscapePanPointerId } = global.getLandscapePanState ? global.getLandscapePanState() : {};
    if (event.pointerId === landscapePanPointerId) {
      endLandscapePan();
    }

    if (fullscreenTouchPointers.size < 2) {
      fullscreenInitialPinchDistance = 0;
      fullscreenInitialPinchScale = global.fullscreenZoomScale || FULLSCREEN_MIN_ZOOM_SCALE;
      if (!global.isFullscreenZoomed && image) {
        image.style.touchAction = 'manipulation';
      }
    }

    if (fullscreenTouchPointers.size === 1 && global.isFullscreenZoomed) {
      const [remainingId, remainingPoint] = fullscreenTouchPointers.entries().next().value || [];
      if (remainingPoint) {
        beginFullscreenPan(remainingId, 'touch', remainingPoint.x, remainingPoint.y);
      }
    }

    return;
  }

  const { isLandscapePanning, landscapePanPointerId } = global.getLandscapePanState ? global.getLandscapePanState() : {};
  if (isLandscapePanning && event.pointerId === landscapePanPointerId) {
    endLandscapePan();
    return;
  }

  if (pendingPanPointerId !== null && event.pointerId === pendingPanPointerId) {
    pendingPanPointerId = null;
    pendingPanType = '';
  }

  if (!isFullscreenPanning || event.pointerId !== fullscreenPanPointerId) return;

  endFullscreenPan(event.pointerId);
}

export function onFullscreenReset() {
  const image = global.fullscreenImage;
  endFullscreenPan();
  endLandscapePan();
  fullscreenTouchPointers.clear();
  fullscreenInitialPinchDistance = 0;
  fullscreenInitialPinchScale = FULLSCREEN_MIN_ZOOM_SCALE;
  fullscreenPinchRatioX = 0.5;
  fullscreenPinchRatioY = 0.5;
  if (image) {
    image.style.cursor = 'default';
    image.style.touchAction = 'manipulation';
  }
}

export function cleanupPanPointer(image) {
  if (fullscreenPanRAF) {
    cancelAnimationFrame(fullscreenPanRAF);
    fullscreenPanRAF = null;
  }
  if (fullscreenPanPointerId !== null && image && typeof image.releasePointerCapture === 'function') {
    try {
      image.releasePointerCapture(fullscreenPanPointerId);
    } catch (error) {}
  }
  isFullscreenPanning = false;
  fullscreenPanPointerId = null;
}

global.beginFullscreenPan = beginFullscreenPan;
global.updateFullscreenPanPosition = updateFullscreenPanPosition;
global.endFullscreenPan = endFullscreenPan;
global.getDistanceBetweenPoints = getDistanceBetweenPoints;
global.handleFullscreenPointerDown = handleFullscreenPointerDown;
global.handleFullscreenPointerMove = handleFullscreenPointerMove;
global.handleFullscreenPointerUp = handleFullscreenPointerUp;
global.onFullscreenReset = onFullscreenReset;
