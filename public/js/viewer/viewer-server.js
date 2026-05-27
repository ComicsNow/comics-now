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

    // Check for Downloaded Comic in DB (for offline support of server comics)
    if (typeof global.getComicFromDB === 'function') {
      const downloadedComic = await global.getComicFromDB(global.currentComic?.id);
      if (downloadedComic && downloadedComic.fileBlob) {
        zipData = downloadedComic.fileBlob;
      }
    }

    if (zipData) {
      try {
        let zip;
        if (global.currentComicZipCache && global.currentComicZipCache.id === global.currentComic.id) {
          zip = global.currentComicZipCache.zip;
        } else {
          const JSZipCtor = global.JSZip;
          if (!JSZipCtor) {
            console.error('[VIEWER-SERVER] JSZip not found for offline comic');
          } else {
            zip = await new JSZipCtor().loadAsync(zipData);
            global.currentComicZipCache = { id: global.currentComic.id, zip: zip };
          }
        }
        
        if (zip) {
          const pageFile = zip.file(pageName);
          if (pageFile) {
            const blob = await pageFile.async('blob');
            const url = URL.createObjectURL(blob);
            global.pageUrlCache?.set(pageName, url);
            return url;
          }
        }
      } catch (zipError) {
        console.error('[VIEWER-SERVER] Zip extraction failed for offline comic:', zipError);
      }
    }

    // Fallback to API URL
    const url = `${global.API_BASE_URL}/api/v1/comics/pages/image?path=${encodeURIComponent(global.encodePath(global.currentComic.path))}&page=${encodeURIComponent(pageName)}`;
    global.pageUrlCache?.set(pageName, url);
    return url;
  }

  function preloadPages(currentIndex, pages) {
    if (!Array.isArray(pages)) return;

    const start = currentIndex + 1;
    const end = Math.min(pages.length, start + (global.PRELOAD_AHEAD_COUNT || 0));

    for (let i = start; i < end; i++) {
      const pageName = pages[i];
      (async () => {
        try {
          const pageUrl = await getPageUrl(pageName);
          if (!global.preloadedImages?.has(pageUrl)) {
            const img = new Image();
            img.src = pageUrl;
            img.onload = () => global.preloadedImages?.set(pageUrl, img);
          }
        } catch (error) {
          // Silent catch for preloading
        }
      })();
    }
  }

  function prunePreloadedImages(currentIndex, pages) {
    if (!Array.isArray(pages)) return;

    (async () => {
      try {
        const urlsToKeep = new Set();
        const PRELOAD_BEHIND_COUNT = 5;

        const start = Math.max(0, currentIndex - PRELOAD_BEHIND_COUNT);
        const end = Math.min(pages.length, currentIndex + (global.PRELOAD_AHEAD_COUNT || 0) + 1);

        for (let i = start; i < end; i++) {
          const url = await getPageUrl(pages[i]);
          urlsToKeep.add(url);
        }

        for (const key of Array.from(global.preloadedImages?.keys?.() || [])) {
          if (!urlsToKeep.has(key)) {
            global.preloadedImages.delete(key);
          }
        }
      } catch (error) {
        // Silent catch
      }
    })();
  }

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

      prunePreloadedImages(global.currentPageIndex, pages);
      preloadPages(global.currentPageIndex, pages);
      return true;
    } catch (error) {
      console.error('[VIEWER-SERVER] renderPage ERROR:', error);
      if (global.viewerPagesDiv) {
        global.viewerPagesDiv.innerHTML = `<div class="text-center text-red-400">Failed to load page.</div>`;
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

      // Server comics always sync via syncManager
      if (global.window.syncManager) {
        try {
          await global.window.syncManager.updateProgress(global.currentComic.id, page);
        } catch (error) {
          // Silent catch
        }
      }

      // If it's a downloaded comic, also update IndexedDB
      if (global.downloadedComicIds?.has(global.currentComic.id)) {
        try {
          await global.saveProgressToDB?.(
            global.currentComic.id,
            page,
            global.currentComic.progress?.totalPages,
            global.currentComic.path
          );
        } catch (error) {
          // Silent catch
        }
      }
    } catch (error) {
      // Silent catch
    }
  }

  async function navigatePage(direction) {
    if (isNavigating || global.isFullscreenZoomed || global.isFullImageMode || global.GuidedView?.isPanning) return;
    if (!global.currentComic) return;
    
    if (typeof global.hideFullscreenControls === 'function') {
      global.hideFullscreenControls();
    }

    isNavigating = true;

    try {
      const pages = global.getViewerPages?.() || [];
      if (!Array.isArray(pages) || pages.length === 0) {
        return;
      }

      if (global.tryGuidedAdvance && global.tryGuidedAdvance(direction)) {
        return;
      }

      const newIndex = global.currentPageIndex + direction;
      if (newIndex < 0 || newIndex >= pages.length) {
        return;
      }

      global.currentPageIndex = newIndex;
      global.hidePageJumpInput?.({ focusButton: false });
      
      if (global.isLandscapeOrientation && typeof global.resetLandscapePan === 'function') {
        global.resetLandscapePan();
      }

      saveProgress(global.currentPageIndex);
      
      if (global.updateLibraryProgress) {
        global.updateLibraryProgress(global.currentComic.id, global.currentPageIndex, global.currentComic.progress?.totalPages);
      }

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
      console.error('[VIEWER-SERVER] navigatePage ERROR:', error);
    } finally {
      isNavigating = false;
    }
  }

  function initServerViewer() {
    global.getPageUrl = getPageUrl;
    global.preloadPages = preloadPages;
    global.prunePreloadedImages = prunePreloadedImages;
    global.renderPage = renderPage;
    global.navigatePage = navigatePage;
    global.saveProgress = saveProgress;
    
    // Wire up event listeners if they aren't already
    global.initializeViewerUIControls?.();
    global.rebindViewerEvents?.();
  }

  global.initServerViewer = initServerViewer;

export {
  getPageUrl,
  preloadPages,
  prunePreloadedImages,
  renderPage,
  navigatePage,
  saveProgress,
  initServerViewer
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
