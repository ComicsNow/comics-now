(function (global) {
  'use strict';

  // Get references from already-loaded modules
  const { ICONS, positionContextMenu, attachCloseHandler, closeContextMenu } = global.ContextMenuBuilder;
  const { toggleMangaMode, updateMangaModeInCache, updateLibraryCache, updateMangaModeUI } = global.MangaMode;

  // Get continuous mode functions if available
  const toggleContinuousMode = global.toggleContinuousMode;
  const updateContinuousModeInCache = global.updateContinuousModeInCache;
  const updateContinuousModeUI = global.updateContinuousModeUI;

  // ============================================================================
  // CONTEXT MENU ACTIONS
  // ============================================================================

  // Create and show context menu
  function showComicContextMenu(event, comic) {
    event.preventDefault();
    event.stopPropagation();

    // Close any existing context menu
    closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'comic-context-menu';

    // 1. Download/Downloaded status menu item
    const isDownloaded = global.downloadedComicIds && global.downloadedComicIds.has(comic.id);
    const downloadIcon = isDownloaded ? ICONS.SUCCESS : ICONS.DOWNLOAD;

    const downloadItem = document.createElement('div');
    downloadItem.className = 'comic-context-menu-item' + (isDownloaded ? ' text-green-400' : '');
    downloadItem.innerHTML = `${downloadIcon}<span>${isDownloaded ? 'Downloaded' : 'Download for Offline'}</span>`;

    if (!isDownloaded) {
      downloadItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        if (typeof global.downloadComic === 'function') {
          try {
            // Create a temporary button element for the download function
            const tempBtn = document.createElement('button');
            await global.downloadComic(comic, tempBtn);

            // Re-render to update UI
            if (typeof global.applyFilterAndRender === 'function') {
              global.applyFilterAndRender();
            }
          } catch (error) {

          }
        }
      });
    } else {
      downloadItem.style.cursor = 'default';
      downloadItem.style.opacity = '0.7';
    }

    menu.appendChild(downloadItem);

    // 2. Read/Unread toggle menu item
    const comicStatus = typeof global.getComicStatus === 'function'
      ? global.getComicStatus(comic)
      : 'unread';
    const isRead = comicStatus === 'read';
    const readIcon = isRead ? ICONS.SUCCESS : ICONS.EYE;

    const readStatusItem = document.createElement('div');
    readStatusItem.className = 'comic-context-menu-item' + (isRead ? ' text-green-400' : '');
    readStatusItem.innerHTML = `${readIcon}<span>Mark as ${isRead ? 'Unread' : 'Read'}</span>`;

    readStatusItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();

      if (typeof global.toggleReadStatus === 'function') {
        try {
          // Create a mock button with the necessary data attributes
          const mockButton = document.createElement('button');
          mockButton.dataset.comicId = comic.id;
          mockButton.dataset.currentStatus = isRead ? 'read' : 'unread';

          await global.toggleReadStatus(mockButton);

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {

        }
      }
    });

    menu.appendChild(readStatusItem);

    // 3. Manga mode toggle menu item
    const mangaMode = comic.mangaMode || false;
    const mangaIcon = mangaMode ? ICONS.CHECKMARK : ICONS.BOOK;

    const mangaModeItem = document.createElement('div');
    mangaModeItem.className = 'comic-context-menu-item' + (mangaMode ? ' manga-active' : '');
    mangaModeItem.innerHTML = `${mangaIcon}<span>${mangaMode ? 'Disable' : 'Enable'} Manga Mode</span>`;

    mangaModeItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();

      try {
        const newMode = await toggleMangaMode(comic.id, mangaMode);

        // Update the comic object
        comic.mangaMode = newMode;

        // Update the global library object if it exists
        if (typeof global.updateComicInLibrary === 'function') {
          global.updateComicInLibrary(comic.id, { mangaMode: newMode });
        }

        // Re-render the current view to reflect changes (without refetching library)
        if (typeof global.applyFilterAndRender === 'function') {
          global.applyFilterAndRender();
        }

        // Update library cache in IndexedDB
        await updateLibraryCache(comic, newMode);

        // If we're in the viewer and this is the current comic, update UI
        if (global.currentComic && global.currentComic.id === comic.id) {
          global.currentComic.mangaMode = newMode;
          updateMangaModeUI(newMode);
        }
      } catch (error) {

        alert('Failed to toggle manga mode. Please try again.');
      }
    });

    menu.appendChild(mangaModeItem);

    // 4. Continuous mode toggle menu item
    if (typeof toggleContinuousMode === 'function') {
      const continuousMode = comic.continuousMode || false;
      const continuousIcon = continuousMode ? ICONS.CHECKMARK : ICONS.SCROLL;

      const continuousModeItem = document.createElement('div');
      continuousModeItem.className = 'comic-context-menu-item' + (continuousMode ? ' continuous-active' : '');
      continuousModeItem.innerHTML = `${continuousIcon}<span>${continuousMode ? 'Disable' : 'Enable'} Continuous Mode</span>`;

      continuousModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = await toggleContinuousMode(comic.id, continuousMode);

          // Update the comic object
          comic.continuousMode = newMode;

          // Update the global library object if it exists
          if (typeof global.updateComicInLibrary === 'function') {
            global.updateComicInLibrary(comic.id, { continuousMode: newMode });
          }

          // Re-render the current view to reflect changes (without refetching library)
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }

          // Update IndexedDB cache if function exists
          if (typeof updateContinuousModeInCache === 'function') {
            await updateContinuousModeInCache(comic.id, newMode);
          }

          // If we're in the viewer and this is the current comic, update UI
          if (global.currentComic && global.currentComic.id === comic.id) {
            global.currentComic.continuousMode = newMode;
            if (typeof updateContinuousModeUI === 'function') {
              updateContinuousModeUI(newMode);
            }
          }
        } catch (error) {
          console.error('Failed to toggle continuous mode:', error);
          alert('Failed to toggle continuous mode. Please try again.');
        }
      });

      menu.appendChild(continuousModeItem);
    }

    // Position menu and attach close handler
    positionContextMenu(menu, event);
    attachCloseHandler(menu);
  }

  // Create and show context menu for series cards
  function showSeriesContextMenu(event, seriesData) {
    event.preventDefault();
    event.stopPropagation();

    // Close any existing context menu
    closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'comic-context-menu';

    const { seriesName, comicsInSeries, rootFolder, publisher } = seriesData;

    // 1. Read/Unread toggle menu item for the entire series
    let isSeriesRead = false;

    if (Array.isArray(comicsInSeries)) {
      // Full data - can access comic details
      isSeriesRead = comicsInSeries.every(comic => {
        const progress = comic.progress || {};
        const total = progress.totalPages || 0;
        const lastRead = progress.lastReadPage || 0;
        return total > 0 && lastRead >= total - 1;
      });
    } else if (comicsInSeries && comicsInSeries._counts) {
      // Lazy loading - use pre-computed counts
      const counts = comicsInSeries._counts;
      isSeriesRead = counts.total > 0 && counts.read === counts.total;
    }

    const readIcon = isSeriesRead ? ICONS.SUCCESS : ICONS.EYE;

    const readStatusItem = document.createElement('div');
    readStatusItem.className = 'comic-context-menu-item' + (isSeriesRead ? ' text-green-400' : '');
    readStatusItem.innerHTML = `${readIcon}<span>Mark Series as ${isSeriesRead ? 'Unread' : 'Read'}</span>`;

    readStatusItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu();

      if (typeof global.toggleReadStatus === 'function') {
        try {
          // Create a mock button with the necessary data attributes for series
          const mockButton = document.createElement('button');
          mockButton.dataset.seriesName = seriesName;
          mockButton.dataset.rootFolder = rootFolder;
          mockButton.dataset.publisher = publisher;
          mockButton.dataset.currentStatus = isSeriesRead ? 'read' : 'unread';

          await global.toggleReadStatus(mockButton);

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {

        }
      }
    });

    menu.appendChild(readStatusItem);

    // 2. Download series menu item
    let isSeriesDownloaded = false;

    if (Array.isArray(comicsInSeries)) {
      // Full data - can check if all comics are downloaded
      isSeriesDownloaded = comicsInSeries.length > 0 &&
        comicsInSeries.every(comic => global.downloadedComicIds && global.downloadedComicIds.has(comic.id));
    }
    // For lazy loading, we can't determine download status without full data

    const downloadIcon = isSeriesDownloaded ? ICONS.SUCCESS : ICONS.DOWNLOAD;

    const downloadItem = document.createElement('div');
    downloadItem.className = 'comic-context-menu-item' + (isSeriesDownloaded ? ' text-green-400' : '');
    downloadItem.innerHTML = `${downloadIcon}<span>${isSeriesDownloaded ? 'Series Downloaded' : 'Download Series'}</span>`;

    if (!isSeriesDownloaded) {
      downloadItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        if (typeof global.downloadSeries === 'function') {
          try {
            // Create a temporary button element for the download function
            const tempBtn = document.createElement('button');
            tempBtn.dataset.rootFolder = rootFolder;
            tempBtn.dataset.publisher = publisher;
            tempBtn.dataset.seriesName = seriesName;

            await global.downloadSeries(comicsInSeries, tempBtn);

            // Re-render to update UI
            if (typeof global.applyFilterAndRender === 'function') {
              global.applyFilterAndRender();
            }
          } catch (error) {

          }
        }
      });
    } else {
      downloadItem.style.cursor = 'default';
      downloadItem.style.opacity = '0.7';
    }

    menu.appendChild(downloadItem);

    // 3. Manga mode toggle for the entire series
    let allComicsAreManga = false;
    let hasComics = false;

    if (Array.isArray(comicsInSeries) && comicsInSeries.length > 0) {
      hasComics = true;
      // Check if all comics have manga mode enabled
      allComicsAreManga = comicsInSeries.every(comic => comic.mangaMode === true);
    }

    // Only show manga option if we have full comic data
    if (hasComics) {
      const mangaIcon = allComicsAreManga ? ICONS.CHECKMARK : ICONS.BOOK;

      const mangaModeItem = document.createElement('div');
      mangaModeItem.className = 'comic-context-menu-item' + (allComicsAreManga ? ' manga-active' : '');
      mangaModeItem.innerHTML = `${mangaIcon}<span>${allComicsAreManga ? 'Unset' : 'Set to'} Manga Mode</span>`;

      mangaModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreManga;

          // Toggle manga mode for all comics in the series
          for (const comic of comicsInSeries) {
            await toggleMangaMode(comic.id, comic.mangaMode || false);
            comic.mangaMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { mangaMode: newMode });
            }
          }

          // Update library cache in IndexedDB
          await updateLibraryCache(comicsInSeries, newMode);

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {

          alert('Failed to toggle manga mode for series. Please try again.');
        }
      });

      menu.appendChild(mangaModeItem);
    }

    // 4. Continuous mode toggle for the entire series
    if (hasComics && typeof toggleContinuousMode === 'function') {
      // Check if all comics have continuous mode enabled
      const allComicsAreContinuous = comicsInSeries.every(comic => comic.continuousMode === true);
      const continuousIcon = allComicsAreContinuous ? ICONS.CHECKMARK : ICONS.SCROLL;

      const continuousModeItem = document.createElement('div');
      continuousModeItem.className = 'comic-context-menu-item' + (allComicsAreContinuous ? ' continuous-active' : '');
      continuousModeItem.innerHTML = `${continuousIcon}<span>${allComicsAreContinuous ? 'Unset' : 'Set to'} Continuous Mode</span>`;

      continuousModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreContinuous;

          // Toggle continuous mode for all comics in the series
          for (const comic of comicsInSeries) {
            await toggleContinuousMode(comic.id, comic.continuousMode || false);
            comic.continuousMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { continuousMode: newMode });
            }
          }

          // Update IndexedDB cache if function exists
          if (typeof updateContinuousModeInCache === 'function') {
            for (const comic of comicsInSeries) {
              await updateContinuousModeInCache(comic.id, newMode);
            }
          }

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {
          console.error('Failed to toggle continuous mode for series:', error);
          alert('Failed to toggle continuous mode for series. Please try again.');
        }
      });

      menu.appendChild(continuousModeItem);
    }

    // Position menu and attach close handler
    positionContextMenu(menu, event);
    attachCloseHandler(menu);
  }

  // Create and show context menu for publisher cards
  function showPublisherContextMenu(event, publisherData) {
    event.preventDefault();
    event.stopPropagation();

    // Close any existing context menu
    closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'comic-context-menu';

    const { publisherName, publisherInfo, rootFolder } = publisherData;

    // Get all comics from all series under this publisher
    let allComics = [];
    if (publisherInfo && publisherInfo.series) {
      for (const seriesName in publisherInfo.series) {
        const comics = publisherInfo.series[seriesName];
        if (Array.isArray(comics)) {
          allComics = allComics.concat(comics);
        }
      }
    }

    // 1. Download publisher menu item
    let isPublisherDownloaded = false;
    if (allComics.length > 0) {
      isPublisherDownloaded = allComics.every(comic => global.downloadedComicIds && global.downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isPublisherDownloaded ? ICONS.SUCCESS : ICONS.DOWNLOAD;

    const downloadItem = document.createElement('div');
    downloadItem.className = 'comic-context-menu-item' + (isPublisherDownloaded ? ' text-green-400' : '');
    downloadItem.innerHTML = `${downloadIcon}<span>${isPublisherDownloaded ? 'Publisher Downloaded' : 'Download Publisher'}</span>`;

    if (!isPublisherDownloaded && allComics.length > 0) {
      downloadItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        if (typeof global.downloadSeries === 'function') {
          try {
            // Download all comics from all series
            const tempBtn = document.createElement('button');
            await global.downloadSeries(allComics, tempBtn);

            // Re-render to update UI
            if (typeof global.applyFilterAndRender === 'function') {
              global.applyFilterAndRender();
            }
          } catch (error) {

          }
        }
      });
    } else {
      downloadItem.style.cursor = 'default';
      downloadItem.style.opacity = '0.7';
    }

    menu.appendChild(downloadItem);

    // 2. Manga mode toggle for the entire publisher
    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }

    const mangaIcon = allComicsAreManga ? ICONS.CHECKMARK : ICONS.BOOK;

    const mangaModeItem = document.createElement('div');
    mangaModeItem.className = 'comic-context-menu-item' + (allComicsAreManga ? ' manga-active' : '');
    mangaModeItem.innerHTML = `${mangaIcon}<span>${allComicsAreManga ? 'Unset' : 'Set to'} Manga Mode</span>`;

    if (allComics.length > 0) {
      mangaModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreManga;

          // Toggle manga mode for all comics in all series
          for (const comic of allComics) {
            await toggleMangaMode(comic.id, comic.mangaMode || false);
            comic.mangaMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { mangaMode: newMode });
            }
          }

          // Update library cache in IndexedDB
          await updateLibraryCache(allComics, newMode);

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {

          alert('Failed to toggle manga mode for publisher. Please try again.');
        }
      });
    } else {
      mangaModeItem.style.cursor = 'default';
      mangaModeItem.style.opacity = '0.7';
    }

    menu.appendChild(mangaModeItem);

    // 3. Continuous mode toggle for the entire publisher
    if (allComics.length > 0 && typeof toggleContinuousMode === 'function') {
      const allComicsAreContinuous = allComics.every(comic => comic.continuousMode === true);
      const continuousIcon = allComicsAreContinuous ? ICONS.CHECKMARK : ICONS.SCROLL;

      const continuousModeItem = document.createElement('div');
      continuousModeItem.className = 'comic-context-menu-item' + (allComicsAreContinuous ? ' continuous-active' : '');
      continuousModeItem.innerHTML = `${continuousIcon}<span>${allComicsAreContinuous ? 'Unset' : 'Set to'} Continuous Mode</span>`;

      continuousModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreContinuous;

          // Toggle continuous mode for all comics in all series
          for (const comic of allComics) {
            await toggleContinuousMode(comic.id, comic.continuousMode || false);
            comic.continuousMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { continuousMode: newMode });
            }
          }

          // Update IndexedDB cache if function exists
          if (typeof updateContinuousModeInCache === 'function') {
            for (const comic of allComics) {
              await updateContinuousModeInCache(comic.id, newMode);
            }
          }

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {
          console.error('Failed to toggle continuous mode for publisher:', error);
          alert('Failed to toggle continuous mode for publisher. Please try again.');
        }
      });

      menu.appendChild(continuousModeItem);
    }

    // Position menu and attach close handler
    positionContextMenu(menu, event);
    attachCloseHandler(menu);
  }

  // Create and show context menu for library/root folder cards
  function showLibraryContextMenu(event, libraryData) {
    event.preventDefault();
    event.stopPropagation();

    // Close any existing context menu
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

    // 1. Download library menu item
    let isLibraryDownloaded = false;
    if (allComics.length > 0) {
      isLibraryDownloaded = allComics.every(comic => global.downloadedComicIds && global.downloadedComicIds.has(comic.id));
    }

    const downloadIcon = isLibraryDownloaded ? ICONS.SUCCESS : ICONS.DOWNLOAD;

    const downloadItem = document.createElement('div');
    downloadItem.className = 'comic-context-menu-item' + (isLibraryDownloaded ? ' text-green-400' : '');
    downloadItem.innerHTML = `${downloadIcon}<span>${isLibraryDownloaded ? 'Library Downloaded' : 'Download Library'}</span>`;

    if (!isLibraryDownloaded && allComics.length > 0) {
      downloadItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        if (typeof global.downloadSeries === 'function') {
          try {
            // Download all comics from all series from all publishers
            const tempBtn = document.createElement('button');
            await global.downloadSeries(allComics, tempBtn);

            // Re-render to update UI
            if (typeof global.applyFilterAndRender === 'function') {
              global.applyFilterAndRender();
            }
          } catch (error) {

          }
        }
      });
    } else {
      downloadItem.style.cursor = 'default';
      downloadItem.style.opacity = '0.7';
    }

    menu.appendChild(downloadItem);

    // 2. Manga mode toggle for the entire library
    let allComicsAreManga = false;
    if (allComics.length > 0) {
      allComicsAreManga = allComics.every(comic => comic.mangaMode === true);
    }

    const mangaIcon = allComicsAreManga ? ICONS.CHECKMARK : ICONS.BOOK;

    const mangaModeItem = document.createElement('div');
    mangaModeItem.className = 'comic-context-menu-item' + (allComicsAreManga ? ' manga-active' : '');
    mangaModeItem.innerHTML = `${mangaIcon}<span>${allComicsAreManga ? 'Unset' : 'Set to'} Manga Mode</span>`;

    if (allComics.length > 0) {
      mangaModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreManga;

          // Toggle manga mode for all comics in all series from all publishers
          for (const comic of allComics) {
            await toggleMangaMode(comic.id, comic.mangaMode || false);
            comic.mangaMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { mangaMode: newMode });
            }
          }

          // Update library cache in IndexedDB
          await updateLibraryCache(allComics, newMode);

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {

          alert('Failed to toggle manga mode for library. Please try again.');
        }
      });
    } else {
      mangaModeItem.style.cursor = 'default';
      mangaModeItem.style.opacity = '0.7';
    }

    menu.appendChild(mangaModeItem);

    // 3. Continuous mode toggle for the entire library
    if (allComics.length > 0 && typeof toggleContinuousMode === 'function') {
      const allComicsAreContinuous = allComics.every(comic => comic.continuousMode === true);
      const continuousIcon = allComicsAreContinuous ? ICONS.CHECKMARK : ICONS.SCROLL;

      const continuousModeItem = document.createElement('div');
      continuousModeItem.className = 'comic-context-menu-item' + (allComicsAreContinuous ? ' continuous-active' : '');
      continuousModeItem.innerHTML = `${continuousIcon}<span>${allComicsAreContinuous ? 'Unset' : 'Set to'} Continuous Mode</span>`;

      continuousModeItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();

        try {
          const newMode = !allComicsAreContinuous;

          // Toggle continuous mode for all comics in all series from all publishers
          for (const comic of allComics) {
            await toggleContinuousMode(comic.id, comic.continuousMode || false);
            comic.continuousMode = newMode;

            // Update the global library object if it exists
            if (typeof global.updateComicInLibrary === 'function') {
              global.updateComicInLibrary(comic.id, { continuousMode: newMode });
            }
          }

          // Update IndexedDB cache if function exists
          if (typeof updateContinuousModeInCache === 'function') {
            for (const comic of allComics) {
              await updateContinuousModeInCache(comic.id, newMode);
            }
          }

          // Re-render to update UI
          if (typeof global.applyFilterAndRender === 'function') {
            global.applyFilterAndRender();
          }
        } catch (error) {
          console.error('Failed to toggle continuous mode for library:', error);
          alert('Failed to toggle continuous mode for library. Please try again.');
        }
      });

      menu.appendChild(continuousModeItem);
    }

    // Position menu and attach close handler
    positionContextMenu(menu, event);
    attachCloseHandler(menu);
  }

  // Expose functions to global scope
  global.showComicContextMenu = showComicContextMenu;
  global.showSeriesContextMenu = showSeriesContextMenu;
  global.showPublisherContextMenu = showPublisherContextMenu;
  global.showLibraryContextMenu = showLibraryContextMenu;
  global.closeContextMenu = closeContextMenu;

})(typeof window !== 'undefined' ? window : globalThis);
