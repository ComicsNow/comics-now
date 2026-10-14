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
  // Capture phase so Escape closes the grid or filmstrip before the fullscreen reader reacts.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (isPagePreviewGridOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closePagePreviewGrid();
      } else if (isFilmstripOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        closeFilmstrip();
      }
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

/* ==========================================================================
   Reader Scrubber Bar & Thumbnail Popover
   ========================================================================== */
let scrubberBound = false;
let isScrubbing = false;
let scrubberHideTimeout = null;
let scrubberThumbRequestSeq = 0;

async function updateScrubberPreviewThumb(pageIndex) {
  const currentSeq = ++scrubberThumbRequestSeq;
  const global = state;
  const pages = global.getViewerPages?.() || [];
  if (pageIndex < 0 || pageIndex >= pages.length) return;
  const pageName = pages[pageIndex];
  const comic = global.currentComic;

  const previewSpread = document.getElementById('reader-scrubber-preview-spread');
  if (previewSpread) {
    const isSpread = global.isSpreadPage?.(pageIndex) || (global.spreadPages && global.spreadPages.has?.(pageIndex));
    if (isSpread) {
      previewSpread.classList.remove('hidden');
    } else {
      previewSpread.classList.add('hidden');
    }
  }

  const previewImg = document.getElementById('reader-scrubber-preview-img');
  try {
    const url = await getThumbnailUrl(comic, pageName, global);
    if (currentSeq === scrubberThumbRequestSeq && previewImg && url) {
      previewImg.src = url;
    }
  } catch (e) {}
}

export function initReaderScrubber() {
  const slider = document.getElementById('fullscreen-scrubber-slider');
  const trackFill = document.getElementById('fullscreen-scrubber-track-fill');
  const currentNum = document.getElementById('fullscreen-scrubber-current-page');
  const preview = document.getElementById('reader-scrubber-preview');
  const previewPageText = document.getElementById('reader-scrubber-preview-page-text');

  if (!slider || scrubberBound) return;
  scrubberBound = true;

  function updatePreviewPosition(targetPage, pct, clientX = null) {
    if (!preview) return;
    const rect = (typeof slider.getBoundingClientRect === 'function')
      ? slider.getBoundingClientRect()
      : { left: 0, right: 300, width: 300 };
    const sliderWidth = rect.width > 0 ? rect.width : 300;
    const thumbX = (clientX !== null)
      ? clientX
      : (rect.left + pct * sliderWidth);

    preview.style.left = `${thumbX}px`;
    preview.classList.remove('hidden');

    if (previewPageText) {
      previewPageText.textContent = `Page ${targetPage}`;
    }

    updateScrubberPreviewThumb(targetPage - 1);
  }

  slider.addEventListener('input', () => {
    isScrubbing = true;
    clearTimeout(scrubberHideTimeout);
    const val = parseInt(slider.value, 10) || 1;
    const max = parseInt(slider.max, 10) || 1;
    const pct = max > 1 ? (val - 1) / (max - 1) : 0;

    if (currentNum) currentNum.textContent = String(val);
    if (trackFill) trackFill.style.width = `${pct * 100}%`;

    updatePreviewPosition(val, pct);
  });

  slider.addEventListener('change', async () => {
    isScrubbing = false;
    const val = parseInt(slider.value, 10) || 1;
    await goToPage(val - 1);
    scrubberHideTimeout = setTimeout(() => {
      if (!isScrubbing && preview) preview.classList.add('hidden');
    }, 350);
  });

  slider.addEventListener('pointerdown', () => {
    isScrubbing = true;
    clearTimeout(scrubberHideTimeout);
  });

  slider.addEventListener('pointerup', () => {
    isScrubbing = false;
    scrubberHideTimeout = setTimeout(() => {
      if (!isScrubbing && preview) preview.classList.add('hidden');
    }, 400);
  });

  slider.addEventListener('pointercancel', () => {
    isScrubbing = false;
    if (preview) preview.classList.add('hidden');
  });

  slider.addEventListener('pointermove', (e) => {
    if (isScrubbing) return;
    const rect = (typeof slider.getBoundingClientRect === 'function')
      ? slider.getBoundingClientRect()
      : { left: 0, right: 300, width: 300 };
    const sliderWidth = rect.width > 0 ? rect.width : 300;
    const max = parseInt(slider.max, 10) || 1;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / sliderWidth));
    const targetPage = Math.round(ratio * (max - 1)) + 1;
    const targetPct = max > 1 ? (targetPage - 1) / (max - 1) : 0;

    clearTimeout(scrubberHideTimeout);
    updatePreviewPosition(targetPage, targetPct, e.clientX);
  });

  slider.addEventListener('pointerleave', () => {
    if (!isScrubbing && preview) {
      preview.classList.add('hidden');
    }
  });
}

