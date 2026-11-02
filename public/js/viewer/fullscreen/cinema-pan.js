import { state, global as canonicalGlobal } from '../../globals.js';
import { applyFullscreenFitMode } from './fit.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

let isCinemaPanning = false;
let cinemaPanRAF = null;
let cinemaPanEndTimeout = null;
let lastFullscreenStatusPage = null;
let lastCinemaPanSrc = null;

export function isCinemaPanningActive() {
  return isCinemaPanning;
}

export function resetCinemaStatus() {
  lastFullscreenStatusPage = null;
  lastCinemaPanSrc = null;
}

export function stopCinemaPan() {
  const cancelRaf = (typeof window !== 'undefined' && window.cancelAnimationFrame) || (typeof globalThis !== 'undefined' && globalThis.cancelAnimationFrame);
  if (cinemaPanRAF && typeof cancelRaf === 'function') {
    cancelRaf(cinemaPanRAF);
    cinemaPanRAF = null;
  }
  if (cinemaPanEndTimeout) {
    clearTimeout(cinemaPanEndTimeout);
    cinemaPanEndTimeout = null;
  }
  isCinemaPanning = false;

  const viewer = global.fullscreenViewer;
  if (viewer) {
    viewer.classList.remove('cinema-stage');
  }

  const img = global.fullscreenImage;
  if (img) {
    img.classList.remove('cinema-img');
    img.style.transform = '';
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    img.style.willChange = '';
    img.style.margin = '';
  }
  const fitMode = typeof applyFullscreenFitMode === 'function' ? applyFullscreenFitMode : global.applyFullscreenFitMode;
  if (typeof fitMode === 'function') {
    fitMode();
  }

  const badgeText = document.getElementById('fullscreen-spread-badge-text');
  if (badgeText) badgeText.textContent = 'Cinema Pan Spread';
  checkSpreadCinemaStatus();
}

export function checkSpreadCinemaStatus(options = {}) {
  const img = global.fullscreenImage;
  const badge = document.getElementById('fullscreen-spread-badge');
  if (!img) return;

  const check = () => {
    const naturalW = img.naturalWidth || 0;
    const naturalH = img.naturalHeight || 0;
    const isSpread = naturalW > 0 && naturalH > 0 && (naturalW / naturalH >= 1.2);

    if (badge) {
      if (isSpread && !isCinemaPanning) {
        badge.classList.remove('hidden');
      } else if (!isSpread) {
        badge.classList.add('hidden');
      }
    }

    if (options.autoPan) {
      maybeAutoPanCinema(isSpread);
    }
  };

  if (img.complete && img.naturalWidth) {
    check();
  } else {
    img.onload = check;
  }
}

export function maybeAutoPanCinema(isSpread) {
  const viewer = global.fullscreenViewer;
  if (viewer && viewer.classList.contains('hidden')) return;
  if (isCinemaPanning) return;

  const img = global.fullscreenImage;
  const src = img ? (img.currentSrc || img.src || '') : '';
  if (!src || src === lastCinemaPanSrc) return;
  lastCinemaPanSrc = src;

  if (isSpread) {
    startCinemaPan();
  }
}

export function startCinemaPan() {
  const image = global.fullscreenImage;
  if (!image || isCinemaPanning) return false;

  const naturalW = image.naturalWidth || 0;
  const naturalH = image.naturalHeight || 0;
  if (!naturalW || !naturalH || (naturalW / naturalH < 1.2)) return false;

  const viewer = global.fullscreenViewer;
  const vh = (viewer ? viewer.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 900)) || 900;
  const vw = (viewer ? viewer.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 1200)) || 1200;
  const scaledWidth = (naturalW / naturalH) * vh;
  const overflowX = Math.max(0, scaledWidth - vw);

  if (overflowX < 15) return false;

  const isManga = !!(
    (global.currentComic && (global.currentComic.mangaMode === true || global.currentComic.mangaMode == 1 || global.currentComic.mangaMode === '1')) ||
    document.getElementById('fullscreen-manga-mode-btn')?.classList.contains('active') ||
    document.getElementById('manga-mode-btn')?.classList.contains('active')
  );

  const startX = isManga ? -overflowX : 0;
  const targetX = isManga ? 0 : -overflowX;
  const duration = Math.max(3800, Math.min(5500, 3200 + overflowX * 1.5)); // ms

  if (viewer) {
    viewer.classList.add('cinema-stage');
  }
  image.classList.add('cinema-img');
  image.style.willChange = 'transform';
  image.style.transform = `translate3d(${startX}px, 0, 0)`;

  const badge = document.getElementById('fullscreen-spread-badge');
  if (badge) {
    badge.classList.add('hidden');
  }

  isCinemaPanning = true;
  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const reqRaf = (typeof window !== 'undefined' && window.requestAnimationFrame) || (typeof globalThis !== 'undefined' && globalThis.requestAnimationFrame);

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function step(now) {
    if (!isCinemaPanning) return;
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeInOutQuad(progress);
    const currentX = startX + (targetX - startX) * eased;

    image.style.transform = `translate3d(${currentX}px, 0, 0)`;

    if (progress < 1) {
      if (typeof reqRaf === 'function') {
        cinemaPanRAF = reqRaf(step);
      }
    } else {
      image.style.transform = `translate3d(${targetX}px, 0, 0)`;
      cinemaPanEndTimeout = setTimeout(() => {
        stopCinemaPan();
      }, 450);
    }
  }

  if (typeof reqRaf === 'function') {
    cinemaPanRAF = reqRaf(step);
  }
  return true;
}

export function toggleCinemaPan() {
  if (isCinemaPanning) {
    stopCinemaPan();
    return;
  }

  if (startCinemaPan()) return;

  const image = global.fullscreenImage;
  if (!image) return;

  const naturalW = image.naturalWidth || 0;
  const naturalH = image.naturalHeight || 0;
  const isSpread = naturalW > 0 && naturalH > 0 && (naturalW / naturalH >= 1.2);
  if (!isSpread) return;

  const badgeText = document.getElementById('fullscreen-spread-badge-text');
  if (badgeText) {
    badgeText.textContent = 'Page Fits Screen';
    setTimeout(() => {
      badgeText.textContent = 'Cinema Pan Spread';
    }, 1500);
  }
}

export function handlePageStatusForCinema(currentPage) {
  const pageChanged = lastFullscreenStatusPage !== currentPage;
  lastFullscreenStatusPage = currentPage;
  if (isCinemaPanning && pageChanged) {
    stopCinemaPan();
  }
}

global.toggleCinemaPan = toggleCinemaPan;
global.stopCinemaPan = stopCinemaPan;
global.checkSpreadCinemaStatus = checkSpreadCinemaStatus;
