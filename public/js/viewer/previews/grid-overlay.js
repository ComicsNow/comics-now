import { state, clearElement, escapeHtml } from '../../globals.js';
import { html, render } from '../../ui/template.js';
import { getThumbnailUrl, goToPage } from './thumbnail-url.js';

const SPEECH_ICON = '⊞';
let lastActiveTrigger = null;
let thumbObserver = null;

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  const toStr = (c) => {
    if (c === null || c === undefined) return '';
    if (Array.isArray(c)) return c.map(toStr).join('');
    if (typeof c === 'object' && typeof c.toHTML === 'function') return c.toHTML();
    if (typeof c === 'object' && c.__isRawHtml) return c.html;
    return String(c);
  };
  el.innerHTML = toStr(content);
};
const safeHtml = (typeof html !== 'undefined' && typeof html === 'function' && html.length > 0) ? html : (strings, ...values) => {
  const formatVal = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(formatVal).join('');
    if (typeof v === 'object' && v.__isRawHtml) return v.html;
    if (typeof v === 'object' && typeof v.toHTML === 'function') return v.toHTML();
    return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v);
  };
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) {
      out += formatVal(values[i]);
    }
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

function isPagePreviewGridOpen() {
  return !!document.getElementById('comic-page-grid-overlay');
}

async function selectPreviewPage(index) {
  closePagePreviewGrid();
  const goTo = typeof goToPage === 'function' ? goToPage : (typeof state !== 'undefined' ? state.goToPage : (typeof window !== 'undefined' ? window.goToPage : null));
  if (typeof goTo === 'function') {
    await goTo(index);
  }
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'comic-page-grid-overlay';
  overlay.className = 'comic-page-grid-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Comic Pages Grid');
  renderContent(overlay, safeHtml`
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
    </div>`);

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

async function openPagePreviewGrid(triggerElement = null) {
  const global = typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? window.state : {});
  if (isPagePreviewGridOpen()) return;
  if (typeof global.ensureEscHandler === 'function') {
    global.ensureEscHandler();
  }

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
  const getThumb = typeof getThumbnailUrl === 'function' ? getThumbnailUrl : (global.getThumbnailUrl || (typeof window !== 'undefined' ? window.getThumbnailUrl : null));

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
      if (typeof getThumb === 'function') {
        getThumb(comic, pageName, global).then((url) => { if (url) img.src = url; });
      }
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

function closePagePreviewGrid() {
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

if (typeof state !== 'undefined') {
  state.isPagePreviewGridOpen = isPagePreviewGridOpen;
  state.selectPreviewPage = selectPreviewPage;
  state.buildOverlay = buildOverlay;
  state.openPagePreviewGrid = openPagePreviewGrid;
  state.closePagePreviewGrid = closePagePreviewGrid;
}
if (typeof window !== 'undefined') {
  window.isPagePreviewGridOpen = isPagePreviewGridOpen;
  window.selectPreviewPage = selectPreviewPage;
  window.buildOverlay = buildOverlay;
  window.openPagePreviewGrid = openPagePreviewGrid;
  window.closePagePreviewGrid = closePagePreviewGrid;
}

export {
  SPEECH_ICON,
  isPagePreviewGridOpen,
  selectPreviewPage,
  buildOverlay,
  openPagePreviewGrid,
  closePagePreviewGrid
};
