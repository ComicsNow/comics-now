import { state } from '../globals.js';
import { positionContextMenu, attachCloseHandler, closeContextMenu } from './menu-builder.js';
import {
  createBulkReadItem,
  createMangaToggleItem,
  createContinuousToggleItem,
  createGuidedDetectionItem,
  createReadingListItem
} from './actions-shared.js';

/**
 * Create and show context menu for series cards
 */
function showSeriesContextMenu(event, seriesData) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'comic-context-menu';

  const { seriesName, comicsInSeries } = seriesData;

  // 0. Bulk Read
  const bulkItem = createBulkReadItem(comicsInSeries, `series "${seriesName}"`);
  if (bulkItem) menu.appendChild(bulkItem);

  // 1. Download (mobile only)

  // 3. Manga Mode
  const mangaItem = createMangaToggleItem(comicsInSeries, 'Series');
  if (mangaItem) menu.appendChild(mangaItem);

  // 4. Continuous Mode
  const continuousItem = createContinuousToggleItem(comicsInSeries, 'Series');
  if (continuousItem) menu.appendChild(continuousItem);

  // 5. Guided Detection
  const guidedItem = createGuidedDetectionItem('series', seriesName, `series '${seriesName}'`, comicsInSeries);
  if (guidedItem) menu.appendChild(guidedItem);

  // 6. Reading List
  const readingItem = createReadingListItem(comicsInSeries);
  if (readingItem) menu.appendChild(readingItem);

  positionContextMenu(menu, event);
  attachCloseHandler(menu);
}

// Expose function to global scope
export { showSeriesContextMenu };
state.showSeriesContextMenu = showSeriesContextMenu;
if (typeof window !== 'undefined') {
  window.showSeriesContextMenu = showSeriesContextMenu;
}
