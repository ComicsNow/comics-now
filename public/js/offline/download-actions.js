(function (global) {
  'use strict';

  /**
   * Download a comic using the background download manager
   * @param {Object} comic - Comic object
   * @param {HTMLElement} btn - Download button element
   * @returns {Promise<boolean>}
   */
  async function downloadComic(comic, btn) {
    const downloadManager = global.downloadManager;
    try {
      // Block downloads on desktop devices
      if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
        alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
        return false;
      }

      // Skip if already downloaded
      if (global.downloadedComicIds?.has(comic.id)) {
        return true;
      }

      // Update button UI immediately
      if (btn) {
        btn._origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
               viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
            <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="text-xs">Queued</span>`;
      }

      // Add to background download queue
      if (downloadManager) {
        await downloadManager.addToQueue(comic);
      } else {
        throw new Error('Download manager not initialized');
      }

      return true;
    } catch (error) {
      console.error('[DOWNLOAD] Error adding to queue:', error);

      // Restore button on error
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn._origHtml || btn.innerHTML;
      }

      alert('Failed to add comic to download queue.');
      return false;
    }
  }

  /**
   * Download all comics in a series using the background download manager
   * @param {Array|Object} comics - Array of comics or series object
   * @param {HTMLElement} btn - Download button element
   */
  async function downloadSeries(comics, btn) {
    if (!btn) return;
    const downloadManager = global.downloadManager;

    // Block downloads on desktop devices
    if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
      alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
      return false;
    }

    try {
      let comicsToDownload = [];

      // Handle different input formats
      if (Array.isArray(comics)) {
        comicsToDownload = comics;
      } else if (comics && comics._hasDetails === false) {
        const { dataset } = btn;
        if (!dataset.rootFolder || !dataset.publisher || !dataset.seriesName) {
          throw new Error('Missing series information for download');
        }
        if (typeof getSeriesComics === 'function') {
          comicsToDownload = await getSeriesComics(dataset.rootFolder, dataset.publisher, dataset.seriesName);
        } else {
          throw new Error('Cannot load series details - getSeriesComics not available');
        }
      } else {
        throw new Error('Invalid comics data format');
      }

      // Confirmation before kicking off a bulk download
      const queueable = comicsToDownload.filter(c => !global.downloadedComicIds?.has(c.id));
      if (queueable.length === 0) {
        alert('All comics in this selection are already downloaded.');
        return false;
      }
      const ds = btn.dataset || {};
      let scopeLabel = '';
      if (ds.seriesName) scopeLabel = `series "${ds.seriesName}"`;
      else if (ds.publisher) scopeLabel = `publisher "${ds.publisher}"`;
      else if (ds.rootFolder) scopeLabel = `library "${ds.rootFolder.split('/').filter(Boolean).pop() || ds.rootFolder}"`;
      const promptMsg = scopeLabel
        ? `Queue ${queueable.length} comic${queueable.length === 1 ? '' : 's'} from ${scopeLabel} for download?`
        : `Queue ${queueable.length} comic${queueable.length === 1 ? '' : 's'} for download?`;
      if (!window.confirm(promptMsg)) {
        return false;
      }

      btn._origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
             viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
          <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span class="text-xs">Queueing...</span>`;

      // Add queueable comics
      let queuedCount = 0;
      if (downloadManager) {
        for (const comic of queueable) {
          await downloadManager.addToQueue(comic);
          queuedCount++;
        }
      } else {
        throw new Error('Download manager not initialized');
      }

      // Update button to show queued
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs">${queuedCount} queued</span>`;


      // Re-enable button after queueing
      setTimeout(() => {
        btn.disabled = false;
      }, 2000);

    } catch (error) {
      console.error('[DOWNLOAD] Series download error:', error);
      alert('Failed to queue series for download.');
      btn.disabled = false;
      btn.innerHTML = btn._origHtml;
    }
  }

  /**
   * Download all comics in a reading list
   * @param {number} listId - The reading list ID
   * @param {string} listName - The reading list name (for user feedback)
   * @param {HTMLElement} btn - The button element to update
   */
  async function downloadReadingList(listId, listName, btn) {
    if (!btn) return;
    const downloadManager = global.downloadManager;

    // Block downloads on desktop devices
    if (typeof isDesktopDevice === 'function' && isDesktopDevice()) {
      alert('Comic downloads are only available on mobile devices.\n\nUse a mobile device or tablet to download comics for offline reading.');
      return false;
    }

    // Check if library is loaded
    if (!global.library || Object.keys(global.library).length === 0) {
      alert('Library is still loading. Please wait a moment and try again.');
      return false;
    }

    btn._origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6"
           viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke-width="2" opacity=".5"/>
        <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 14v-4" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="text-xs">Queueing...</span>`;

    try {
      // Fetch reading list details
      if (typeof global.ReadingLists?.getReadingListDetails !== 'function') {
        throw new Error('Reading list API not available');
      }

      const listDetails = await global.ReadingLists.getReadingListDetails(listId);
      if (!listDetails || !listDetails.items || listDetails.items.length === 0) {
        throw new Error('Reading list is empty or not found');
      }

      // Convert comic IDs to full comic objects
      const comicsToDownload = [];
      for (const item of listDetails.items) {
        if (typeof global.getComicById === 'function') {
          const comic = global.getComicById(item.comicId);
          if (comic) {
            comicsToDownload.push(comic);
          }
        }
      }

      if (comicsToDownload.length === 0) {
        throw new Error('No comics found in library. They may have been moved or deleted.');
      }

      // Add all comics to queue
      let queuedCount = 0;
      if (downloadManager) {
        for (const comic of comicsToDownload) {
          if (!global.downloadedComicIds?.has(comic.id)) {
            await downloadManager.addToQueue(comic);
            queuedCount++;
          }
        }
      } else {
        throw new Error('Download manager not initialized');
      }

      // Update button to show queued
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <span class="text-xs">${queuedCount} queued</span>`;


      // Re-enable button and revert after delay
      setTimeout(() => {
        btn.disabled = false;
        if (btn._origHtml) {
          btn.innerHTML = btn._origHtml;
        }
      }, 3000);

    } catch (error) {
      console.error('[DOWNLOAD] Reading list download error:', error);
      alert('Failed to queue reading list for download: ' + error.message);
      btn.disabled = false;
      if (btn._origHtml) {
        btn.innerHTML = btn._origHtml;
      }
    }
  }

  global.downloadComic = downloadComic;
  global.downloadSeries = downloadSeries;
  global.downloadReadingList = downloadReadingList;

})(typeof window !== 'undefined' ? window : globalThis);
