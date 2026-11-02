import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export const FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = 3000;

let fullscreenControlsTimeoutId = null;

export function sanitizeComicTitleLocal(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let clean = rawTitle.trim();
  const isDirtyRelease = /\[[^\]]*\]/.test(clean) || /^\s*\d{1,3}\s*[-._]/.test(clean);
  clean = clean.replace(/\.(cbz|cbr|cb7|cbt|zip|rar|tar|pdf)$/i, '');
  clean = clean.replace(/\[[^\]]*\]/g, ' ');
  clean = clean.replace(/^\s*\d{1,3}\s*[-._]\s*(?=[a-zA-Z])/i, '');
  clean = clean.replace(/^\s*\d{1,3}\s+(?=[a-zA-Z])/i, '');
  if (isDirtyRelease) {
    clean = clean.replace(/\s*\((?:19|20)\d{2}\b[^\)]*\)\s*(?=#\d+)/i, ' ');
  }
  clean = clean.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || rawTitle.trim();
}

export function getCleanComicTitle(comic) {
  if (!comic) return '';
  const applyFn = global.applyDisplayInfoToComic || (typeof window !== 'undefined' && window.applyDisplayInfoToComic) || global.state?.applyDisplayInfoToComic;
  const displayInfo = typeof applyFn === 'function' ? applyFn(comic) : null;
  let candidate = displayInfo?.displayTitle || comic.displayName || comic.cleanTitle;
  if (!candidate) {
    const series = comic.series ? String(comic.series).trim() : '';
    const rawName = comic.name ? String(comic.name).trim() : '';
    candidate = rawName || series || 'Untitled';
  }
  const sanitizeFn = global.sanitizeComicTitle || sanitizeComicTitleLocal;
  return sanitizeFn(candidate);
}

export function syncFullscreenTitle() {
  const title = global.fullscreenTitle;
  if (!title) return;
  const comic = global.currentComic;
  if (!comic) {
    title.textContent = '';
    return;
  }
  const cleanTitle = getCleanComicTitle(comic);
  title.textContent = cleanTitle;
  if (typeof title.setAttribute === 'function') {
    title.setAttribute('title', cleanTitle);
    title.setAttribute('aria-label', cleanTitle);
  }
}

export function showFullscreenControls(autoHide = false) {
  const activeMode = global.GuidedView?.getActiveModeName?.();
  const isInteractiveZoom = activeMode === 'manga-panel-zoom' || activeMode === 'western-speech-zoom' || activeMode === 'manga-speech-zoom';
  if (global.isFullImageMode || isInteractiveZoom) autoHide = false;
  const controls = global.fullscreenControls;
  const closeBtn = global.fullscreenCloseBtn;
  const title = global.fullscreenTitle;
  if (!controls) return;

  controls.classList.remove('hidden');
  if (global.fullscreenViewer) {
    global.fullscreenViewer.classList.add('has-controls-open');
  }
  if (closeBtn) closeBtn.classList.remove('hidden');
  if (title) {
    syncFullscreenTitle();
    title.classList.remove('hidden');
  }
  const scrubber = document.getElementById('fullscreen-scrubber-container');
  if (scrubber) scrubber.classList.remove('hidden');

  if (autoHide) {
    clearTimeout(fullscreenControlsTimeoutId);
    fullscreenControlsTimeoutId = setTimeout(() => {
      if (global.isFilmstripOpen?.()) return;
      if (global.fullscreenControls) {
        global.fullscreenControls.classList.add('hidden');
      }
      if (global.fullscreenViewer) {
        global.fullscreenViewer.classList.remove('has-controls-open');
      }
      // Title and top-right close button remain permanently visible in fullscreen mode
      const sc = document.getElementById('fullscreen-scrubber-container');
      if (sc) sc.classList.add('hidden');
      fullscreenControlsTimeoutId = null;
    }, FULLSCREEN_CONTROLS_AUTOHIDE_DELAY);
  }
}

export function hideFullscreenControls() {
  const activeMode = global.GuidedView?.getActiveModeName?.();
  const isInteractiveZoom = activeMode === 'manga-panel-zoom' || activeMode === 'western-speech-zoom' || activeMode === 'manga-speech-zoom';
  if (global.isFullImageMode || isInteractiveZoom) return;
  const controls = global.fullscreenControls;
  if (!controls) return;

  controls.classList.add('hidden');
  if (global.fullscreenViewer) {
    global.fullscreenViewer.classList.remove('has-controls-open');
  }
  // Title and top-right close button remain permanently visible in fullscreen mode
  const scrubber = document.getElementById('fullscreen-scrubber-container');
  if (scrubber && !global.isFilmstripOpen?.()) scrubber.classList.add('hidden');
  clearTimeout(fullscreenControlsTimeoutId);
  fullscreenControlsTimeoutId = null;
}

export function setupControlsAutohide(controls) {
  if (!controls || controls._autohidePauseListener) return;
  controls._autohidePauseListener = true;
  const pauseAutohide = () => {
    if (fullscreenControlsTimeoutId) {
      clearTimeout(fullscreenControlsTimeoutId);
      fullscreenControlsTimeoutId = null;
    }
  };
  const resumeAutohide = () => {
    if (controls && !controls.classList.contains('hidden')) {
      showFullscreenControls(true);
    }
  };
  controls.addEventListener('pointerenter', pauseAutohide);
  controls.addEventListener('pointerleave', resumeAutohide);
  controls.addEventListener('touchstart', pauseAutohide, { passive: true });
  controls.addEventListener('touchend', resumeAutohide, { passive: true });
}

export function clearControlsTimeout() {
  if (fullscreenControlsTimeoutId) {
    clearTimeout(fullscreenControlsTimeoutId);
    fullscreenControlsTimeoutId = null;
  }
}

global.showFullscreenControls = showFullscreenControls;
global.hideFullscreenControls = hideFullscreenControls;
global.syncFullscreenTitle = syncFullscreenTitle;
global.getCleanComicTitle = getCleanComicTitle;
global.FULLSCREEN_CONTROLS_AUTOHIDE_DELAY = FULLSCREEN_CONTROLS_AUTOHIDE_DELAY;
