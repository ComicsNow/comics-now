import { state, global as canonicalGlobal } from '../../globals.js';
import { applyLandscapeTransform } from './landscape-pan.js';
import { updateFullscreenViewerCentering } from './fit.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export const FULLSCREEN_MIN_ZOOM_SCALE = 1;
export const FULLSCREEN_MAX_ZOOM_SCALE = 4;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function ensureFullscreenZoomBaseSize() {
  const image = global.fullscreenImage;
  if (!image || global.fullscreenZoomBaseWidth || global.fullscreenZoomBaseHeight) {
    return;
  }

  const rect = image.getBoundingClientRect();
  global.fullscreenZoomBaseWidth = rect.width || image.naturalWidth || 0;
  global.fullscreenZoomBaseHeight = rect.height || image.naturalHeight || 0;
}

export function updateFullscreenScrollFromRatios(ratioX, ratioY) {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  const rect = image.getBoundingClientRect();
  const scrollWidth = Math.max(rect.width - viewer.clientWidth, 0);
  const scrollHeight = Math.max(rect.height - viewer.clientHeight, 0);

  viewer.scrollLeft = scrollWidth * ratioX;
  viewer.scrollTop = scrollHeight * ratioY;
}

export function applyFullscreenZoom(scale, ratioX = 0.5, ratioY = 0.5) {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;
  if (global.isFullImageMode) return;

  const gv = global.GuidedView;
  if (gv && (gv.isActive?.() || gv.isBubbleActive?.() || gv.isWesternSpeechZoomActive?.() || gv.isMangaPanelZoomActive?.() || gv.isMangaSpeechZoomActive?.())) {
    return;
  }

  ensureFullscreenZoomBaseSize();

  const clampedScale = clamp(scale, FULLSCREEN_MIN_ZOOM_SCALE, FULLSCREEN_MAX_ZOOM_SCALE);
  if (clampedScale <= FULLSCREEN_MIN_ZOOM_SCALE) {
    if (!viewer.classList.contains('fullscreen-fit-mode')) {
      viewer.classList.add('fullscreen-fit-mode');
    }
    viewer.style.touchAction = 'manipulation';
    image.style.transform = '';
    image.style.transformOrigin = '';
    image.style.cursor = 'default';
    image.style.touchAction = 'manipulation';
    global.isFullscreenZoomed = false;
    global.fullscreenZoomScale = FULLSCREEN_MIN_ZOOM_SCALE;
    if (global.isLandscapeOrientation) {
      applyLandscapeTransform();
      image.style.cursor = 'grab';
      image.style.touchAction = 'none';
    }
    updateFullscreenViewerCentering();
    return;
  }

  viewer.classList.remove('fullscreen-fit-mode');

  global.isFullscreenZoomed = true;
  global.fullscreenZoomScale = clampedScale;

  const baseWidth = global.fullscreenZoomBaseWidth || image.naturalWidth || image.clientWidth || 0;
  const baseHeight = global.fullscreenZoomBaseHeight || image.naturalHeight || image.clientHeight || 0;

  image.style.width = `${baseWidth * clampedScale}px`;
  image.style.height = `${baseHeight * clampedScale}px`;
  image.style.maxWidth = 'none';
  image.style.maxHeight = 'none';
  image.style.cursor = 'grab';
  image.style.touchAction = 'none';
  image.style.margin = '0 auto';
  if (global.isLandscapeOrientation) {
    applyLandscapeTransform();
  }

  updateFullscreenScrollFromRatios(ratioX, ratioY);
  updateFullscreenViewerCentering();
  if (typeof global.syncZoomToggleButton === 'function') {
    global.syncZoomToggleButton();
  }
}

global.clamp = clamp;
global.ensureFullscreenZoomBaseSize = ensureFullscreenZoomBaseSize;
global.updateFullscreenScrollFromRatios = updateFullscreenScrollFromRatios;
global.applyFullscreenZoom = applyFullscreenZoom;
global.FULLSCREEN_MIN_ZOOM_SCALE = FULLSCREEN_MIN_ZOOM_SCALE;
global.FULLSCREEN_MAX_ZOOM_SCALE = FULLSCREEN_MAX_ZOOM_SCALE;
