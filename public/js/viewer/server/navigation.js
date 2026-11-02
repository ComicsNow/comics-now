import { state, global as canonicalGlobal } from '../../globals.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

let isNavigating = false;

export async function saveProgress(page) {
  if (!global.currentComic) return;
  try {
    if (!global.currentComic.progress) {
      global.currentComic.progress = { totalPages: 0, lastReadPage: 0 };
    }
    global.currentComic.progress.lastReadPage = page;

    // Server comics always sync via syncManager
    const syncManager = global.syncManager || global.window?.syncManager || (typeof window !== 'undefined' && window.syncManager);
    if (syncManager) {
      try {
        await syncManager.updateProgress(global.currentComic.id, page);
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

export async function navigatePage(direction, renderPageFn) {
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

    const render = renderPageFn || global.renderPage;
    const rendered = render ? await render() : false;

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
