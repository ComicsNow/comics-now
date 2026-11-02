/**
 * Comics Now! - Library Progress & Lazy Load Counts
 *
 * Updates in-memory comic progress and adjusts publisher/series lazy-load status counts.
 */

import { state, debugLog } from '../globals.js';

export function updateLocalProgressAndCounts(comicId, page) {
  if (!state || !state.library) return;

  let comic = null;
  let rootFolder = null;
  let publisher = null;
  let seriesName = null;
  let oldStatus = null;
  let newStatus = null;

  for (const rootFolderKey of Object.keys(state.library)) {
    for (const publisherKey of Object.keys(state.library[rootFolderKey].publishers || {})) {
      for (const seriesKey of Object.keys(state.library[rootFolderKey].publishers[publisherKey].series || {})) {
        const seriesData = state.library[rootFolderKey].publishers[publisherKey].series[seriesKey];

        if (Array.isArray(seriesData)) {
          const foundComic = seriesData.find(c => c.id === comicId);
          if (foundComic) {
            comic = foundComic;
            rootFolder = rootFolderKey;
            publisher = publisherKey;
            seriesName = seriesKey;
            break;
          }
        }
      }
      if (comic) break;
    }
    if (comic) break;
  }

  if (comic && comic.progress) {
    const getComicStatusFn = state.getComicStatus || (typeof window !== 'undefined' ? window.getComicStatus : null);
    if (typeof getComicStatusFn === 'function') {
      oldStatus = getComicStatusFn(comic);
    }

    comic.progress.lastReadPage = page;

    if (typeof getComicStatusFn === 'function') {
      newStatus = getComicStatusFn(comic);
    }

    if (oldStatus !== newStatus && state.library._isLazyLoaded && rootFolder && publisher && seriesName) {
      const seriesData = state.library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
      const publisherData = state.library[rootFolder]?.publishers?.[publisher];

      if (seriesData && seriesData._counts) {
        if (oldStatus && seriesData._counts[oldStatus] > 0) {
          seriesData._counts[oldStatus]--;
        }
        if (newStatus) {
          seriesData._counts[newStatus]++;
        }

        if (publisherData && publisherData._counts) {
          if (oldStatus && publisherData._counts[oldStatus] > 0) {
            publisherData._counts[oldStatus]--;
          }
          if (newStatus) {
            publisherData._counts[newStatus]++;
          }
        }

        debugLog('SYNC', `Updated counts: ${oldStatus} -> ${newStatus} for ${seriesName}`);
      }
    }
  }
}
