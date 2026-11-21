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

  // 5. Change Publisher Logo (Admin)
  const sync = window.syncManager || state.syncManager;
  const isAdmin = !sync?.authEnabled || sync?.userRole === 'admin' || state.userRole === 'admin' || window.userRole === 'admin';
  if (isAdmin) {
    const logoItem = document.createElement('div');
    logoItem.className = 'comic-context-menu-item';
    logoItem.innerHTML = '<span>🎨</span><span>Change Publisher Logo</span>';
    logoItem.addEventListener('click', () => {
      closeContextMenu();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.svg,.png,.webp,.jpg,.jpeg';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = String(reader.result || '');
            const base = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl)
              ? window.APP_CONFIG.baseUrl.replace(/\/$/, '')
              : '';
            const res = await fetch(`${base}/api/admin/publishers/logos/upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                publisher: publisherName,
                filename: file.name,
                data: base64,
                mimeType: file.type
              })
            });
            if (res.ok) {
              const data = await res.json();
              window.dispatchEvent(new CustomEvent('PUBLISHER_LOGO_UPDATED', {
                detail: {
                  publisher: publisherName,
                  logoUrl: data.logo
                }
              }));
            }
          } catch (err) {
            console.error('Failed to upload publisher logo:', err);
          }
        };
        reader.readAsDataURL(file);
      });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 1000);
    });
    menu.appendChild(logoItem);
  }

  positionContextMenu(menu, event);
  attachCloseHandler(menu);
}

// Expose function to global scope for cross-phase compatibility
export { showPublisherContextMenu };
state.showPublisherContextMenu = showPublisherContextMenu;
if (typeof window !== 'undefined') {
  window.showPublisherContextMenu = showPublisherContextMenu;
}
