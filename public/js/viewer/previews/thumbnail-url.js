import { state, actions, encodePath } from '../../globals.js';
import { continuousState } from '../../continuous/state.js';

/**
 * Thumbnail URL for a page: small w=220 WebP for server comics (rides the WebP
 * transcode + disk cache), or a local object URL for offline/device comics.
 */
async function getThumbnailUrl(comic, pageName, globalState) {
  if (!comic || !pageName) return '';
  const currentGlobal = globalState || (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? window.state : {}));

  const isOffline = comic.isOffline || !!comic.file || !!comic.handle ||
    (currentGlobal.downloadedComicIds && currentGlobal.downloadedComicIds.has(comic.id));

  if (isOffline && typeof currentGlobal.getPageUrl === 'function') {
    try {
      const offlineUrl = await currentGlobal.getPageUrl(pageName);
      if (offlineUrl) return offlineUrl;
    } catch (e) {
      console.warn('[PAGE-PREVIEWS] Failed to get offline URL for thumbnail:', e);
    }
  }

  const pathStr = comic.path || '';
  const encoded = typeof currentGlobal.encodePath === 'function'
    ? currentGlobal.encodePath(pathStr)
    : (typeof encodePath === 'function' ? encodePath(pathStr) : btoa(encodeURIComponent(pathStr)));
  const apiBase = currentGlobal.API_BASE_URL || '';
  return `${apiBase}/api/v1/comics/pages/image?path=${encodeURIComponent(encoded)}&page=${encodeURIComponent(pageName)}&w=220`;
}

/**
 * Jump the viewer to a page and persist progress (offline-aware, matching
 * ui-page-jump.js behaviour).
 */
async function goToPage(targetIndex) {
  const global = typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? window.state : {});
  const pages = global.getViewerPages?.() || [];
  if (!pages.length) return false;

  const clampedIndex = Math.max(0, Math.min(targetIndex, pages.length - 1));
  const previousIndex = global.currentPageIndex;
  const actionsRef = (typeof actions !== 'undefined' ? actions : global?.actions);
  if (actionsRef?.viewer?.setPageIndex) {
    actionsRef.viewer.setPageIndex(clampedIndex, { source: 'page_preview' });
  } else {
    global.currentPageIndex = clampedIndex;
  }

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

    // In continuous mode the view is the scroll container, not a single
    // rendered page — scroll the target page into view instead of calling
    // the single-page renderer (mirrors renderContinuousMode centering).
    if (typeof continuousState !== 'undefined' && continuousState.isContinuousMode && continuousState.continuousContainer) {
      const targetContainer = continuousState.continuousContainer.querySelector(
        `.page-container[data-index="${clampedIndex}"]`
      );
      if (targetContainer) {
        try {
          targetContainer.scrollIntoView({ behavior: 'auto', block: 'center' });
        } catch (_) {
          try { targetContainer.scrollIntoView(true); } catch (e) {}
        }
        return true;
      }
    }

    const rendered = await global.renderPage?.();
    if (rendered === false) {
      if (actionsRef?.viewer?.setPageIndex) {
        actionsRef.viewer.setPageIndex(previousIndex, { source: 'preview_rollback' });
      } else {
        global.currentPageIndex = previousIndex;
      }
      return false;
    }
    return true;
  } catch (err) {
    if (actionsRef?.viewer?.setPageIndex) {
      actionsRef.viewer.setPageIndex(previousIndex, { source: 'preview_rollback' });
    } else {
      global.currentPageIndex = previousIndex;
    }
    return false;
  }
}

if (typeof state !== 'undefined') {
  state.getThumbnailUrl = getThumbnailUrl;
  state.goToPage = goToPage;
}
if (typeof window !== 'undefined') {
  window.getThumbnailUrl = getThumbnailUrl;
  window.goToPage = goToPage;
}

export {
  getThumbnailUrl,
  goToPage
};
