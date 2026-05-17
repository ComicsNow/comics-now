(function (global) {
  'use strict';

  // Get references from already-loaded modules
  const { ICONS, positionContextMenu, attachCloseHandler, closeContextMenu } = global.ContextMenuBuilder;
  const { toggleMangaMode, updateMangaModeInCache, updateLibraryCache, updateMangaModeUI } = global.MangaMode;

  // Get continuous mode functions if available
  const toggleContinuousMode = global.toggleContinuousMode;
  const updateContinuousModeInCache = global.updateContinuousModeInCache;
  const updateContinuousModeUI = global.updateContinuousModeUI;

  // ============================================================================
  // MENU ITEM FACTORIES
  // ============================================================================

  /**
   * Helper to create a menu item element
   */
  function createMenuItem(html, onClick, options = {}) {
    const item = document.createElement('div');
    item.className = 'comic-context-menu-item' + (options.className ? ` ${options.className}` : '');
    item.innerHTML = html;
    
    if (options.disabled) {
      item.style.cursor = 'default';
      item.style.opacity = options.opacity || '0.7';
    } else if (onClick) {
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        await onClick(e);
      });
    }
    
    if (options.style) {
      Object.assign(item.style, options.style);
    }
    
    return item;
  }

  /**
   * Factory for Download menu items
   */
  function createDownloadItem(comics, options = {}) {
    const isDesktop = typeof isDesktopDevice === 'function' && isDesktopDevice();
    if (isDesktop) return null;

    const comicsArray = Array.isArray(comics) ? comics : [comics];
    if (comicsArray.length === 0) return null;

    const isDownloaded = comicsArray.every(c => global.downloadedComicIds && global.downloadedComicIds.has(c.id));
    const label = options.label || (comicsArray.length > 1 ? 'Series' : 'for Offline');
    const icon = isDownloaded ? ICONS.SUCCESS : ICONS.DOWNLOAD;
    const text = isDownloaded ? `${label.replace('for Offline', '')} Downloaded`.trim() : `Download ${label}`;

    return createMenuItem(`${icon}<span>${escapeHtml(text)}</span>`, async () => {
      if (comicsArray.length === 1) {
        if (typeof global.downloadComic === 'function') {
          const tempBtn = document.createElement('button');
          await global.downloadComic(comicsArray[0], tempBtn);
        }
      } else {
        if (typeof global.downloadSeries === 'function') {
          const tempBtn = document.createElement('button');
          if (options.data) Object.assign(tempBtn.dataset, options.data);
          await global.downloadSeries(comicsArray, tempBtn);
        }
      }
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
    }, {
      className: (isDownloaded ? 'text-green-400' : '') + ' hide-offline',
      disabled: isDownloaded
    });
  }

  /**
   * Factory for Read/Unread toggle menu items
   */
  function createReadStatusItem(comics, options = {}) {
    const comicsArray = Array.isArray(comics) ? comics : [comics];
    if (comicsArray.length === 0) return null;

    let isRead = false;
    if (comicsArray.length === 1) {
      isRead = (typeof global.getComicStatus === 'function' ? global.getComicStatus(comicsArray[0]) : 'unread') === 'read';
    } else {
      isRead = comicsArray.every(c => {
        const p = c.progress || {};
        return (p.totalPages || 0) > 0 && (p.lastReadPage || 0) >= (p.totalPages - 1);
      });
    }

    const icon = isRead ? ICONS.SUCCESS : ICONS.EYE;
    const label = options.label || (comicsArray.length > 1 ? 'Series' : '');
    const text = `Mark ${label} as ${isRead ? 'Unread' : 'Read'}`.replace(/\s+/g, ' ');

    return createMenuItem(`${icon}<span>${escapeHtml(text)}</span>`, async () => {
      if (typeof global.toggleReadStatus === 'function') {
        const mockButton = document.createElement('button');
        if (comicsArray.length === 1) {
          mockButton.dataset.comicId = comicsArray[0].id;
        } else if (options.data) {
          Object.assign(mockButton.dataset, options.data);
        }
        mockButton.dataset.currentStatus = isRead ? 'read' : 'unread';
        
        await global.toggleReadStatus(mockButton);

        if (comicsArray.length === 1) {
          const comic = comicsArray[0];
          if (!comic.progress) comic.progress = { totalPages: 0, lastReadPage: 0 };
          if (!isRead) {
            comic.progress.totalPages = comic.progress.totalPages || Math.max(comic.pageCount || 0, 1);
            comic.progress.lastReadPage = Math.max(comic.progress.totalPages - 1, 0);
          } else {
            comic.progress.lastReadPage = 0;
          }
        }
        
        if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      }
    }, {
      className: (isRead ? 'text-green-400' : '') + ' hide-offline'
    });
  }

  function createBulkReadItem(comics, label) {
    if (!Array.isArray(comics) || comics.length === 0) return null;
    return createMenuItem(`${ICONS.EYE}<span>Bulk Mark Read/Unread…</span>`, () => {
      if (typeof global.openBulkReadStatusDialog === 'function') {
        global.openBulkReadStatusDialog(comics, label);
      }
    }, {
      className: 'hide-offline'
    });
  }

  /**
   * Factory for Manga Mode toggle
   */
  function createMangaToggleItem(comics, labelPrefix = '') {
    const comicsArray = Array.isArray(comics) ? comics : [comics];
    if (comicsArray.length === 0) return null;

    const allManga = comicsArray.every(c => c.mangaMode === true);
    const icon = allManga ? ICONS.CHECKMARK : ICONS.BOOK;
    const text = `${allManga ? (comicsArray.length > 1 ? 'Unset' : 'Disable') : (comicsArray.length > 1 ? 'Set to' : 'Enable')} ${labelPrefix} Manga Mode`.replace(/\s+/g, ' ');

    return createMenuItem(`${icon}<span>${escapeHtml(text)}</span>`, async () => {
      const newMode = !allManga;
      for (const comic of comicsArray) {
        await toggleMangaMode(comic.id, comic.mangaMode || false);
        comic.mangaMode = newMode;
        if (typeof global.updateComicInLibrary === 'function') {
          global.updateComicInLibrary(comic.id, { mangaMode: newMode });
        }
      }
      await updateLibraryCache(comicsArray, newMode);
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      
      if (comicsArray.length === 1 && global.currentComic && global.currentComic.id === comicsArray[0].id) {
        global.currentComic.mangaMode = newMode;
        updateMangaModeUI(newMode);
      }
    }, {
      className: allManga ? 'manga-active' : ''
    });
  }

  /**
   * Factory for Continuous Mode toggle
   */
  function createContinuousToggleItem(comics, labelPrefix = '') {
    if (typeof toggleContinuousMode !== 'function') return null;
    const comicsArray = Array.isArray(comics) ? comics : [comics];
    if (comicsArray.length === 0) return null;

    const allContinuous = comicsArray.every(c => c.continuousMode === true);
    const icon = allContinuous ? ICONS.CHECKMARK : ICONS.SCROLL;
    const text = `${allContinuous ? (comicsArray.length > 1 ? 'Unset' : 'Disable') : (comicsArray.length > 1 ? 'Set to' : 'Enable')} ${labelPrefix} Continuous Mode`.replace(/\s+/g, ' ');

    return createMenuItem(`${icon}<span>${escapeHtml(text)}</span>`, async () => {
      const newMode = !allContinuous;
      for (const comic of comicsArray) {
        await toggleContinuousMode(comic.id, comic.continuousMode || false);
        comic.continuousMode = newMode;
        if (typeof global.updateComicInLibrary === 'function') {
          global.updateComicInLibrary(comic.id, { continuousMode: newMode });
        }
      }
      if (typeof updateContinuousModeInCache === 'function') {
        for (const comic of comicsArray) await updateContinuousModeInCache(comic.id, newMode);
      }
      if (typeof global.applyFilterAndRender === 'function') global.applyFilterAndRender();
      
      if (comicsArray.length === 1 && global.currentComic && global.currentComic.id === comicsArray[0].id) {
        global.currentComic.continuousMode = newMode;
        if (typeof updateContinuousModeUI === 'function') updateContinuousModeUI(newMode);
      }
    }, {
      className: allContinuous ? 'continuous-active' : ''
    });
  }

  /**
   * Factory for Guided Detection items
   */
  function createGuidedDetectionItem(scope, target, label, comics) {
    const comicsArray = Array.isArray(comics) ? comics : [comics];
    const eligibleCount = comicsArray.filter(isEligibleComic).length;
    if (eligibleCount === 0) return null;

    const isSingle = comicsArray.length === 1;
    const comic = isSingle ? comicsArray[0] : null;
    const isProcessed = isSingle && comic.guidedViewStatus === 'completed';
    const isProcessing = isSingle && comic.guidedViewStatus === 'processing';

    const text = isProcessing ? 'Guided Detection Running…' : 
                 `${isProcessed ? 'Re-run' : 'Run'} Guided Detection${!isSingle ? ` (${eligibleCount})` : ''}`;

    return createMenuItem(`${ICONS.BOOK}<span>${escapeHtml(text)}</span>`, async () => {
      await triggerGuidedRunForScope(scope, target, label);
    }, {
      disabled: isProcessing,
      opacity: isProcessing ? '0.6' : null
    });
  }

  /**
   * Factory for Reading List items
   */
  function createReadingListItem(comics) {
    const comicsArray = Array.isArray(comics) ? comics : [comics];
    if (comicsArray.length === 0) return null;

    return createMenuItem(`${ICONS.READING_LIST}<span>Add to Reading List</span>`, () => {
      if (typeof global.ReadingLists !== 'undefined' && typeof global.ReadingLists.openAddToListModal === 'function') {
        global.ReadingLists.openAddToListModal(comicsArray.map(c => c.id));
      }
    });
  }

  // Trigger the server-side guided panel detector for a given scope.
  async function triggerGuidedRunForScope(scope, target, label) {
    try {
      const base = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '') || '';
      const res = await fetch(`${base}/api/v1/guided/run-scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, target })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || `Could not start guided detection for ${label}.`);
        return false;
      }
      alert(`Guided detection started for ${label}.\nWatch progress under Settings → Guided View.`);
      return true;
    } catch (e) {
      alert(`Failed to start guided detection: ${e.message || e}`);
      return false;
    }
  }

  // True if the comic is eligible for guided detection.
  function isEligibleComic(comic) {
    return !!comic;
  }

  // Expose functions to global scope
  global.createMenuItem = createMenuItem;
  global.createDownloadItem = createDownloadItem;
  global.createReadStatusItem = createReadStatusItem;
  global.createBulkReadItem = createBulkReadItem;
  global.createMangaToggleItem = createMangaToggleItem;
  global.createContinuousToggleItem = createContinuousToggleItem;
  global.createGuidedDetectionItem = createGuidedDetectionItem;
  global.createReadingListItem = createReadingListItem;
  global.triggerGuidedRunForScope = triggerGuidedRunForScope;
  global.isEligibleComic = isEligibleComic;

})(typeof window !== 'undefined' ? window : globalThis);