export function updateReaderScrubberStatus(currentPage, totalPages) {
  const slider = document.getElementById('fullscreen-scrubber-slider');
  const trackFill = document.getElementById('fullscreen-scrubber-track-fill');
  const currentNum = document.getElementById('fullscreen-scrubber-current-page');
  const totalNum = document.getElementById('fullscreen-scrubber-total-pages');

  const cur = Math.max(1, currentPage || 1);
  const tot = Math.max(1, totalPages || 1);

  if (slider) {
    slider.min = '1';
    slider.max = String(tot);
    slider.value = String(cur);
  }
  if (currentNum) currentNum.textContent = String(cur);
  if (totalNum) totalNum.textContent = String(tot);
  if (trackFill) {
    const pct = tot > 1 ? ((cur - 1) / (tot - 1)) * 100 : 0;
    trackFill.style.width = `${pct}%`;
  }

  updateFilmstripActiveCard(cur - 1, tot);
}

/* ==========================================================================
   Reader Thumbnail Filmstrip Drawer (Horizontal skimmable thumbnails)
   ========================================================================== */
let filmstripObserver = null;
let lastRenderedComicId = null;
let lastRenderedPageCount = 0;

export function updateFilmstripActiveCard(currentIndex, totalPages) {
  const itemsContainer = document.getElementById('reader-filmstrip-items');
  const indicator = document.getElementById('reader-filmstrip-page-indicator');
  if (indicator && typeof currentIndex === 'number') {
    indicator.textContent = `Page ${currentIndex + 1} of ${totalPages || 1}`;
  }
  if (!itemsContainer) return;

  let activeCard = null;
  const cards = itemsContainer.querySelectorAll('.comic-filmstrip-card');
  cards.forEach((card) => {
    const cardIdx = parseInt(card.getAttribute('data-page-index'), 10);
    if (cardIdx === currentIndex) {
      card.classList.add('active-filmstrip-card');
      card.setAttribute('aria-label', `Page ${cardIdx + 1} (current)`);
      activeCard = card;
    } else {
      card.classList.remove('active-filmstrip-card');
      card.setAttribute('aria-label', `Page ${cardIdx + 1}`);
    }
  });

  if (activeCard && typeof activeCard.scrollIntoView === 'function') {
    try {
      activeCard.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      try { activeCard.scrollIntoView(); } catch (err) {}
    }
  }
}

