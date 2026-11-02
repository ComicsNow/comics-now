import { state, global as canonicalGlobal } from '../globals.js';
import { html, render } from '../ui/template.js';
import { getPageUrl, preloadPages, prunePreloadedImages } from './server/preloader.js';
import { saveProgress, navigatePage as executeNavigatePage } from './server/navigation.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const renderContent = (typeof render === 'function' && render.length >= 2) ? render : (el, content) => {
  if (!el) return;
  el.innerHTML = typeof content === 'object' && content.__isRawHtml ? content.html : String(content ?? '');
};

const safeHtml = (typeof html === 'function') ? html : (strings, ...values) => {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += String(values[i] ?? '');
  }
  return { toHTML: () => out, html: out, __isRawHtml: true };
};

export async function renderPage() {
  const pages = global.getViewerPages?.() || [];
  if (!Array.isArray(pages) || pages.length === 0) {
    if (global.viewerPagesDiv) {
      if (global.viewerPagesDiv.dataset.loading === 'true') {
        return false;
      }
      renderContent(global.viewerPagesDiv, safeHtml`<div class="text-center text-gray-400">No pages found.</div>`);
    }
    global.updateViewerPageCounter?.([]);
    return false;
  }

  global.currentPageIndex = Math.max(0, Math.min(global.currentPageIndex, pages.length - 1));
  const requestedIndex = global.currentPageIndex;

  global.updateViewerPageCounter?.(pages);
  global.hidePageJumpInput?.({ focusButton: false });

  if (global.pageLoader) {
    global.pageLoader.classList.remove('hidden');
    global.pageLoader.classList.add('flex');
  }

  const fullscreenPageLoader = document.getElementById('fullscreen-page-loader');
  const isFullscreenActive = global.fullscreenViewer && !global.fullscreenViewer.classList.contains('hidden');
  if (isFullscreenActive && fullscreenPageLoader) {
    fullscreenPageLoader.classList.remove('hidden');
    fullscreenPageLoader.classList.add('flex');
  }

  try {
    const isMangaMode = global.currentComic?.mangaMode || false;
    global.updateNavigationButtons?.(requestedIndex, pages.length, isMangaMode);

    const pageUrl = await getPageUrl(pages[requestedIndex]);
    let img = global.preloadedImages?.get(pageUrl);
    if (!img) {
      img = new Image();
      img.src = pageUrl;
      global.preloadedImages?.set(pageUrl, img);
    }

    await new Promise((resolve, reject) => {
      if (img.complete) resolve();
      else {
        img.onload = () => resolve();
        img.onerror = (err) => reject(err);
      }
    });

    if (requestedIndex !== global.currentPageIndex) return false;

    if (global.viewerPagesDiv) {
      const domImg = new Image();
      domImg.className = 'viewer-image rounded-lg shadow-xl';
      domImg.src = img.src;
      domImg.alt = `Page ${requestedIndex + 1}`;
      
      await new Promise((resolve) => {
        if (domImg.complete) resolve();
        else {
          domImg.onload = resolve;
          domImg.onerror = resolve;
        }
      });

      if (requestedIndex !== global.currentPageIndex) return false;

      const oldImg = global.viewerPagesDiv.querySelector('img.viewer-image');
      if (oldImg) oldImg.remove();
      
      global.viewerPagesDiv.appendChild(domImg);
      global.applyOrientationToElement?.(domImg);
      global.applyViewerFitMode?.(domImg);
    }

    if (isFullscreenActive && global.fullscreenImage) {
      global.fullscreenImage.removeAttribute('crossorigin');
      global.fullscreenImage.src = img.src;
      global.applyOrientationToElement?.(global.fullscreenImage);
      global.applyFullscreenFitMode?.();
      global.updateFullscreenPageStatus?.(global.currentPageIndex + 1, pages.length);
    }

    prunePreloadedImages(global.currentPageIndex, pages);
    preloadPages(global.currentPageIndex, pages);
    return true;
  } catch (error) {
    console.error('[VIEWER-SERVER] renderPage ERROR:', error);
    if (global.viewerPagesDiv) {
      renderContent(global.viewerPagesDiv, safeHtml`<div class="text-center text-red-400">Failed to load page.</div>`);
    }
    return false;
  } finally {
    if (global.pageLoader) {
      global.pageLoader.classList.add('hidden');
      global.pageLoader.classList.remove('flex');
    }
    if (fullscreenPageLoader) {
      fullscreenPageLoader.classList.add('hidden');
      fullscreenPageLoader.classList.remove('flex');
    }
    if (typeof global.updateEndOfComicNavigation === 'function') {
      await global.updateEndOfComicNavigation();
    }
  }
}

export async function navigatePage(direction) {
  return executeNavigatePage(direction, renderPage);
}

export function initServerViewer() {
  global.getPageUrl = getPageUrl;
  global.preloadPages = preloadPages;
  global.prunePreloadedImages = prunePreloadedImages;
  global.renderPage = renderPage;
  global.navigatePage = navigatePage;
  global.saveProgress = saveProgress;
  
  global.initializeViewerUIControls?.();
  global.rebindViewerEvents?.();
}

global.initServerViewer = initServerViewer;

export {
  getPageUrl,
  preloadPages,
  prunePreloadedImages,
  saveProgress
};

state.getPageUrl = getPageUrl;
state.preloadPages = preloadPages;
state.prunePreloadedImages = prunePreloadedImages;
state.renderPage = renderPage;
state.navigatePage = navigatePage;
state.saveProgress = saveProgress;
state.initServerViewer = initServerViewer;

if (typeof window !== 'undefined') {
  window.getPageUrl = getPageUrl;
  window.preloadPages = preloadPages;
  window.prunePreloadedImages = prunePreloadedImages;
  window.renderPage = renderPage;
  window.navigatePage = navigatePage;
  window.saveProgress = saveProgress;
  window.initServerViewer = initServerViewer;
}
