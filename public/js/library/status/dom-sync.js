import { state } from '../../globals.js';
import { getLibraryStatusCounts } from './calculator.js';

let inProgressCountElement = null;
let readCountElement = null;
let unreadCountElement = null;

export function updateFilterButtonCounts() {
  if (!inProgressCountElement) {
    inProgressCountElement = document.getElementById('in-progress-count');
  }

  if (!readCountElement) {
    readCountElement = document.getElementById('read-count');
  }

  if (!unreadCountElement) {
    unreadCountElement = document.getElementById('unread-count');
  }

  const unreadBtn = document.querySelector('.filter-btn[data-filter="unread"]');
  const inProgressBtn = document.querySelector('.filter-btn[data-filter="in-progress"]');
  const readBtn = document.querySelector('.filter-btn[data-filter="read"]');

  const isInbox = state.currentRootFolder === 'Smart Inbox';

  if (isInbox) {
    if (unreadBtn) {
      const lbl = unreadBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Successful';
    }
    if (inProgressBtn) {
      const lbl = inProgressBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Failed';
    }
    if (readBtn) {
      const lbl = readBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Pending';
    }
  } else {
    if (unreadBtn) {
      const lbl = unreadBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Unread';
    }
    if (inProgressBtn) {
      const lbl = inProgressBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'In Progress';
    }
    if (readBtn) {
      const lbl = readBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Read';
    }
  }

  if (!inProgressCountElement && !readCountElement && !unreadCountElement) {
    return;
  }

  const library = state.library || window.library;

  if (isInbox) {
    const counts = { successful: 0, failed: 0, pending: 0 };
    const rootData = library?.['Smart Inbox'];
    if (rootData && rootData.publishers) {
      for (const publisherName in rootData.publishers) {
        const publisherData = rootData.publishers[publisherName];
        if (publisherData && publisherData.series) {
          for (const seriesName in publisherData.series) {
            const comics = publisherData.series[seriesName];
            if (Array.isArray(comics)) {
              for (const comic of comics) {
                const tag = comic.tagStatus || 'pending';
                if (tag === 'successful') counts.successful++;
                else if (tag === 'failed') counts.failed++;
                else counts.pending++;
              }
            }
          }
        }
      }
    }
    if (unreadCountElement) unreadCountElement.textContent = counts.successful;
    if (inProgressCountElement) inProgressCountElement.textContent = counts.failed;
    if (readCountElement) readCountElement.textContent = counts.pending;
  } else {
    const counts = getLibraryStatusCounts(library);
    if (inProgressCountElement) {
      inProgressCountElement.textContent = counts.inProgress || 0;
    }
    if (readCountElement) {
      readCountElement.textContent = counts.read || 0;
    }
    if (unreadCountElement) {
      unreadCountElement.textContent = counts.unread || 0;
    }
  }

  const updateLatest = state.updateLatestButtonCount || window.updateLatestButtonCount;
  if (typeof updateLatest === 'function') {
    updateLatest();
  }
}

export function updateLibraryReadStatus({ rootFolder, publisher, seriesName, comicId, status }) {
  const library = state.library || window.library;
  if (!library) return;

  // Invalidate folder cache if it exists
  const invalidateFolderCache = state.invalidateFolderCache || window.invalidateFolderCache;
  if (typeof invalidateFolderCache === 'function') {
    invalidateFolderCache();
  }

  const normalizedStatus = status === 'read' ? 'read' : 'unread';

  let statusUpdated = false;
  let downloadedStatusUpdated = false;

  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};

  const applyStatusToComic = (comic) => {
    if (!comic) return;

    if (!comic.progress) {
      comic.progress = { totalPages: 0, lastReadPage: 0 };
    }

    if (normalizedStatus === 'read') {
      if (!comic.progress.totalPages || comic.progress.totalPages <= 0) {
        comic.progress.totalPages = Math.max(comic.pageCount || 0, 1);
      }
      const total = comic.progress.totalPages || 1;
      comic.progress.lastReadPage = Math.max(total - 1, 0);
    } else {
      comic.progress.lastReadPage = 0;
      if (!comic.progress.totalPages || comic.progress.totalPages <= 1) {
        comic.progress.totalPages = 0;
      }
    }
    if (typeof SmartLists.syncDownloadedComicStatusFromLibrary === 'function') {
      if (SmartLists.syncDownloadedComicStatusFromLibrary(comic, normalizedStatus)) {
        downloadedStatusUpdated = true;
      }
    }
    statusUpdated = true;
  };

  const currentView = state.currentView || window.currentView;
  const renderDownloadedSmartList = state.renderDownloadedSmartList || window.renderDownloadedSmartList || (state.LibrarySmartFilters?.renderDownloadedSmartList) || (window.LibrarySmartFilters?.renderDownloadedSmartList);

  if (rootFolder && publisher && seriesName) {
    const comics = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
    if (Array.isArray(comics)) {
      comics.forEach(applyStatusToComic);
    }
    if (statusUpdated) {
      updateFilterButtonCounts();
    }
    if (downloadedStatusUpdated && currentView === 'downloaded') {
      if (typeof renderDownloadedSmartList === 'function') {
        renderDownloadedSmartList();
      }
    }
    return;
  }

  const targetId = String(comicId);
  if (!targetId) {
    return;
  }

  for (const rootData of Object.values(library)) {
    const publishers = rootData?.publishers || {};
    for (const publisherData of Object.values(publishers)) {
      const seriesEntries = publisherData?.series || {};
      for (const comics of Object.values(seriesEntries)) {
        if (!Array.isArray(comics)) continue;
        const comic = comics.find(c => String(c.id) === targetId);
        if (comic) {
          applyStatusToComic(comic);
          if (statusUpdated) {
            updateFilterButtonCounts();
          }
          if (downloadedStatusUpdated && currentView === 'downloaded') {
            if (typeof renderDownloadedSmartList === 'function') {
              renderDownloadedSmartList();
            }
          }
          return;
        }
      }
    }
  }

  if (statusUpdated) {
    updateFilterButtonCounts();
  }
  if (downloadedStatusUpdated && currentView === 'downloaded') {
    if (typeof renderDownloadedSmartList === 'function') {
      renderDownloadedSmartList();
    }
  }
}
