import { state, encodePath } from '../globals.js';

// The overlay is built on open and removed on close, so nothing full-screen
// lingers in the DOM to intercept scrolling/pointer events while it's closed.
let lastActiveTrigger = null;
let thumbObserver = null;
let escHandlerBound = false;

const SPEECH_ICON = '⊞';

/**
 * Thumbnail URL for a page: small w=220 WebP for server comics (rides the WebP
 * transcode + disk cache), or a local object URL for offline/device comics.
 */
async function getThumbnailUrl(comic, pageName, globalState) {
  if (!comic || !pageName) return '';

  const isOffline = comic.isOffline || !!comic.file || !!comic.handle ||
    (globalState.downloadedComicIds && globalState.downloadedComicIds.has(comic.id));

  if (isOffline && typeof globalState.getPageUrl === 'function') {
    try {
      const offlineUrl = await globalState.getPageUrl(pageName);
      if (offlineUrl) return offlineUrl;
    } catch (e) {
      console.warn('[PAGE-PREVIEWS] Failed to get offline URL for thumbnail:', e);
    }
  }

  const pathStr = comic.path || '';
  const encoded = typeof globalState.encodePath === 'function'
    ? globalState.encodePath(pathStr)
    : (typeof encodePath === 'function' ? encodePath(pathStr) : btoa(encodeURIComponent(pathStr)));
  const apiBase = globalState.API_BASE_URL || '';
  return `${apiBase}/api/v1/comics/pages/image?path=${encodeURIComponent(encoded)}&page=${encodeURIComponent(pageName)}&w=220`;
}

export function isPagePreviewGridOpen() {
  return !!document.getElementById('comic-page-grid-overlay');
}

/**
 * Jump the viewer to a page and persist progress (offline-aware, matching
 * ui-page-jump.js behaviour).
 */
export async function goToPage(targetIndex) {
  const global = state;
  const pages = global.getViewerPages?.() || [];
  if (!pages.length) return false;

  const clampedIndex = Math.max(0, Math.min(targetIndex, pages.length - 1));
  const previousIndex = global.currentPageIndex;
  global.currentPageIndex = clampedIndex;

  try {
    const comic = global.currentComic;
    if (comic) {
      const isDownloaded = !!global.downloadedComicIds?.has(comic.id);
      if (isDownloaded) {
        try {
          global.saveProgressToDB?.(comic.id, global.currentPageIndex, comic.progress?.totalPages, comic.path);
        } catch (e) {}
        if (!comic.progress) comic.progress = { totalPages: 0, lastReadPage: 0 };
        comic.progress.lastReadPage = global.currentPageIndex;
        global.updateLibraryProgress?.(comic.id, global.currentPageIndex, comic.progress.totalPages);
        if (typeof navigator !== 'undefined' && navigator.onLine && typeof global.saveProgress === 'function') {
          global.saveProgress(global.currentPageIndex);
        }
      } else {
        try {
          global.saveProgress?.(global.currentPageIndex);
          global.updateLibraryProgress?.(comic.id, global.currentPageIndex, comic.progress?.totalPages);
        } catch (e) {}
      }
    }

    const rendered = await global.renderPage?.();
    if (rendered === false) { global.currentPageIndex = previousIndex; return false; }
    return true;
  } catch (err) {
    global.currentPageIndex = previousIndex;
    return false;
  }
}

export async function selectPreviewPage(index) {
  closePagePreviewGrid();
  await goToPage(index);
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'comic-page-grid-overlay';
  overlay.className = 'comic-page-grid-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Comic Pages Grid');
  overlay.innerHTML = `
    <div id="comic-page-grid-backdrop" class="comic-page-grid-backdrop"></div>
    <div class="comic-page-grid-modal">
      <div class="comic-page-grid-header">
        <div class="comic-page-grid-title-group">
          <span class="comic-page-grid-icon" aria-hidden="true">${SPEECH_ICON}</span>
          <span id="comic-page-grid-title" class="comic-page-grid-title">Comic Pages</span>
          <span id="comic-page-grid-count" class="comic-page-grid-count">0 Pages</span>
        </div>
        <button id="comic-page-grid-close" type="button" class="comic-page-grid-close" aria-label="Close page previews">&times;</button>
      </div>
      <div id="comic-page-grid-scroll" class="comic-page-grid-scroll">
        <div id="comic-page-grid-items" class="comic-page-grid-items"></div>
      </div>
    </div>`;

  overlay.querySelector('#comic-page-grid-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closePagePreviewGrid();
  });
  overlay.querySelector('#comic-page-grid-backdrop').addEventListener('click', (e) => {
    e.stopPropagation();
    closePagePreviewGrid();
  });
  return overlay;
}

function ensureEscHandler() {
  if (escHandlerBound) return;
  escHandlerBound = true;
  // Capture phase so Escape closes the grid before the fullscreen reader reacts.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPagePreviewGridOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      closePagePreviewGrid();
    }
  }, true);
}

