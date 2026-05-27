import { state } from '../globals.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

  let isNavigating = false;

  async function getPageUrl(pageName) {
    if (!global.currentComic) return null;
    if (global.pageUrlCache?.has(pageName)) {
      return global.pageUrlCache.get(pageName);
    }

    let zipData = null;

    // Device Library handle or legacy File object
    if (global.currentComic?.handle) {
      try {
        zipData = await global.currentComic.handle.getFile();
      } catch (err) {
        console.error('[VIEWER-LOCAL] Failed to get file from handle:', err);
        return null;
      }
    } else if (global.currentComic?.file) {
      zipData = global.currentComic.file;
    }

    if (!zipData) {
      console.error('[VIEWER-LOCAL] No local zip data found');
      return null;
    }

    try {
      let zip;
      if (global.currentComicZipCache && global.currentComicZipCache.id === global.currentComic.id) {
        zip = global.currentComicZipCache.zip;
      } else {
        const JSZipCtor = global.JSZip;
        if (!JSZipCtor) {
          console.error('[VIEWER-LOCAL] JSZip not found');
          return null;
        }
        zip = await new JSZipCtor().loadAsync(zipData);
        global.currentComicZipCache = { id: global.currentComic.id, zip: zip };
      }
      
      const pageFile = zip.file(pageName);
      if (pageFile) {
        const blob = await pageFile.async('blob');
        const url = URL.createObjectURL(blob);
        global.pageUrlCache?.set(pageName, url);
        return url;
      }
    } catch (zipError) {
      console.error('[VIEWER-LOCAL] Zip extraction failed:', zipError);
    }

    return null;
  }

  // Preloading for local is a no-op as everything is already on disk, 
  // but we provide the functions for compatibility.
  function preloadPages() {}
  function prunePreloadedImages() {}

  async function renderPage() {
    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) {
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-gray-400">No pages found.</div>`;
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
      if (!pageUrl) throw new Error('Could not generate page URL');

      const img = new Image();
      // Local blob URLs don't need crossOrigin
      img.src = pageUrl;

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
        
        // Wait for it to load before swapping
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

      return true;
    } catch (error) {
      console.error('[VIEWER-LOCAL] renderPage ERROR:', error);
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-red-400">Failed to load local page.</div>`;
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

  async function saveProgress(page) {
    if (!global.currentComic) return;
    try {
      if (!global.currentComic.progress) {
        global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
      }
      global.currentComic.progress.lastReadPage = page;

      // Local/Device comics only save to sessionStorage
      sessionStorage.setItem(`progress_${global.currentComic.id}`, page);
      
      if (global.updateLibraryProgress) {
        global.updateLibraryProgress(global.currentComic.id, page, global.currentComic.progress.totalPages);
      }
    } catch (error) {
      // Silent catch
    }
  }

  async function navigatePage(direction) {
    if (isNavigating || global.isFullscreenZoomed || global.isFullImageMode || global.GuidedView?.isPanning) return;
    
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }

    isNavigating = true;

    const pages = global.getViewerPages?.() || [];
    if (!Array.isArray(pages) || pages.length === 0) {
      isNavigating = false;
      return;
    }

    if (global.tryGuidedAdvance && global.tryGuidedAdvance(direction)) {
      isNavigating = false;
      return;
    }

    const newIndex = global.currentPageIndex + direction;
    if (newIndex < 0 || newIndex >= pages.length) {
      isNavigating = false;
      return;
    }

    global.currentPageIndex = newIndex;
    global.hidePageJumpInput?.({ focusButton: false });
    
    if (global.isLandscapeOrientation && typeof global.resetLandscapePan === 'function') {
      global.resetLandscapePan();
    }

    try {
      saveProgress(global.currentPageIndex);
      const rendered = await renderPage();

      if (rendered && typeof global.onGuidedPageRendered === 'function') {
        global.onGuidedPageRendered(direction);
      }
      if (rendered) {
        // Reset scroll to top for the new page
        if (global.viewerContent) {
          global.viewerContent.scrollTop = 0;
        }
        if (typeof global.triggerEinkFlash === 'function') {
          global.triggerEinkFlash();
        }
      }
    } catch (error) {
      console.error('[VIEWER-LOCAL] navigatePage ERROR:', error);
    } finally {
      isNavigating = false;
    }
  }

  function initLocalViewer() {
    global.getPageUrl = getPageUrl;
    global.preloadPages = preloadPages;
    global.prunePreloadedImages = prunePreloadedImages;
    global.renderPage = renderPage;
    global.navigatePage = navigatePage;
    global.saveProgress = saveProgress;
    
    global.initializeViewerUIControls?.();
    global.rebindViewerEvents?.();
  }

  global.initLocalViewer = initLocalViewer;

export {
  getPageUrl,
  preloadPages,
  prunePreloadedImages,
  renderPage,
  navigatePage,
  saveProgress,
  initLocalViewer
};

state.getPageUrl = getPageUrl;
state.preloadPages = preloadPages;
state.prunePreloadedImages = prunePreloadedImages;
state.renderPage = renderPage;
state.navigatePage = navigatePage;
state.saveProgress = saveProgress;
state.initLocalViewer = initLocalViewer;

if (typeof window !== 'undefined') {
  window.getPageUrl = getPageUrl;
  window.preloadPages = preloadPages;
  window.prunePreloadedImages = prunePreloadedImages;
  window.renderPage = renderPage;
  window.navigatePage = navigatePage;
  window.saveProgress = saveProgress;
  window.initLocalViewer = initLocalViewer;
}
