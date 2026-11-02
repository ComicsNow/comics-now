import { getSeriesStatus } from '../../status.js';

/**
 * Returns the status banner HTML string for a series (Read, In Progress, or blank).
 *
 * @param {Array<Object>|Object} comicsInSeries - Array of comic objects or count object
 * @returns {string} HTML string for the banner
 */
export function getSeriesStatusBanner(comicsInSeries) {
  const status = getSeriesStatus(comicsInSeries);
  if (status === 'read') {
    return `<div class="status-banner status-read">Read</div>`;
  }
  if (status === 'in-progress') {
    return `<div class="status-banner status-in-progress">In Progress</div>`;
  }
  return '';
}

/**
 * Returns the manga banner HTML string if all comics in the series are in manga mode.
 *
 * @param {Array<Object>} comicsInSeries - Array of comic objects
 * @returns {string} HTML string for manga badge
 */
export function getSeriesMangaBanner(comicsInSeries) {
  if (Array.isArray(comicsInSeries) && comicsInSeries.length > 0) {
    if (comicsInSeries.every(comic => comic.mangaMode === true)) {
      return `<div class="status-banner status-manga">Manga</div>`;
    }
  }
  return '';
}
