// --- PROGRESS TRACKING SYSTEM ---
// Navigation, rendering, and fullscreen handling live in viewer.js. This module
// now focuses on persistence helpers and wiring progress-related UI events.

import {
  state,
  ICONS,
  debugLog,
  applyDisplayInfoToComic
} from './globals.js';

// --- Dynamic Wrappers for Transitioning Functions ---

async function callOpenOfflineDB() {
  const fn = state.openOfflineDB || window.openOfflineDB;
  if (typeof fn === 'function') return await fn();
  debugLog('PROGRESS', 'openOfflineDB not available');
}

function callScheduleOfflineProgressSync(immediate = false) {
  const fn = state.scheduleOfflineProgressSync || window.scheduleOfflineProgressSync;
  if (typeof fn === 'function') fn(immediate);
}

function callInvalidateFolderCache() {
  const fn = state.invalidateFolderCache || window.invalidateFolderCache;
  if (typeof fn === 'function') fn();
}

function callGetComicStatus(comic) {
  const fn = state.getComicStatus || window.getComicStatus;
  if (typeof fn === 'function') return fn(comic);
  return 'unread';
}

function callUpdateFilterButtonCounts() {
  const fn = state.updateFilterButtonCounts || window.updateFilterButtonCounts;
  if (typeof fn === 'function') fn();
}

function callUpdateDownloadedComicProgressData(comicId, progress) {
  const fn = state.updateDownloadedComicProgressData || window.updateDownloadedComicProgressData;
  if (typeof fn === 'function') fn(comicId, progress);
}

function callRenderDownloadedSmartList() {
  const fn = state.renderDownloadedSmartList || window.renderDownloadedSmartList;
  if (typeof fn === 'function') fn();
}

async function callSaveLibraryCacheToDB(libraryData) {
  const fn = state.saveLibraryCacheToDB || window.saveLibraryCacheToDB;
  if (typeof fn === 'function') return await fn(libraryData);
}

async function callSaveStatusToDB(statusItem) {
  const fn = state.saveStatusToDB || window.saveStatusToDB;
  if (typeof fn === 'function') return await fn(statusItem);
}

async function callGetSeriesComics(rootFolder, publisher, series) {
  const fn = state.getSeriesComics || window.getSeriesComics;
  if (typeof fn === 'function') return await fn(rootFolder, publisher, series);
  return [];
}

function callUpdateLibraryReadStatus(payload) {
  const fn = state.updateLibraryReadStatus || window.updateLibraryReadStatus;
  if (typeof fn === 'function') fn(payload);
}

function callApplyFilterAndRender() {
  const fn = state.applyFilterAndRender || window.applyFilterAndRender;
  if (typeof fn === 'function') fn();
}

// --- CORE FUNCTIONS ---

// Save progress to IndexedDB (for downloaded comics)
export async function saveProgressToDB(comicId, currentPage, totalPages, comicPath) {
  const activeDb = state.db || window.db;
  if (!activeDb) {
    debugLog('PROGRESS', 'IndexedDB not initialized, opening connection...');
    await callOpenOfflineDB();
  }

  const dbToUse = state.db || window.db;
  if (!dbToUse) {
    throw new Error('IndexedDB connection could not be opened');
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
      const transaction = dbToUse.transaction(['progress', 'comics'], 'readwrite');
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
              // Ignore inner errors
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
        callScheduleOfflineProgressSync(true);
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
export function updateLibraryProgress(comicId, progressData, maybeTotalPages) {
  if (!state.library) return;

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
    // Fallback to sessionStorage for local/device comics if no progress provided
    const sessionSavedPage = sessionStorage.getItem(`progress_${targetId}`);
    if (sessionSavedPage !== null && (targetId.startsWith('device-') || targetId.startsWith('upload-'))) {
      lastReadPage = parseInt(sessionSavedPage, 10);
    } else {
      lastReadPage = 0;
    }
  }

  // Invalidate folder cache so that folder views reflect the new progress
  callInvalidateFolderCache();

  const numericTarget = Number(targetId);
  const hasNumericTarget = !Number.isNaN(numericTarget);

  for (const rootDir in state.library) {
    const publishers = state.library[rootDir]?.publishers;
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
          const previousStatus = callGetComicStatus(comic);
          if (!comic.progress) {
            comic.progress = { totalPages: 0, lastReadPage: 0 };
          }

          comic.progress.lastReadPage = lastReadPage;

          if (typeof totalPages === 'number') {
            comic.progress.totalPages = totalPages;
          } else if (typeof maybeTotalPages === 'number' && !Number.isNaN(maybeTotalPages)) {
            comic.progress.totalPages = maybeTotalPages;
          }

          const updatedStatus = callGetComicStatus(comic);
          if (previousStatus !== updatedStatus) {
            // Update filter button counts
            updateLazyLoadingCounts(rootDir, publisherName, seriesName, previousStatus, updatedStatus);
            callUpdateFilterButtonCounts();

            // Update the card banner
            updateCardBanner(comicId, updatedStatus);

            // Re-render the current view to show updated counts
            callApplyFilterAndRender();
          }

          const updatedName = comic.displayName || (applyDisplayInfoToComic(comic).displayTitle);
          debugLog('PROGRESS', `Updated library progress for ${updatedName}`);

          callUpdateDownloadedComicProgressData(comic.id ?? targetId, {
            lastReadPage,
            totalPages: comic.progress.totalPages,
          });

          if (state.currentView === 'downloaded') {
            callRenderDownloadedSmartList();
          }
          return;
        }
      }
    }
  }
}

