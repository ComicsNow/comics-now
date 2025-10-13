// --- PROGRESS TRACKING SYSTEM ---
// Navigation, rendering, and fullscreen handling live in viewer.js. This module
// now focuses on persistence helpers and wiring progress-related UI events.

// Save progress to IndexedDB (for downloaded comics)
async function saveProgressToDB(comicId, currentPage, totalPages, comicPath) {
  if (!db) {
    debugLog('PROGRESS', 'IndexedDB not initialized, opening connection...');
    await openOfflineDB();
  }

  const normalizedPage = typeof currentPage === 'number' && !Number.isNaN(currentPage)
    ? currentPage
    : 0;
  const progressData = {
    id: comicId,
    lastReadPage: normalizedPage,
    page: normalizedPage,
    synced: false,
    updatedAt: new Date().toISOString()
  };

  if (typeof totalPages === 'number' && !Number.isNaN(totalPages)) {
    progressData.totalPages = totalPages;
  }

  if (typeof comicPath === 'string' && comicPath.length > 0) {
    progressData.comicPath = comicPath;
  }

  debugLog('PROGRESS', 'Saving to IndexedDB:', progressData);

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(['progress', 'comics'], 'readwrite');
      const progressStore = transaction.objectStore('progress');
      const comicsStore = transaction.objectStore('comics');

      const keysToUpdate = [];
      if (comicId !== undefined && comicId !== null) {
        keysToUpdate.push(comicId);
        const idStr = String(comicId);
        if (!keysToUpdate.some(key => key === idStr)) {
          keysToUpdate.push(idStr);
        }
        const idNum = Number(idStr);
        if (!Number.isNaN(idNum) && !keysToUpdate.some(key => key === idNum)) {
          keysToUpdate.push(idNum);
        }
      }

      progressStore.put(progressData);

      const updateNextComicRecord = (index = 0) => {
        if (index >= keysToUpdate.length) {
          return;
        }

        let request;
        try {
          request = comicsStore.get(keysToUpdate[index]);
        } catch (error) {
          
          updateNextComicRecord(index + 1);
          return;
        }

        request.onsuccess = () => {
          const comicData = request.result;
          if (comicData && comicData.comicInfo) {
            if (!comicData.comicInfo.progress) {
              comicData.comicInfo.progress = {};
            }
            comicData.comicInfo.progress.lastReadPage = normalizedPage;
            if (typeof totalPages === 'number' && !Number.isNaN(totalPages)) {
              comicData.comicInfo.progress.totalPages = totalPages;
            }
            if (typeof comicPath === 'string' && comicPath.length > 0) {
              comicData.comicInfo.path = comicPath;
            }
            try {
              comicsStore.put(comicData);
            } catch (error) {
              
            }
          } else {
            updateNextComicRecord(index + 1);
          }
        };

        request.onerror = () => {
          updateNextComicRecord(index + 1);
        };
      };

      updateNextComicRecord();

      transaction.oncomplete = () => {
        debugLog('PROGRESS', `Successfully saved progress to IndexedDB for comic ${comicId}`);
        if (typeof scheduleOfflineProgressSync === 'function') {
          scheduleOfflineProgressSync(true);
        }
        resolve();
      };

      transaction.onerror = (event) => {
        
        reject(new Error('IndexedDB transaction failed: ' + event.target.error));
      };
    } catch (error) {
      
      reject(error);
    }
  });
}

