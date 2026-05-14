/**
 * End of Comic Navigation
 * Handles navigation to next comic in series or reading list when reaching the end
 */
(function(global) {
  'use strict';

  /**
   * Find which library/publisher/series a comic lives under, by scanning the in-memory library.
   * Used as a fallback when the user reached the comic without a drill-in context (e.g. from
   * a smart-filter list, search, etc.).
   */
  function locateComicInLibrary(comicId) {
    if (!global.library || comicId == null) return null;
    for (const rootFolder of Object.keys(global.library)) {
      const publishers = global.library[rootFolder]?.publishers || {};
      for (const publisher of Object.keys(publishers)) {
        const seriesEntries = publishers[publisher]?.series || {};
        for (const series of Object.keys(seriesEntries)) {
          const comics = seriesEntries[series];
          if (Array.isArray(comics) && comics.some(c => c && c.id === comicId)) {
            return { rootFolder, publisher, series };
          }
        }
      }
    }
    return null;
  }

  /**
   * Get the next comic in the current series.
   * Works regardless of how the user reached this comic — uses viewerReturnContext when
   * available, otherwise locates the comic in the library by ID. Suppressed when the user
   * is navigating a reading list (next-in-list takes priority there).
   * @returns {Object|null} Next comic object or null if at end of series / unavailable.
   */
  async function getNextComicInSeries() {
    const currentComic = global.currentComic;
    if (!currentComic) return null;

    // Reading-list path uses next-in-list instead — suppress the in-series suggestion.
    if (global.viewerReturnContext?.readingListId) return null;

    let rootFolder = global.viewerReturnContext?.rootFolder || null;
    let publisher = global.viewerReturnContext?.publisher || null;
    let series = global.viewerReturnContext?.series || null;

    if (!rootFolder || !publisher || !series) {
      const found = locateComicInLibrary(currentComic.id);
      if (!found) return null;
      rootFolder = found.rootFolder;
      publisher = found.publisher;
      series = found.series;
    }

    try {
      const seriesComics = await global.getSeriesComics?.(rootFolder, publisher, series);
      if (!Array.isArray(seriesComics) || seriesComics.length === 0) return null;

      const currentIndex = seriesComics.findIndex(comic => comic && comic.id === currentComic.id);
      if (currentIndex === -1) return null;

      const nextIndex = currentIndex + 1;
      if (nextIndex >= seriesComics.length) return null;

      return seriesComics[nextIndex];
    } catch (error) {
      console.error('[End Nav] Error getting next comic in series:', error);
      return null;
    }
  }

  /**
   * Get the next comic in the current reading list
   * @returns {Object|null} Next comic object or null if at end of list
   */
  async function getNextComicInReadingList() {
    const context = global.viewerReturnContext;
    if (!context || !context.readingListId) {
      return null;
    }

    const currentComic = global.currentComic;
    if (!currentComic) {
      return null;
    }

    try {
      // Fetch reading list details
      const details = await global.ReadingLists?.getReadingListDetails(context.readingListId);
      if (!details || !details.items || details.items.length === 0) {
        return null;
      }

      // Find current comic index in reading list
      const currentIndex = details.items.findIndex(item => item.comicId === currentComic.id);
      if (currentIndex === -1) {
        return null;
      }

      // Get next comic
      const nextIndex = currentIndex + 1;
      if (nextIndex >= details.items.length) {
        return null;
      }

      const nextItem = details.items[nextIndex];

      // Get the full comic object from the library
      const nextComic = global.getComicById?.(nextItem.comicId);
      if (!nextComic) {
        return null;
      }

      return nextComic;
    } catch (error) {
      console.error('[End Nav] Error getting next comic in reading list:', error);
      return null;
    }
  }

  /**
   * Navigate to the next comic
   * @param {Object} comic - The comic to navigate to
   * @param {Object} options - Navigation options (readingListId, etc.)
   */
  async function navigateToNextComic(comic, options = {}) {
    if (!comic) {
      console.error('[End Nav] No comic provided');
      return;
    }

    if (typeof global.openComicViewer !== 'function') {
      console.error('[End Nav] openComicViewer function not available');
      return;
    }

    try {
      // Open the comic with the same context (reading list if applicable)
      await global.openComicViewer(comic, options);
    } catch (error) {
      console.error('[End Nav] Error navigating to next comic:', error);
    }
  }

  /**
   * Updates the end-of-comic navigation UI visibility and click handlers
   * based on the current page index.
   */
  async function updateEndOfComicNavigation() {
    const nav = document.getElementById('end-of-comic-navigation');
    const seriesBtn = document.getElementById('next-in-series-btn');
    const readingListBtn = document.getElementById('next-in-reading-list-btn');

    const fsNav = document.getElementById('fullscreen-end-of-comic-navigation');
    const fsSeriesBtn = document.getElementById('fullscreen-next-in-series-btn');
    const fsReadingListBtn = document.getElementById('fullscreen-next-in-reading-list-btn');

    const isLastPage = global.currentPageIndex === (global.getPageCounterTotal?.() - 1);

    if (!isLastPage) {
      nav?.classList.add('hidden');
      fsNav?.classList.add('hidden');
      return;
    }

    const nextInList = await getNextComicInReadingList();
    const nextInSeries = await getNextComicInSeries();

    if (!nextInList && !nextInSeries) {
      nav?.classList.add('hidden');
      fsNav?.classList.add('hidden');
      return;
    }

    nav?.classList.remove('hidden');
    fsNav?.classList.remove('hidden');

    if (nextInList) {
      const options = {
        readingListId: global.viewerReturnContext?.readingListId,
        readingListName: global.viewerReturnContext?.readingListName
      };

      if (seriesBtn) seriesBtn.classList.add('hidden');
      if (readingListBtn) {
        readingListBtn.classList.remove('hidden');
        readingListBtn.onclick = () => navigateToNextComic(nextInList, options);
      }

      if (fsSeriesBtn) fsSeriesBtn.classList.add('hidden');
      if (fsReadingListBtn) {
        fsReadingListBtn.classList.remove('hidden');
        fsReadingListBtn.onclick = () => navigateToNextComic(nextInList, options);
      }
    } else if (nextInSeries) {
      if (readingListBtn) readingListBtn.classList.add('hidden');
      if (seriesBtn) {
        seriesBtn.classList.remove('hidden');
        seriesBtn.onclick = () => navigateToNextComic(nextInSeries);
      }

      if (fsReadingListBtn) fsReadingListBtn.classList.add('hidden');
      if (fsSeriesBtn) {
        fsSeriesBtn.classList.remove('hidden');
        fsSeriesBtn.onclick = () => navigateToNextComic(nextInSeries);
      }
    }
  }

  // Expose functions globally
  global.EndNavigation = {
    getNextComicInSeries,
    getNextComicInReadingList,
    navigateToNextComic,
    updateEndOfComicNavigation
  };

  // Also expose directly to window for easier access
  Object.assign(global, {
    getNextComicInSeries,
    getNextComicInReadingList,
    navigateToNextComic,
    updateEndOfComicNavigation
  });

})(typeof window !== 'undefined' ? window : globalThis);
