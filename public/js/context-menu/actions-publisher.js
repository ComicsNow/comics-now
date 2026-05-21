import { state } from '../globals.js';
import { positionContextMenu, attachCloseHandler, closeContextMenu } from './menu-builder.js';
import {
  createDownloadItem,
  createBulkReadItem,
  createMangaToggleItem,
  createContinuousToggleItem,
  createGuidedDetectionItem,
  createReadingListItem
} from './actions-shared.js';

/**
 * Create and show context menu for publisher cards
 */
function showPublisherContextMenu(event, publisherData) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'comic-context-menu';

  const { publisherName, publisherInfo } = publisherData;
  const series = publisherInfo?.series;

  // Get all comics from all series under this publisher
  let allComics = [];
  if (series) {
    for (const seriesName in series) {
      const comics = series[seriesName];
      if (Array.isArray(comics)) {
        allComics = allComics.concat(comics);
      }
    }
  }

  // 0. Bulk Read
  const bulkItem = createBulkReadItem(allComics, `publisher "${publisherName}"`);
  if (bulkItem) menu.appendChild(bulkItem);

  // 1. Download (mobile only)
  const downloadItem = createDownloadItem(allComics, { label: 'Publisher' });
  if (downloadItem) menu.appendChild(downloadItem);

  // 2. Manga Mode
  const mangaItem = createMangaToggleItem(allComics, 'Publisher');
  if (mangaItem) menu.appendChild(mangaItem);

  // 3. Continuous Mode
  const continuousItem = createContinuousToggleItem(allComics, 'Publisher');
  if (continuousItem) menu.appendChild(continuousItem);

  // 3b. Guided Detection
  const guidedItem = createGuidedDetectionItem('publisher', publisherName, `publisher '${publisherName}'`, allComics);
  if (guidedItem) menu.appendChild(guidedItem);

  // 4. Reading List
  const readingItem = createReadingListItem(allComics);
  if (readingItem) menu.appendChild(readingItem);

  positionContextMenu(menu, event);
  attachCloseHandler(menu);
}

// Expose function to global scope for cross-phase compatibility
export { showPublisherContextMenu };
state.showPublisherContextMenu = showPublisherContextMenu;
if (typeof window !== 'undefined') {
  window.showPublisherContextMenu = showPublisherContextMenu;
}