// Update the in-memory library with new progress data
function updateLibraryProgress(comicId, progressData, maybeTotalPages) {
  if (!library) return;

  const targetId = comicId == null ? null : String(comicId);
  if (!targetId) return;

  let lastReadPage;
  let totalPages;

  if (progressData && typeof progressData === 'object') {
    if (typeof progressData.lastReadPage === 'number' && !Number.isNaN(progressData.lastReadPage)) {
      lastReadPage = progressData.lastReadPage;
    } else if (typeof progressData.page === 'number' && !Number.isNaN(progressData.page)) {
      lastReadPage = progressData.page;
    }

    if (typeof progressData.totalPages === 'number' && !Number.isNaN(progressData.totalPages)) {
      totalPages = progressData.totalPages;
    }
  } else if (typeof progressData === 'number' && !Number.isNaN(progressData)) {
    lastReadPage = progressData;
    if (typeof maybeTotalPages === 'number' && !Number.isNaN(maybeTotalPages)) {
      totalPages = maybeTotalPages;
    }
  }

  if (typeof lastReadPage !== 'number') {
    lastReadPage = 0;
  }

  const numericTarget = Number(targetId);
  const hasNumericTarget = !Number.isNaN(numericTarget);

  for (const rootDir in library) {
    const publishers = library[rootDir]?.publishers;
    if (!publishers) continue;

    for (const publisherName in publishers) {
      const seriesCollection = publishers[publisherName]?.series;
      if (!seriesCollection) continue;

      for (const seriesName in seriesCollection) {
        const comics = seriesCollection[seriesName];
        if (!Array.isArray(comics)) continue;

        const comic = comics.find(c => {
          const comicIdValue = c?.id;
          if (comicIdValue == null) return false;
          if (String(comicIdValue) === targetId) return true;
          if (!hasNumericTarget) return false;
          const comicNum = Number(comicIdValue);
          return !Number.isNaN(comicNum) && comicNum === numericTarget;
        });

        if (comic) {
          const previousStatus = getComicStatus(comic);
          if (!comic.progress) {
            comic.progress = { totalPages: 0, lastReadPage: 0 };
          }

          comic.progress.lastReadPage = lastReadPage;

          if (typeof totalPages === 'number') {
            comic.progress.totalPages = totalPages;
          } else if (typeof maybeTotalPages === 'number' && !Number.isNaN(maybeTotalPages)) {
            comic.progress.totalPages = maybeTotalPages;
          }

          const updatedStatus = getComicStatus(comic);
          if (previousStatus !== updatedStatus) {
            // Update filter button counts
            if (typeof updateFilterButtonCounts === 'function') {
              updateFilterButtonCounts();
            }

            // Update the card banner
            updateCardBanner(comicId, updatedStatus);

            // Re-render the current view to show updated counts
            // (Remove currentView !== 'comic' restriction so counts update everywhere)
            if (typeof applyFilterAndRender === 'function') {
              applyFilterAndRender();
            }
          }

          const updatedName = comic.displayName || (applyDisplayInfoToComic(comic).displayTitle);
          debugLog('PROGRESS', `Updated library progress for ${updatedName}`);

          if (typeof updateDownloadedComicProgressData === 'function') {
            updateDownloadedComicProgressData(comic.id ?? targetId, {
              lastReadPage,
              totalPages: comic.progress.totalPages,
            });
            if (typeof renderDownloadedSmartList === 'function' && currentView === 'downloaded') {
              renderDownloadedSmartList();
            }
          }
          return;
        }
      }
    }
  }
}

// Set up event listeners for progress tracking
function initializeProgressTracking() {
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');

  // Navigation is already handled by viewer.js - no need for duplicate listeners
  // Keyboard navigation is also handled by viewer.js

  debugLog('PROGRESS', 'Progress tracking initialized');
}

// Helper function to update offline progress data for downloaded comics
async function updateOfflineProgressForComic(comicId, status) {
  if (!db) await openOfflineDB();

  // Get the actual comic to find its real total pages
  let actualTotalPages = 0;

  // Find the comic in the library to get its actual page count
  for (const rootFolder in library) {
    for (const publisherName in library[rootFolder].publishers) {
      for (const seriesName in library[rootFolder].publishers[publisherName].series) {
        const comics = library[rootFolder].publishers[publisherName].series[seriesName];

        // Handle both array format (full data) and object format (lazy loading)
        if (Array.isArray(comics)) {
          const comic = comics.find(c => c.id === comicId);
          if (comic && comic.progress) {
            actualTotalPages = comic.progress.totalPages || 0;
            break;
          }
        }
        // For lazy loading format, we can't access comics that aren't loaded yet
        // The function will continue with actualTotalPages = 0 as fallback
      }
    }
  }

  // Update progress store with read status using actual page count
  const lastReadPage = status === 'read'
    ? Math.max(0, actualTotalPages - 1)
    : 0;

  const progressData = {
    id: comicId,
    lastReadPage,
    page: lastReadPage,
    totalPages: actualTotalPages,
    synced: false,
    updatedAt: new Date().toISOString()
  };

  return new Promise((resolve) => {
    const tx = db.transaction(['progress'], 'readwrite');
    const store = tx.objectStore('progress');
    const request = store.put(progressData);
    request.onsuccess = () => {
      if (typeof scheduleOfflineProgressSync === 'function') {
        scheduleOfflineProgressSync(true);
      }
      resolve();
    };
    request.onerror = (event) => {
      
      resolve(); // Don't fail the whole operation
    };
  });
}