export function renderThumbnailFilmstrip() {
  const global = state;
  const itemsContainer = document.getElementById('reader-filmstrip-items');
  const scrollEl = document.getElementById('reader-filmstrip-scroll');
  const indicator = document.getElementById('reader-filmstrip-page-indicator');
  if (!itemsContainer) return;

  const pages = global.getViewerPages?.() || [];
  const comic = global.currentComic;
  const comicId = comic?.id || comic?.path || 'unknown';
  const currentIndex = typeof global.currentPageIndex === 'number' ? global.currentPageIndex : 0;

  if (indicator) {
    indicator.textContent = `Page ${currentIndex + 1} of ${pages.length || 1}`;
  }

  if (lastRenderedComicId === comicId && lastRenderedPageCount === pages.length && itemsContainer.children.length === pages.length) {
    updateFilmstripActiveCard(currentIndex, pages.length);
    return;
  }

  if (filmstripObserver) {
    try { filmstripObserver.disconnect(); } catch (e) {}
    filmstripObserver = null;
  }

  itemsContainer.innerHTML = '';
  lastRenderedComicId = comicId;
  lastRenderedPageCount = pages.length;

  const IO = (typeof IntersectionObserver !== 'undefined') ? IntersectionObserver : null;
  if (IO) {
    filmstripObserver = new IO((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target._loadThumb?.();
          filmstripObserver.unobserve(entry.target);
        }
      }
    }, { root: scrollEl || null, rootMargin: '300px' });
  }

  for (let i = 0; i < pages.length; i++) {
    const pageName = pages[i];
    const pageNumber = i + 1;
    const isActive = (i === currentIndex);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `comic-filmstrip-card ${isActive ? 'active-filmstrip-card' : ''}`.trim();
    card.setAttribute('data-page-index', String(i));
    card.setAttribute('aria-label', `Page ${pageNumber}${isActive ? ' (current)' : ''}`);

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'comic-filmstrip-thumb-wrap';

    const img = document.createElement('img');
    img.alt = `Page ${pageNumber}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.className = 'comic-filmstrip-img';

    img._loadThumb = () => {
      if (img._thumbRequested) return;
      img._thumbRequested = true;
      getThumbnailUrl(comic, pageName, global).then((url) => { if (url) img.src = url; });
    };

    thumbWrap.appendChild(img);

    const label = document.createElement('div');
    label.className = 'comic-filmstrip-number';
    label.textContent = String(pageNumber);

    card.appendChild(thumbWrap);
    card.appendChild(label);

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      goToPage(i);
      updateFilmstripActiveCard(i, pages.length);
    });

    itemsContainer.appendChild(card);

    if (filmstripObserver) filmstripObserver.observe(img);
    else img._loadThumb();
  }

  updateFilmstripActiveCard(currentIndex, pages.length);
}

export function isFilmstripOpen() {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  return !!(el && !el.classList.contains('hidden'));
}

export function openFilmstrip(triggerEl = null) {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  if (!el) return;
  el.classList.remove('hidden');

  const buttons = [
    document.getElementById('fullscreen-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn-bottom')
  ];
  buttons.forEach((btn) => {
    if (btn) btn.setAttribute('aria-pressed', 'true');
  });

  renderThumbnailFilmstrip();
}

export function closeFilmstrip() {
  const el = document.getElementById('reader-thumbnail-filmstrip');
  if (el) el.classList.add('hidden');

  const buttons = [
    document.getElementById('fullscreen-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn-bottom')
  ];
  buttons.forEach((btn) => {
    if (btn) btn.setAttribute('aria-pressed', 'false');
  });
}

export function toggleFilmstrip(triggerEl = null) {
  if (isFilmstripOpen()) {
    closeFilmstrip();
  } else {
    openFilmstrip(triggerEl);
  }
}

function initReaderFilmstrip() {
  const filmstripBtns = [
    document.getElementById('fullscreen-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn'),
    document.getElementById('page-filmstrip-btn-bottom')
  ];
  filmstripBtns.forEach((btn) => {
    if (btn && !btn._filmstripBound) {
      btn._filmstripBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFilmstrip(btn);
      });
    }
  });

  const gridBtn = document.getElementById('reader-filmstrip-grid-btn');
  if (gridBtn && !gridBtn._gridBound) {
    gridBtn._gridBound = true;
    gridBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPagePreviewGrid(gridBtn);
    });
  }

  const closeBtn = document.getElementById('reader-filmstrip-close-btn');
  if (closeBtn && !closeBtn._closeBound) {
    closeBtn._closeBound = true;
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeFilmstrip();
    });
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

  initReaderScrubber();
  initReaderFilmstrip();
}

if (typeof state !== 'undefined') {
  state.openPagePreviewGrid = openPagePreviewGrid;
  state.closePagePreviewGrid = closePagePreviewGrid;
  state.selectPreviewPage = selectPreviewPage;
  state.isPagePreviewGridOpen = isPagePreviewGridOpen;
  state.goToPage = goToPage;
  state.initPagePreviews = initPagePreviews;
  state.initReaderScrubber = initReaderScrubber;
  state.updateReaderScrubberStatus = updateReaderScrubberStatus;
  state.openFilmstrip = openFilmstrip;
  state.closeFilmstrip = closeFilmstrip;
  state.toggleFilmstrip = toggleFilmstrip;
  state.isFilmstripOpen = isFilmstripOpen;
  state.renderThumbnailFilmstrip = renderThumbnailFilmstrip;
  state.updateFilmstripActiveCard = updateFilmstripActiveCard;
}
if (typeof window !== 'undefined') {
  window.openPagePreviewGrid = openPagePreviewGrid;
  window.closePagePreviewGrid = closePagePreviewGrid;
  window.selectPreviewPage = selectPreviewPage;
  window.isPagePreviewGridOpen = isPagePreviewGridOpen;
  window.goToPage = goToPage;
  window.initPagePreviews = initPagePreviews;
  window.initReaderScrubber = initReaderScrubber;
  window.updateReaderScrubberStatus = updateReaderScrubberStatus;
  window.openFilmstrip = openFilmstrip;
  window.closeFilmstrip = closeFilmstrip;
  window.toggleFilmstrip = toggleFilmstrip;
  window.isFilmstripOpen = isFilmstripOpen;
  window.renderThumbnailFilmstrip = renderThumbnailFilmstrip;
  window.updateFilmstripActiveCard = updateFilmstripActiveCard;
}
