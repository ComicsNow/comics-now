/**
 * End of Comic Navigation
 * Handles navigation to next comic in series or reading list when reaching the end
 */
(function(global) {
  'use strict';

  /**
   * Get the next comic in the current series
   * @returns {Object|null} Next comic object or null if at end of series
   */
  async function getNextComicInSeries() {
    const context = global.viewerReturnContext;
    if (!context || !context.rootFolder || !context.publisher || !context.series) {
      console.log('[End Nav] No series context available');
      return null;
    }

    const currentComic = global.currentComic;
    if (!currentComic) {
      console.log('[End Nav] No current comic');
      return null;
    }

    try {
      // Get all comics in the series
      const seriesComics = await global.getSeriesComics?.(
        context.rootFolder,
        context.publisher,
        context.series
      );

      if (!Array.isArray(seriesComics) || seriesComics.length === 0) {
        console.log('[End Nav] No comics found in series');
        return null;
      }

      // Find current comic index
      const currentIndex = seriesComics.findIndex(comic => comic.id === currentComic.id);
      if (currentIndex === -1) {
        console.log('[End Nav] Current comic not found in series');
        return null;
      }

      // Get next comic
      const nextIndex = currentIndex + 1;
      if (nextIndex >= seriesComics.length) {
        console.log('[End Nav] At end of series');
        return null;
      }

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
      console.log('[End Nav] No reading list context available');
      return null;
    }

    const currentComic = global.currentComic;
    if (!currentComic) {
      console.log('[End Nav] No current comic');
      return null;
    }

    try {
      // Fetch reading list details
      const details = await global.ReadingLists?.getReadingListDetails(context.readingListId);
      if (!details || !details.items || details.items.length === 0) {
        console.log('[End Nav] No items in reading list');
        return null;
      }

      // Find current comic index in reading list
      const currentIndex = details.items.findIndex(item => item.comicId === currentComic.id);
      if (currentIndex === -1) {
        console.log('[End Nav] Current comic not found in reading list');
        return null;
      }

      // Get next comic
      const nextIndex = currentIndex + 1;
      if (nextIndex >= details.items.length) {
        console.log('[End Nav] At end of reading list');
        return null;
      }

      const nextItem = details.items[nextIndex];

      // Get the full comic object from the library
      const nextComic = global.getComicById?.(nextItem.comicId);
      if (!nextComic) {
        console.log('[End Nav] Next comic not found in library');
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
      console.log('[End Nav] Navigated to next comic:', comic.name);
    } catch (error) {
      console.error('[End Nav] Error navigating to next comic:', error);
    }
  }

  // Expose functions globally
  global.EndNavigation = {
    getNextComicInSeries,
    getNextComicInReadingList,
    navigateToNextComic
  };

  // Also expose directly to window for easier access
  Object.assign(global, {
    getNextComicInSeries,
    getNextComicInReadingList,
    navigateToNextComic
  });

})(typeof window !== 'undefined' ? window : globalThis);