// Helper function to update offline progress data for all comics in a series
async function updateOfflineProgressForSeries(rootFolder, publisher, seriesName, status) {
  if (!db || !library) return;

  // Find all comics in the series
  const seriesComics = library[rootFolder]?.publishers[publisher]?.series[seriesName];
  if (!seriesComics) return;

  // Handle both array format (full data) and object format (lazy loading)
  if (Array.isArray(seriesComics)) {
    // Update progress for each comic in the series
    for (const comic of seriesComics) {
      await updateOfflineProgressForComic(comic.id, status);
    }
  } else if (seriesComics && seriesComics._hasDetails === false) {
    // For lazy loading, we need to load the series first
    

    // Load the series details first
    const detailedComics = await getSeriesComics(rootFolder, publisher, seriesName);
    if (Array.isArray(detailedComics)) {
      for (const comic of detailedComics) {
        await updateOfflineProgressForComic(comic.id, status);
      }
    }
  }
}

// Update lazy loading counts when comic status changes
function updateLazyLoadingCounts(rootFolder, publisher, seriesName, oldStatus, newStatus) {
  if (!library || !library._isLazyLoaded) return;

  const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
  const publisherData = library[rootFolder]?.publishers?.[publisher];

  if (seriesData && seriesData._counts) {
    // Update series counts
    if (oldStatus && seriesData._counts[oldStatus] > 0) {
      seriesData._counts[oldStatus]--;
    }
    if (newStatus) {
      seriesData._counts[newStatus]++;
    }

    // Update publisher counts
    if (publisherData && publisherData._counts) {
      if (oldStatus && publisherData._counts[oldStatus] > 0) {
        publisherData._counts[oldStatus]--;
      }
      if (newStatus) {
        publisherData._counts[newStatus]++;
      }
    }
  }
}

// Helper function to update card banner optimistically
function updateCardBanner(comicId, newStatus) {
  const cards = document.querySelectorAll(`.comic-card`);
  cards.forEach(card => {
    const cardButton = card.querySelector(`[data-comic-id="${comicId}"]`);
    if (!cardButton) return;

    const imageContainer = card.querySelector('.relative');
    if (!imageContainer) return;

    const oldBanner = imageContainer.querySelector('.status-banner');

    // Fade out old banner
    if (oldBanner) {
      oldBanner.classList.add('fade-out');
      setTimeout(() => oldBanner.remove(), 300);
    }

    // Create new banner based on status
    if (newStatus === 'read') {
      setTimeout(() => {
        const newBanner = document.createElement('div');
        newBanner.className = 'status-banner status-read';
        newBanner.textContent = 'Read';
        newBanner.style.opacity = '0';
        imageContainer.insertBefore(newBanner, imageContainer.firstChild);
        setTimeout(() => newBanner.style.opacity = '1', 10);
      }, 300);
    }
  });
}

// Helper function to update series card banner optimistically
function updateSeriesBanner(seriesName, newStatus) {
  const cards = document.querySelectorAll(`.series-card`);
  cards.forEach(card => {
    const cardButton = card.querySelector(`[data-series-name="${seriesName}"]`);
    if (!cardButton) return;

    const imageContainer = card.querySelector('.relative');
    if (!imageContainer) return;

    const oldBanner = imageContainer.querySelector('.status-banner');

    // Fade out old banner
    if (oldBanner) {
      oldBanner.classList.add('fade-out');
      setTimeout(() => oldBanner.remove(), 300);
    }

    // Create new banner based on status
    if (newStatus === 'read') {
      setTimeout(() => {
        const newBanner = document.createElement('div');
        newBanner.className = 'status-banner status-read';
        newBanner.textContent = 'Read';
        newBanner.style.opacity = '0';
        imageContainer.insertBefore(newBanner, imageContainer.firstChild);
        setTimeout(() => newBanner.style.opacity = '1', 10);
      }, 300);
    }
  });
}