// Set up event listeners for progress tracking
export function initializeProgressTracking() {
  debugLog('PROGRESS', 'Progress tracking initialized');
}

// Helper function to update offline progress data for downloaded comics
export async function updateOfflineProgressForComic(comicId, status) {
  const activeDb = state.db || window.db;
  if (!activeDb) await callOpenOfflineDB();

  const dbToUse = state.db || window.db;
  if (!dbToUse) return;

  // Get the actual comic to find its real total pages
  let actualTotalPages = 0;

  // Find the comic in the library to get its actual page count
  for (const rootFolder in state.library) {
    if (!state.library[rootFolder] || !state.library[rootFolder].publishers) continue;
    for (const publisherName in state.library[rootFolder].publishers) {
      for (const seriesName in state.library[rootFolder].publishers[publisherName].series) {
        const comics = state.library[rootFolder].publishers[publisherName].series[seriesName];

        // Handle both array format (full data) and object format (lazy loading)
        if (Array.isArray(comics)) {
          const comic = comics.find(c => c.id === comicId);
          if (comic && comic.progress) {
            actualTotalPages = comic.progress.totalPages || 0;
            break;
          }
        }
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
    const tx = dbToUse.transaction(['progress'], 'readwrite');
    const store = tx.objectStore('progress');
    const request = store.put(progressData);
    request.onsuccess = () => {
      callScheduleOfflineProgressSync(true);
      resolve();
    };
    request.onerror = () => {
      resolve(); // Don't fail the whole operation
    };
  });
}

// Helper function to update offline progress data for all comics in a series
export async function updateOfflineProgressForSeries(rootFolder, publisher, seriesName, status) {
  if (!(state.db || window.db) || !state.library) return;

  // Find all comics in the series
  const seriesComics = state.library[rootFolder]?.publishers[publisher]?.series[seriesName];
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
    const detailedComics = await callGetSeriesComics(rootFolder, publisher, seriesName);
    if (Array.isArray(detailedComics)) {
      for (const comic of detailedComics) {
        await updateOfflineProgressForComic(comic.id, status);
      }
    }
  }
}

// Update lazy loading counts when comic status changes
export function updateLazyLoadingCounts(rootFolder, publisher, seriesName, oldStatus, newStatus) {
  if (!state.library || !state.library._isLazyLoaded) return;

  const seriesData = state.library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
  const publisherData = state.library[rootFolder]?.publishers?.[publisher];

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
export function updateCardBanner(comicId, newStatus) {
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
export function updateSeriesBanner(seriesName, newStatus) {
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
export async function toggleReadStatus(button) {
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

  const iconRead = ICONS.READ;
  const iconUnread = ICONS.UNREAD;

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
      response = await fetch(`${state.API_BASE_URL || ''}/api/v1/series/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootFolder, publisher, series: seriesName, status: newStatus })
      });
    } else {
      response = await fetch(`${state.API_BASE_URL || ''}/api/v1/comics/status`, {
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

    callUpdateLibraryReadStatus({
      rootFolder,
      publisher,
      seriesName,
      comicId,
      status: newStatus,
    });

    // Update lazy loading counts if needed
    updateLazyLoadingCounts(rootFolder, publisher, seriesName, currentStatus, newStatus);

    callApplyFilterAndRender();

    // Update banner AFTER re-render completes (need to wait for DOM update)
    requestAnimationFrame(() => {
      if (comicId && !seriesName) {
        updateCardBanner(comicId, newStatus);
      } else if (seriesName) {
        updateSeriesBanner(seriesName, newStatus);
      }
    });

    // Trigger immediate sync to propagate changes
    callScheduleOfflineProgressSync(true);

    // Update library cache in IndexedDB so refresh shows updated status immediately
    if (typeof state.library !== 'undefined') {
      callSaveLibraryCacheToDB(state.library).catch(() => {});
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
    await callSaveStatusToDB(statusItem);

    // FALLBACK: Update offline progress data
    if (seriesName) {
      await updateOfflineProgressForSeries(rootFolder, publisher, seriesName, newStatus);
    } else {
      await updateOfflineProgressForComic(comicId, newStatus);
    }

    callUpdateLibraryReadStatus({
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

    callApplyFilterAndRender();

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

// Expose functions on state and window for backward compatibility
state.saveProgressToDB = saveProgressToDB;
state.updateLibraryProgress = updateLibraryProgress;
state.updateLazyLoadingCounts = updateLazyLoadingCounts;
state.toggleReadStatus = toggleReadStatus;

if (typeof window !== 'undefined') {
  window.saveProgressToDB = saveProgressToDB;
  window.updateLibraryProgress = updateLibraryProgress;
  window.updateLazyLoadingCounts = updateLazyLoadingCounts;
  window.toggleReadStatus = toggleReadStatus;
}
