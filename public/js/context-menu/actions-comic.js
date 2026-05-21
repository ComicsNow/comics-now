import { state } from '../globals.js';
import { positionContextMenu, attachCloseHandler, closeContextMenu } from './menu-builder.js';
import {
  createDownloadItem,
  createReadStatusItem,
  createMangaToggleItem,
  createContinuousToggleItem,
  createGuidedDetectionItem,
  createReadingListItem
} from './actions-shared.js';

/**
 * Create and show context menu for comic cards
 */
function showComicContextMenu(event, comic) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'comic-context-menu';

  const isLocal = comic.handle || comic.file || (comic.id && String(comic.id).startsWith('device-'));

  // 1. Download (mobile only)
  if (!isLocal) {
    const downloadItem = createDownloadItem(comic);
    if (downloadItem) menu.appendChild(downloadItem);
  }

  // 2. Read/Unread
  if (!isLocal) {
    menu.appendChild(createReadStatusItem(comic));
  }

  // 3. Manga Mode
  menu.appendChild(createMangaToggleItem(comic));

  // 4. Continuous Mode
  const continuousItem = createContinuousToggleItem(comic);
  if (continuousItem) menu.appendChild(continuousItem);

  // 5. Guided Detection
  const guidedItem = createGuidedDetectionItem('comic', comic.id, comic.name || 'this comic', comic);
  if (guidedItem) menu.appendChild(guidedItem);

  // 6. Reading List
  menu.appendChild(createReadingListItem(comic));

  positionContextMenu(menu, event);
  attachCloseHandler(menu);
}

// Expose function for cross-phase compatibility
export { showComicContextMenu };
state.showComicContextMenu = showComicContextMenu;
if (typeof window !== 'undefined') {
  window.showComicContextMenu = showComicContextMenu;
}