// Toggle read/unread status for a comic or entire series
async function toggleReadStatus(button) {
  const comicId = button.dataset.comicId;
  const seriesName = button.dataset.seriesName;
  const rootFolder = button.dataset.rootFolder;
  const publisher = button.dataset.publisher;
  const currentStatus = button.dataset.currentStatus;

  // For individual comics, determine the correct new status based on current status
  let newStatus;
  if (comicId && !seriesName) {
    // Individual comic toggle: cycle through unread -> read -> unread
    newStatus = currentStatus === 'read' ? 'unread' : 'read';
  } else {
    // Series toggle: cycle through unread -> read -> unread
    newStatus = currentStatus === 'read' ? 'unread' : 'read';
  }

  // Store original button state for rollback
  const originalIcon = button.innerHTML;
  const originalColor = button.className;

  // Show loading state
  button.classList.add('loading');
  button.disabled = true;

  const iconRead = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`;
  const iconUnread = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;

  // Optimistically update button UI
  button.innerHTML = newStatus === 'read' ? iconRead : iconUnread;
  button.dataset.currentStatus = newStatus;
  if (newStatus === 'read') {
    button.classList.add('text-green-400');
    button.classList.remove('text-gray-400');
  } else {
    button.classList.add('text-gray-400');
    button.classList.remove('text-green-400');
  }

  try {
    if (!navigator.onLine) throw new Error('Offline');

    let response;
    if (seriesName) {
      response = await fetch(`${API_BASE_URL}/api/v1/series/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootFolder, publisher, series: seriesName, status: newStatus })
      });
    } else {
      response = await fetch(`${API_BASE_URL}/api/v1/comics/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comicId, status: newStatus })
      });
    }

    if (!response.ok) throw new Error('Failed to update status');

    // SUCCESS: Update offline progress data
    if (seriesName && !comicId) {
      // For series toggles only (no comicId means it's a series button)
      await updateOfflineProgressForSeries(rootFolder, publisher, seriesName, newStatus);
    } else if (comicId) {
      // For individual comic toggles
      await updateOfflineProgressForComic(comicId, newStatus);
    }

    updateLibraryReadStatus({
      rootFolder,
      publisher,
      seriesName,
      comicId,
      status: newStatus,
    });

    applyFilterAndRender();

    // Update banner AFTER re-render completes (need to wait for DOM update)
    requestAnimationFrame(() => {
      if (comicId && !seriesName) {
        updateCardBanner(comicId, newStatus);
      } else if (seriesName) {
        updateSeriesBanner(seriesName, newStatus);
      }
    });

    // Trigger immediate sync to propagate changes
    if (typeof scheduleOfflineProgressSync === 'function') {
      scheduleOfflineProgressSync(true);
    }

    // Update library cache in IndexedDB so refresh shows updated status immediately
    if (typeof saveLibraryCacheToDB === 'function' && typeof library !== 'undefined') {
      saveLibraryCacheToDB(library).catch(error => {
        
      });
    }

  } catch (error) {
    

    // ROLLBACK: Revert optimistic UI update on error
    button.innerHTML = originalIcon;
    button.className = originalColor;
    button.dataset.currentStatus = currentStatus;

    // Revert banner if it was changed
    if (comicId && !seriesName) {
      updateCardBanner(comicId, currentStatus);
    } else if (seriesName) {
      updateSeriesBanner(seriesName, currentStatus);
    }

    // FALLBACK: Save to offline storage
    const statusItem = seriesName
      ? {
          key: `series:${rootFolder}|${publisher}|${seriesName}`,
          type: 'series',
          rootFolder,
          publisher,
          seriesName,
          status: newStatus
        }
      : {
          key: `comic:${comicId}`,
          type: 'comic',
          comicId,
          status: newStatus
        };
    await saveStatusToDB(statusItem);

    // FALLBACK: Update offline progress data
    if (seriesName) {
      await updateOfflineProgressForSeries(rootFolder, publisher, seriesName, newStatus);
    } else {
      await updateOfflineProgressForComic(comicId, newStatus);
    }

    updateLibraryReadStatus({
      rootFolder,
      publisher,
      seriesName,
      comicId,
      status: newStatus,
    });

    // Re-apply optimistic update for offline mode
    button.innerHTML = newStatus === 'read' ? iconRead : iconUnread;
    button.dataset.currentStatus = newStatus;
    if (newStatus === 'read') {
      button.classList.add('text-green-400');
      button.classList.remove('text-gray-400');
    } else {
      button.classList.add('text-gray-400');
      button.classList.remove('text-green-400');
    }

    // Update lazy loading counts if needed
    updateLazyLoadingCounts(rootFolder, publisher, seriesName, currentStatus, newStatus);

    applyFilterAndRender();

    // Update banner AFTER re-render completes (need to wait for DOM update)
    requestAnimationFrame(() => {
      if (comicId && !seriesName) {
        updateCardBanner(comicId, newStatus);
      } else if (seriesName) {
        updateSeriesBanner(seriesName, newStatus);
      }
    });
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

