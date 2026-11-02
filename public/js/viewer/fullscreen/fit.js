import { state, global as canonicalGlobal } from '../../globals.js';
import { applyLandscapeTransform } from './landscape-pan.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

export function showFullscreenPageJumpInput() {
  const counter = global.fullscreenPageCounter;
  const input = global.fullscreenPageJumpInput;
  if (!counter || !input) return;

  counter.classList.add('hidden');
  input.classList.remove('hidden');
  input.value = '';

  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

export function hideFullscreenPageJumpInput() {
  const counter = global.fullscreenPageCounter;
  const input = global.fullscreenPageJumpInput;
  if (!counter || !input) return;

  input.classList.add('hidden');
  counter.classList.remove('hidden');
}

export function commitFullscreenPageJump() {
  const input = global.fullscreenPageJumpInput;
  if (!input) return;

  const pages = global.getViewerPages?.() || [];
  const totalPages = pages.length;

  const targetPage = parseInt(input.value, 10);
  if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
    hideFullscreenPageJumpInput();
    return;
  }

  const targetIndex = targetPage - 1;
  global.currentPageIndex = targetIndex;
  hideFullscreenPageJumpInput();

  if (global.isContinuousMode) {
    const continuousContainer = document.getElementById('fullscreen-pages-continuous');
    if (continuousContainer) {
      const targetContainer = continuousContainer.querySelector(
        `.page-container[data-index="${targetIndex}"]`
      );
      if (targetContainer) {
        const isEink = (typeof document !== 'undefined' && document.body && (
          document.body.classList.contains('eink-mode') || document.body.classList.contains('eink-color-mode')
        )) || (global.einkMode && global.einkMode !== 'none');
        targetContainer.scrollIntoView({ behavior: isEink ? 'instant' : 'smooth', block: 'center' });
        if (isEink && typeof global.triggerEinkFlash === 'function') {
          global.triggerEinkFlash();
        }
      }
    }
  } else {
    if (typeof global.renderPage === 'function') {
      global.renderPage();
    }
  }
}

export function updateFullscreenViewerCentering() {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  const imageRect = image.getBoundingClientRect();
  const viewerRect = viewer.getBoundingClientRect();

  const needsHorizontalCentering = imageRect.width <= viewerRect.width;
  const needsVerticalCentering = imageRect.height <= viewerRect.height;

  if (needsHorizontalCentering && needsVerticalCentering) {
    viewer.style.display = 'flex';
    viewer.style.alignItems = 'center';
    viewer.style.justifyContent = 'center';
    image.style.margin = 'auto';
  } else {
    viewer.style.display = 'block';
    viewer.style.alignItems = '';
    viewer.style.justifyContent = '';
    image.style.marginLeft = needsHorizontalCentering ? 'auto' : '0';
    image.style.marginRight = needsHorizontalCentering ? 'auto' : '0';
    image.style.marginTop = needsVerticalCentering ? 'auto' : '0';
    image.style.marginBottom = needsVerticalCentering ? 'auto' : '0';
  }
}

export function applyFullscreenFitMode() {
  const viewer = global.fullscreenViewer;
  const image = global.fullscreenImage;
  if (!viewer || !image) return;

  if (global.isFullImageMode && typeof global.applyFullImageLayout === 'function') {
    global.applyFullImageLayout();
    return;
  }

  if (global.isFullscreenZoomed) {
    updateFullscreenViewerCentering();
    return;
  }

  viewer.classList.add('fullscreen-fit-mode');

  if (global.isFitToHeight) {
    image.style.width = 'auto';
    image.style.height = '100vh';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '100vh';
  } else {
    image.style.width = '100%';
    image.style.height = 'auto';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '100%';
  }
  image.style.cursor = 'default';
  image.style.touchAction = 'manipulation';
  if (global.isLandscapeOrientation) {
    applyLandscapeTransform();
    image.style.cursor = 'grab';
    image.style.touchAction = 'none';
  }
  updateFullscreenViewerCentering();
}

global.showFullscreenPageJumpInput = showFullscreenPageJumpInput;
global.hideFullscreenPageJumpInput = hideFullscreenPageJumpInput;
global.commitFullscreenPageJump = commitFullscreenPageJump;
global.updateFullscreenViewerCentering = updateFullscreenViewerCentering;
global.applyFullscreenFitMode = applyFullscreenFitMode;
