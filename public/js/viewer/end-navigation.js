/**
 * End of Comic Navigation
 * Handles navigation to next comic in series or reading list when reaching the end
 */
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
   * available, otherwise locates the comic in the library by ID.
   * Lives side-by-side with reading list navigation.
   * @returns {Object|null} Next comic object or null if at end of series / unavailable.
   */
  async function getNextComicInSeries() {
    const currentComic = global.currentComic;
    if (!currentComic) return null;

    let rootFolder = global.viewerReturnContext?.rootFolder || currentComic.rootFolder || null;
    let publisher = global.viewerReturnContext?.publisher || currentComic.publisher || null;
    let series = global.viewerReturnContext?.series || currentComic.series || null;

    if (!rootFolder || !publisher || !series) {
      const found = locateComicInLibrary(currentComic.id);
      if (found) {
        rootFolder = rootFolder || found.rootFolder;
        publisher = publisher || found.publisher;
        series = series || found.series;
      }
    }

    if (!series) return null;

    try {
      const seriesComics = await global.getSeriesComics?.(rootFolder, publisher, series);
      if (!Array.isArray(seriesComics) || seriesComics.length === 0) return null;

      const currentIndex = seriesComics.findIndex(comic => comic && String(comic.id) === String(currentComic.id));
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
   * Dynamically tracks real-time list order.
   * @returns {Object|null} Next comic object or null if at end of list
   */
  async function getNextComicInReadingList() {
    const currentComic = global.currentComic;
    if (!currentComic) {
      return null;
    }

    let readingListId = global.viewerReturnContext?.readingListId || null;
    let readingListName = global.viewerReturnContext?.readingListName || null;

    try {
      // If no readingListId in context, search user's reading lists as a fallback
      if (!readingListId && global.ReadingLists?.getReadingLists) {
        try {
          const res = await global.ReadingLists.getReadingLists();
          const lists = res?.lists || res || [];
          for (const l of lists) {
            const d = await global.ReadingLists.getReadingListDetails(l.id);
            if (d?.items && Array.isArray(d.items)) {
              if (d.items.some(item => String(item.comicId) === String(currentComic.id))) {
                readingListId = l.id;
                readingListName = l.name;
                break;
              }
            }
          }
        } catch (e) {
          // ignore fallback lookup errors
        }
      }

      if (!readingListId) {
        return null;
      }

      // Fetch fresh reading list details to always follow real-time sort order
      let details = null;
      if (global.ReadingLists?.getReadingListDetails) {
        details = await global.ReadingLists.getReadingListDetails(readingListId);
      } else {
        const baseUrl = typeof window !== 'undefined' && window.getBaseUrl ? window.getBaseUrl() : '';
        const response = await fetch(`${baseUrl}/api/v1/reading-lists/${readingListId}`);
        if (response.ok) {
          details = await response.json();
        }
      }

      if (!details || !details.items || !Array.isArray(details.items) || details.items.length === 0) {
        return null;
      }

      // Find current comic index in reading list (items are sorted by sortOrder ASC)
      const currentIndex = details.items.findIndex(item => String(item.comicId) === String(currentComic.id));
      if (currentIndex === -1) {
        return null;
      }

      // Get next comic
      const nextIndex = currentIndex + 1;
      if (nextIndex >= details.items.length) {
        return null;
      }

      const nextItem = details.items[nextIndex];

      // Get the full comic object from library or fallback API fetch
      let nextComic = global.getComicById?.(nextItem.comicId);
      if (!nextComic) {
        try {
          const baseUrl = typeof window !== 'undefined' && window.getBaseUrl ? window.getBaseUrl() : '';
          const cResp = await fetch(`${baseUrl}/api/comics/${nextItem.comicId}`);
          if (cResp.ok) {
            nextComic = await cResp.json();
          }
        } catch (e) {}
      }

      if (!nextComic) {
        nextComic = { id: nextItem.comicId, name: nextItem.name || 'Next Comic' };
      }

      nextComic._readingListContext = {
        readingListId,
        readingListName: readingListName || details.list?.name || 'Reading List'
      };

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
   * Both Next in Series and Next in Reading List live side-by-side.
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

    // Next in Series button
    if (nextInSeries) {
      if (seriesBtn) {
        seriesBtn.classList.remove('hidden');
        seriesBtn.onclick = () => navigateToNextComic(nextInSeries);
      }
      if (fsSeriesBtn) {
        fsSeriesBtn.classList.remove('hidden');
        fsSeriesBtn.onclick = () => navigateToNextComic(nextInSeries);
      }
    } else {
      if (seriesBtn) seriesBtn.classList.add('hidden');
      if (fsSeriesBtn) fsSeriesBtn.classList.add('hidden');
    }

    // Next in Reading List button (lives side-by-side with Next in Series)
    if (nextInList) {
      const options = nextInList._readingListContext || {
        readingListId: global.viewerReturnContext?.readingListId,
        readingListName: global.viewerReturnContext?.readingListName
      };

      if (readingListBtn) {
        readingListBtn.classList.remove('hidden');
        readingListBtn.onclick = () => navigateToNextComic(nextInList, options);
      }
      if (fsReadingListBtn) {
        fsReadingListBtn.classList.remove('hidden');
        fsReadingListBtn.onclick = () => navigateToNextComic(nextInList, options);
      }
    } else {
      if (readingListBtn) readingListBtn.classList.add('hidden');
      if (fsReadingListBtn) fsReadingListBtn.classList.add('hidden');
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('reading-list-reordered', () => {
      const isLastPage = global.currentPageIndex === (global.getPageCounterTotal?.() - 1);
      if (isLastPage) {
        updateEndOfComicNavigation();
      }
    });
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

export {
  locateComicInLibrary,
  getNextComicInSeries,
  getNextComicInReadingList,
  navigateToNextComic,
  updateEndOfComicNavigation
};

state.EndNavigation = global.EndNavigation;
state.getNextComicInSeries = getNextComicInSeries;
state.getNextComicInReadingList = getNextComicInReadingList;
state.navigateToNextComic = navigateToNextComic;
state.updateEndOfComicNavigation = updateEndOfComicNavigation;

if (typeof window !== 'undefined') {
  window.EndNavigation = global.EndNavigation;
  window.getNextComicInSeries = getNextComicInSeries;
  window.getNextComicInReadingList = getNextComicInReadingList;
  window.navigateToNextComic = navigateToNextComic;
  window.updateEndOfComicNavigation = updateEndOfComicNavigation;
}
