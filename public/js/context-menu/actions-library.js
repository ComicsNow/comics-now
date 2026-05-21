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
 * Create and show context menu for library/root folder cards
 */
function showLibraryContextMenu(event, libraryData) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'comic-context-menu';

  const { folderPath, rootData } = libraryData;

  // Get all comics from all publishers and all series under this library
  let allComics = [];
  if (rootData && rootData.publishers) {
    for (const publisherName in rootData.publishers) {
      const publisherData = rootData.publishers[publisherName];
      if (publisherData && publisherData.series) {
        for (const seriesName in publisherData.series) {
          const comics = publisherData.series[seriesName];
          if (Array.isArray(comics)) {
            allComics = allComics.concat(comics);
          }
        }
      }
    }
  }

  const libLabel = (folderPath || '').split(/[\\\/]/).filter(Boolean).pop() || 'library';

  // 0. Bulk Read
  const bulkItem = createBulkReadItem(allComics, `library "${libLabel}"`);
  if (bulkItem) menu.appendChild(bulkItem);

  // 1. Download (mobile only)
  const downloadItem = createDownloadItem(allComics, { label: 'Library' });
  if (downloadItem) menu.appendChild(downloadItem);

  // 2. Manga Mode
  const mangaItem = createMangaToggleItem(allComics, 'Library');
  if (mangaItem) menu.appendChild(mangaItem);

  // 3. Continuous Mode
  const continuousItem = createContinuousToggleItem(allComics, 'Library');
  if (continuousItem) menu.appendChild(continuousItem);

  // 3b. Guided Detection
  const guidedItem = createGuidedDetectionItem('library', folderPath, `library '${folderPath || 'root'}'`, allComics);
  if (guidedItem) menu.appendChild(guidedItem);

  // 4. Reading List
  const readingItem = createReadingListItem(allComics);
  if (readingItem) menu.appendChild(readingItem);

  positionContextMenu(menu, event);
  attachCloseHandler(menu);
}

// Expose function to global scope for cross-module compatibility
export { showLibraryContextMenu };
state.showLibraryContextMenu = showLibraryContextMenu;
if (typeof window !== 'undefined') {
  window.showLibraryContextMenu = showLibraryContextMenu;
}
