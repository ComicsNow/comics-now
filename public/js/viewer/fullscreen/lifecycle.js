import { state, global as canonicalGlobal } from '../../globals.js';
import { syncFullscreenTitle, hideFullscreenControls, setupControlsAutohide } from './controls.js';
import { showFullscreenPageJumpInput, hideFullscreenPageJumpInput, commitFullscreenPageJump } from './fit.js';
import { stopCinemaPan, checkSpreadCinemaStatus, toggleCinemaPan, resetCinemaStatus, handlePageStatusForCinema } from './cinema-pan.js';
import { cleanupPanPointer } from './zoom-pan.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export function openFullscreen() {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  const currentImage = document.querySelector('.viewer-image');
  if (currentImage && currentImage.src && currentImage.src !== '') {
    image.removeAttribute('crossorigin');
    image.src = currentImage.src;
  }

  viewer.classList.remove('hidden');
  viewer.style.display = '';
  const totalPages = typeof global.getPageCounterTotal === 'function' ? global.getPageCounterTotal() : 0;
  updateFullscreenPageStatus(global.currentPageIndex + 1, totalPages);

  syncFullscreenTitle();
  if (global.fullscreenTitle) {
    global.fullscreenTitle.classList.remove('hidden');
  }
  if (global.fullscreenCloseBtn) {
    global.fullscreenCloseBtn.classList.remove('hidden');
  }

  if (global.currentComic?.continuousMode) {
    state.isContinuousMode = true;
    global.isContinuousMode = true;
    if (typeof global.enableContinuousMode === 'function') {
      global.enableContinuousMode();
    }
  }

  hideFullscreenControls();

  if (!global.isContinuousMode && (!image.src || image.src === '')) {
    if (typeof global.renderPage === 'function') {
      global.renderPage().catch((err) => {
        console.error('[openFullscreen] Error calling renderPage:', err);
      });
    }
  }

  const refreshToggle = global.refreshGuidedToggle || state.refreshGuidedToggle || (typeof window !== 'undefined' && window.refreshGuidedToggle);
  if (typeof refreshToggle === 'function') {
    try {
      const p = refreshToggle();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.error('[openFullscreen] Error calling refreshGuidedToggle:', err);
        });
      }
    } catch (err) {
      console.error('[openFullscreen] Error calling refreshGuidedToggle:', err);
    }
  }
}

export async function closeFullscreen() {
  if (typeof resetCinemaStatus === 'function') resetCinemaStatus();

  const viewer = global.fullscreenViewer;
  if (viewer) {
    viewer.classList.add('hidden');
    viewer.style.display = 'none';
  }
  
  hideFullscreenControls();
  if (typeof stopCinemaPan === 'function') stopCinemaPan();
  try {
    global.closeFilmstrip?.();
  } catch (e) {}

  try {
    if (global.GuidedView && typeof global.GuidedView.disableAll === 'function') {
      global.GuidedView.disableAll({ persist: false });
    }
  } catch (e) {
    console.error('[closeFullscreen] GuidedView cleanup failed:', e);
  }

  try {
    if (global.isContinuousMode && typeof global.disableContinuousMode === 'function') {
      global.disableContinuousMode().catch(() => {});
    }
  } catch (e) {}

  const image = global.fullscreenImage;
  if (typeof cleanupPanPointer === 'function') cleanupPanPointer(image);
  
  try {
    if (typeof global.resetFullscreenZoom === 'function') {
      global.resetFullscreenZoom();
    }
  } catch (e) {}

  if (document.fullscreenElement === viewer && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }

  if (typeof global.renderPage === 'function') {
    global.renderPage().catch(() => {});
  }
}

export function updateFullscreenPageStatus(currentPage, totalPages) {
  if (typeof handlePageStatusForCinema === 'function') {
    handlePageStatusForCinema(currentPage);
  }

  const progressIndicator = global.fullscreenProgressIndicator;
  const pageCounter = global.fullscreenPageCounter;

  if (!progressIndicator || !pageCounter) {
    return;
  }

  if (!totalPages || totalPages <= 0) {
    progressIndicator.textContent = '0% read';
    pageCounter.textContent = '-- / --';
    return;
  }

  const pageText = `${currentPage} / ${totalPages}`;
  const progressPercent = Math.round((currentPage / totalPages) * 100);
  progressIndicator.textContent = `${progressPercent}% read`;
  pageCounter.textContent = pageText;
  if (typeof checkSpreadCinemaStatus === 'function') {
    checkSpreadCinemaStatus({ autoPan: true });
  }

  try {
    global.updateReaderScrubberStatus?.(currentPage, totalPages);
  } catch (e) {}
}

export function initFullscreenNavigation() {
  if (global.fullscreenPrevPageBtn && !global.fullscreenPrevPageBtn._navListener) {
    global.fullscreenPrevPageBtn._navListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof global.navigatePage === 'function') {
        const dir = global.getNavigationDirection ? global.getNavigationDirection(-1) : -1;
        global.navigatePage(dir);
      }
    };
    global.fullscreenPrevPageBtn.addEventListener('click', global.fullscreenPrevPageBtn._navListener);
  }

  if (global.fullscreenNextPageBtn && !global.fullscreenNextPageBtn._navListener) {
    global.fullscreenNextPageBtn._navListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof global.navigatePage === 'function') {
        const dir = global.getNavigationDirection ? global.getNavigationDirection(1) : 1;
        global.navigatePage(dir);
      }
    };
    global.fullscreenNextPageBtn.addEventListener('click', global.fullscreenNextPageBtn._navListener);
  }

  if (global.fullscreenPageCounter && !global.fullscreenPageCounter._jumpListener) {
    global.fullscreenPageCounter._jumpListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      showFullscreenPageJumpInput();
    };
    global.fullscreenPageCounter.addEventListener('click', global.fullscreenPageCounter._jumpListener);
  }

  if (global.fullscreenPageJumpInput && !global.fullscreenPageJumpInput._submitListener) {
    global.fullscreenPageJumpInput._submitListener = (event) => {
      if (event.type === 'keydown' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      commitFullscreenPageJump();
    };
    global.fullscreenPageJumpInput.addEventListener('keydown', global.fullscreenPageJumpInput._submitListener);
    global.fullscreenPageJumpInput.addEventListener('blur', () => {
      hideFullscreenPageJumpInput();
    });
  }

  const spreadBadge = document.getElementById('fullscreen-spread-badge');
  if (spreadBadge && !spreadBadge._cinemaListener) {
    spreadBadge._cinemaListener = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCinemaPan();
    };
    spreadBadge.addEventListener('click', spreadBadge._cinemaListener);
  }

  setupControlsAutohide(global.fullscreenControls);
}

global.openFullscreen = openFullscreen;
global.closeFullscreen = closeFullscreen;
global.updateFullscreenPageStatus = updateFullscreenPageStatus;
global.initFullscreenNavigation = initFullscreenNavigation;
