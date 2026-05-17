(function (global) {
  'use strict';

  // Get references from already-loaded modules
  const { positionContextMenu, attachCloseHandler, closeContextMenu } = global.ContextMenuBuilder;

  // Destructure shared factories from global (provided by actions-shared.js)
  const {
    createDownloadItem,
    createBulkReadItem,
    createMangaToggleItem,
    createContinuousToggleItem,
    createGuidedDetectionItem,
    createReadingListItem
  } = global;

  /**
   * Create and show context menu for arbitrary folders
   */
  function showFolderContextMenu(event, folderData) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();

    const { folderPath, folderName } = folderData;
    
    // Find all comics recursively under this folder path
    // We normalize the folder path and ensure it ends with a separator for prefix matching
    const normFolder = folderPath.replace(/[\\\/]+$/, '').replace(/\\/g, '/') + '/';
    const allComics = [];
    
    if (global.comicIdMap) {
      for (const comic of global.comicIdMap.values()) {
        const normComicPath = (comic.path || '').replace(/\\/g, '/');
        if (normComicPath.startsWith(normFolder) || normComicPath === normFolder.slice(0, -1)) {
          allComics.push(comic);
        }
      }
    }

    if (allComics.length === 0) {
      console.warn('[FOLDER CONTEXT] No comics found under path:', folderPath);
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'comic-context-menu';

    const isLocal = folderPath && String(folderPath).startsWith('device-');

    // 0. Bulk Read
    if (!isLocal) {
      const bulkItem = createBulkReadItem(allComics, `folder "${folderName}"`);
      if (bulkItem) menu.appendChild(bulkItem);
    }

    // 1. Download (mobile only)
    if (!isLocal) {
      const downloadItem = createDownloadItem(allComics, { label: 'Folder Contents' });
      if (downloadItem) menu.appendChild(downloadItem);
    }

    // 2. Manga Mode
    const mangaItem = createMangaToggleItem(allComics, 'Folder');
    if (mangaItem) menu.appendChild(mangaItem);

    // 3. Continuous Mode
    const continuousItem = createContinuousToggleItem(allComics, 'Folder');
    if (continuousItem) menu.appendChild(continuousItem);

    // 3b. Guided Detection
    const guidedItem = createGuidedDetectionItem('folder', folderPath, `folder '${folderName}'`, allComics);
    if (guidedItem) menu.appendChild(guidedItem);

    // 4. Reading List
    const readingItem = createReadingListItem(allComics);
    if (readingItem) menu.appendChild(readingItem);

    positionContextMenu(menu, event);
    attachCloseHandler(menu);
  }

  // Expose function to global scope
  global.showFolderContextMenu = showFolderContextMenu;

})(typeof window !== 'undefined' ? window : globalThis);
