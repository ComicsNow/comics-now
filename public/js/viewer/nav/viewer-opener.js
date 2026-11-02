import { state, global as canonicalGlobal, actions, clearElement, escapeHtml } from '../../globals.js';
import { html, raw, render } from '../../ui/template.js';
import { loadOfflineComicPages, normalizePagesResponse } from './offline-loader.js';
import { setLibraryControlsVisibility } from './return-nav.js';
import { updateViewerBreadcrumbs } from './viewer-breadcrumbs.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});
const actionsRef = (typeof actions !== 'undefined' && actions?.navigation) ? actions : global?.actions;
const clear = typeof clearElement === 'function' ? clearElement : (el) => { if (el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else el.innerHTML = ''; } };
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

async function openComicViewer(comic, options = {}) {
  const isLocal = !!(comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-')));

  const isNavigating = !!((typeof window !== 'undefined' && window._isNavigatingFromRouter) ||
                          (typeof global !== 'undefined' && global._isNavigatingFromRouter) ||
                          (typeof state !== 'undefined' && state._isNavigatingFromRouter));
  if (typeof window !== 'undefined' && !isNavigating && window.router && !isLocal) {
     let navPath = `/comic/${comic.id}`;
     const params = new URLSearchParams();
     if (global.currentFolderPath) {
       params.set('folderPath', global.currentFolderPath);
     }
     if (options.readingListId) {
       params.set('readingListId', options.readingListId);
     }
     if (options.readingListName) {
       params.set('readingListName', options.readingListName);
     }
     const qs = params.toString();
     if (qs) {
       navPath += `?${qs}`;
     }
     window.router.navigate(navPath, true);
     return;
  }

  global.viewerReturnContext = {
    view: global.currentView,
    rootFolder: global.currentRootFolder,
    publisher: global.currentPublisher,
    series: global.currentSeries,
    folderPath: global.currentFolderPath,
    readingListId: options.readingListId || null,
    readingListName: options.readingListName || null,
  };

  if (isLocal) {
    if (typeof global.initLocalViewer === 'function') {
      global.initLocalViewer();
    } else {
      console.error('[VIEWER] Local viewer initializer not found');
    }
  } else {
    if (typeof global.initServerViewer === 'function') {
      global.initServerViewer();
    } else {
      console.error('[VIEWER] Server viewer initializer not found');
    }
  }

  updateViewerBreadcrumbs(comic, options);

  if (actionsRef?.navigation?.setView) {
    actionsRef.navigation.setView('comic');
  } else {
    global.currentView = 'comic';
  }

  setLibraryControlsVisibility(false);
  global.updateOrientationButtons?.();
  global.showView?.(global.comicViewerDiv);

  if (global.comicViewerDiv) {
    global.comicViewerDiv.style.display = '';
  }

  if (global.metadataTabBtn) {
    if (isLocal || comic.libraryMode === 'folder') {
      global.metadataTabBtn.classList.add('hidden');
    } else {
      const isAdmin = typeof window !== 'undefined' && window.syncManager && window.syncManager.userRole === 'admin';
      global.metadataTabBtn.classList.toggle('hidden', !isAdmin);
    }
  }

  const displayInfo = global.applyDisplayInfoToComic?.(comic) || {};
  if (global.comicTitleH2) {
    global.comicTitleH2.textContent = displayInfo.displayTitle || comic.name || '';
  }
  if (global.comicSubtitleP) {
    const subtitleText = displayInfo.subtitle;
    if (subtitleText) {
      global.comicSubtitleP.textContent = subtitleText;
      global.comicSubtitleP.classList.remove('hidden');
    } else {
      global.comicSubtitleP.textContent = '';
      global.comicSubtitleP.classList.add('hidden');
    }
  }

  global.resetComicSummary?.();
  global.currentComic = comic;
  global.currentMetadata = null;
  global.currentComicZipCache = null;
  global.preloadedImages?.clear?.();
  global.pageUrlCache?.clear?.();
  global.hidePageJumpInput?.({ focusButton: false });
  global.updateViewerPageCounter?.([]);

  // Automatically sync manga mode from library if available
  if (!isLocal && typeof navigator !== 'undefined' && navigator.onLine && typeof global.library !== 'undefined') {
    try {
      let libraryComic = null;
      for (const rootFolder of Object.keys(global.library)) {
        const publishers = global.library[rootFolder]?.publishers || {};
        for (const publisherName of Object.keys(publishers)) {
          const seriesEntries = publishers[publisherName]?.series || {};
          for (const seriesName of Object.keys(seriesEntries)) {
            const comics = seriesEntries[seriesName];
            if (Array.isArray(comics)) {
              libraryComic = comics.find(c => c.id === comic.id);
              if (libraryComic) break;
            }
          }
          if (libraryComic) break;
        }
        if (libraryComic) break;
      }

      if (libraryComic && libraryComic.mangaMode !== undefined) {
        const syncedMangaMode = libraryComic.mangaMode;
        if (comic.mangaMode !== syncedMangaMode) {
          comic.mangaMode = syncedMangaMode;
          global.currentComic.mangaMode = syncedMangaMode;

          const isDownloaded = global.downloadedComicIds?.has(comic.id);
          if (isDownloaded && typeof global.updateDownloadedComicInfo === 'function') {
            try {
              await global.updateDownloadedComicInfo(comic.id, { mangaMode: syncedMangaMode });
            } catch (error) {}
          }
          if (typeof global.updateDownloadedSmartListComic === 'function') {
            global.updateDownloadedSmartListComic(comic.id, { mangaMode: syncedMangaMode });
          }
        }
      }
    } catch (error) {
      console.error('[MANGA] Error during automatic manga mode sync:', error);
    }
  }

  if (typeof global.updateMangaModeUI === 'function') {
    global.updateMangaModeUI(comic.mangaMode || false);
  }

  if (typeof global.setOrientationMode === 'function') {
    const wantLandscape = typeof global.resolveLandscapePreference === 'function'
      ? global.resolveLandscapePreference(comic)
      : !!(comic.landscapeMode === true || comic.landscapeMode == 1);
    global.setOrientationMode(wantLandscape ? 'landscape' : 'portrait', { persist: false });
  }

  if (comic.continuousMode && typeof global.enableContinuousMode === 'function') {
    await global.enableContinuousMode();
  } else {
    if (typeof global.disableContinuousMode === 'function' && global.isContinuousMode) {
      await global.disableContinuousMode();
    }
    if (typeof global.updateContinuousModeUI === 'function') {
      global.updateContinuousModeUI(false);
    }
  }

  if (typeof global.setFullImageMode === 'function') {
    const wantFullImage = typeof global.resolveFullImagePreference === 'function'
      ? global.resolveFullImagePreference(comic)
      : !!(comic.fullImageMode === true || comic.fullImageMode == 1);
    if (wantFullImage !== !!global.isFullImageMode) {
      global.setFullImageMode(wantFullImage, { persist: false });
    } else if (wantFullImage) {
      global.applyFullImageLayout?.();
    }
  }

  if (global.viewerPagesDiv) {
    global.viewerPagesDiv.dataset.loading = 'true';
    global.viewerPagesDiv.dataset.pages = JSON.stringify([]);
    clear(global.viewerPagesDiv);
    if (global.pageLoader) {
      global.viewerPagesDiv.appendChild(global.pageLoader);
    }
  }

  global.viewerTabBtn?.click?.();

  let pages = [];
  let offlinePages = [];
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  
  try {
    offlinePages = await loadOfflineComicPages(comic);
    if (offlinePages.length > 0) {
      pages = offlinePages;
    }
  } catch (offlineError) {}

  if (!Array.isArray(pages) || pages.length === 0) {
    if (isOffline) {
      console.error('[OFFLINE] No local pages found while offline');
    } else {
      try {
        const encodeFn = (typeof global !== 'undefined' && typeof global.encodePath === 'function')
          ? global.encodePath
          : ((typeof window !== 'undefined' && typeof window.encodePath === 'function') ? window.encodePath : (p => btoa(encodeURIComponent(p))));
        const response = await fetch(`${global.API_BASE_URL}/api/v1/comics/pages?path=${encodeURIComponent(encodeFn(comic.path))}`);
        let data = null;
        try {
          data = await response.json();
        } catch (parseError) {
          data = null;
        }

        if (!response.ok || data?.offline) {
          throw new Error(`Failed to load pages: ${response.status}`);
        }

        pages = normalizePagesResponse(data);
      } catch (error) {
        console.error('[VIEWER] API fetch failed:', error);
        if (offlinePages.length === 0) {
          pages = await loadOfflineComicPages(comic);
        }
      }
    }
  }

  if (global.viewerPagesDiv) {
    delete global.viewerPagesDiv.dataset.loading;
  }

  global.pageLoader?.classList.add('hidden');
  global.pageLoader?.classList.remove('flex');

  if (!Array.isArray(pages) || pages.length === 0) {
    if (global.viewerPagesDiv) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const message = offline
        ? 'Failed to load pages while offline. Make sure this comic is downloaded for offline reading.'
        : 'Failed to load pages.';
      renderContent(global.viewerPagesDiv, safeHtml`<div class="text-center text-red-400">${message}</div>`);
      global.viewerPagesDiv.dataset.pages = JSON.stringify([]);
    }
    global.updateViewerPageCounter?.([]);
    return;
  }

  if (global.viewerPagesDiv) {
    global.viewerPagesDiv.dataset.pages = JSON.stringify(pages);
  }

  const sessionSavedPage = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`progress_${comic.id}`) : null;
  const savedProgress = sessionSavedPage !== null 
    ? parseInt(sessionSavedPage, 10) 
    : (comic.progress?.lastReadPage || 0);
  
  global.currentPageIndex = Math.max(0, Math.min(savedProgress, pages.length - 1));

  if (typeof window !== 'undefined' && window.syncManager) {
    try {
      await window.syncManager.checkSyncStatus(comic.id, global.currentPageIndex);
    } catch (error) {}
  }

  await global.renderPage?.();
  global.preloadPages?.(global.currentPageIndex, pages);

  if (typeof global.refreshGuidedToggle === 'function') {
    try { await global.refreshGuidedToggle(); } catch (_) {}
  }

  if (global.viewerContent) {
    global.viewerContent.scrollTop = 0;
  }

  if (typeof global.loadComicSummary === 'function') {
    try {
      await global.loadComicSummary();
    } catch (error) {}
  }

  if (!isLocal && typeof window !== 'undefined' && window.syncManager) {
    window.syncManager.startPolling(comic);
  }
}

export { openComicViewer };