export async function openPagePreviewGrid(triggerElement = null) {
  const global = state;
  if (isPagePreviewGridOpen()) return;
  ensureEscHandler();

  // Mount in the fullscreen element's top-layer when fullscreen is active, else body.
  const fsViewer = document.getElementById('fullscreen-viewer');
  const isFsActive = (fsViewer && !fsViewer.classList.contains('hidden')) || !!document.fullscreenElement;
  const mount = (isFsActive && fsViewer) ? fsViewer : document.body;

  const overlay = buildOverlay();
  mount.appendChild(overlay);

  lastActiveTrigger = triggerElement || document.activeElement;

  const gridItems = overlay.querySelector('#comic-page-grid-items');
  const scrollEl = overlay.querySelector('#comic-page-grid-scroll');
  const countSpan = overlay.querySelector('#comic-page-grid-count');
  const titleSpan = overlay.querySelector('#comic-page-grid-title');

  const pages = global.getViewerPages?.() || [];
  const currentIndex = typeof global.currentPageIndex === 'number' ? global.currentPageIndex : 0;
  const comic = global.currentComic;

  if (titleSpan && comic) titleSpan.textContent = comic.series || comic.title || 'Comic Pages';
  if (countSpan) countSpan.textContent = `${pages.length} Page${pages.length === 1 ? '' : 's'}`;

  const IO = (typeof IntersectionObserver !== 'undefined') ? IntersectionObserver : null;
  if (IO) {
    thumbObserver = new IO((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target._loadThumb?.();
          thumbObserver.unobserve(entry.target);
        }
      }
    }, { root: scrollEl || null, rootMargin: '250px' });
  }

  let activeCard = null;

  for (let i = 0; i < pages.length; i++) {
    const pageName = pages[i];
    const pageNumber = i + 1;
    const isActive = (i === currentIndex);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `comic-page-preview-card ${isActive ? 'active-page-card' : ''}`.trim();
    card.setAttribute('data-page-index', String(i));
    card.setAttribute('aria-label', `Page ${pageNumber}${isActive ? ' (current)' : ''}`);

    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'comic-page-preview-thumb-wrap';

    const img = document.createElement('img');
    img.alt = `Page ${pageNumber}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'comic-page-preview-img';

    img._loadThumb = () => {
      if (img._thumbRequested) return;
      img._thumbRequested = true;
      getThumbnailUrl(comic, pageName, global).then((url) => { if (url) img.src = url; });
    };

    imgWrapper.appendChild(img);

    const label = document.createElement('div');
    label.className = 'comic-page-preview-number';
    label.textContent = String(pageNumber);

    card.appendChild(imgWrapper);
    card.appendChild(label);
    card.addEventListener('click', () => selectPreviewPage(i));

    gridItems.appendChild(card);
    if (isActive) activeCard = card;

    if (thumbObserver) thumbObserver.observe(img);
    else img._loadThumb();
  }

  if (activeCard && typeof activeCard.scrollIntoView === 'function') {
    try { activeCard.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    catch (e) { activeCard.scrollIntoView(); }
  }

  overlay.querySelector('#comic-page-grid-close')?.focus?.();
}

export function closePagePreviewGrid() {
  if (thumbObserver) {
    try { thumbObserver.disconnect(); } catch (e) {}
    thumbObserver = null;
  }
  const overlay = document.getElementById('comic-page-grid-overlay');
  if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);

  if (lastActiveTrigger && typeof lastActiveTrigger.focus === 'function') {
    try { lastActiveTrigger.focus(); } catch (e) {}
  }
}

export function initPagePreviews() {
  ensureEscHandler();

  const triggerButtons = [
    document.getElementById('page-grid-btn'),
    document.getElementById('page-grid-btn-bottom'),
    document.getElementById('viewer-page-grid-top-btn'),
    document.getElementById('fullscreen-page-grid-btn')
  ];
  triggerButtons.forEach((btn) => {
    if (btn && !btn._previewTriggerBound) {
      btn._previewTriggerBound = true;
      btn.addEventListener('click', (e) => { e.preventDefault(); openPagePreviewGrid(btn); });
    }
  });
}

if (typeof state !== 'undefined') {
  state.openPagePreviewGrid = openPagePreviewGrid;
  state.closePagePreviewGrid = closePagePreviewGrid;
  state.selectPreviewPage = selectPreviewPage;
  state.isPagePreviewGridOpen = isPagePreviewGridOpen;
  state.goToPage = goToPage;
  state.initPagePreviews = initPagePreviews;
}
if (typeof window !== 'undefined') {
  window.openPagePreviewGrid = openPagePreviewGrid;
  window.closePagePreviewGrid = closePagePreviewGrid;
  window.selectPreviewPage = selectPreviewPage;
  window.isPagePreviewGridOpen = isPagePreviewGridOpen;
  window.goToPage = goToPage;
  window.initPagePreviews = initPagePreviews;
}
