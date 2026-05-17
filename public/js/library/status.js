(function (global) {
  'use strict';

  const SmartLists = global.LibrarySmartLists || {};

  function getComicStatus(comic) {
    const progress = comic?.progress || {};
    const total = progress.totalPages || 0;
    const lastRead = progress.lastReadPage || 0;

    if (total > 0) {
      if (lastRead >= total - 1) {
        return 'read';
      }
      if (lastRead > 0) {
        return 'in-progress';
      }
    } else if (lastRead > 0) {
      return 'in-progress';
    }

    return 'unread';
  }

  function getSeriesStatus(comicsInSeries) {
    if (!Array.isArray(comicsInSeries) || comicsInSeries.length === 0) {
      return 'unread';
    }

    let allRead = true;
    let anyProgress = false;

    for (const comic of comicsInSeries) {
      const status = getComicStatus(comic);
      if (status !== 'read') {
        allRead = false;
      }
      if (status !== 'unread') {
        anyProgress = true;
      }

      if (!allRead && anyProgress) {
        break;
      }
    }

    if (allRead) {
      return 'read';
    }
    if (anyProgress) {
      return 'in-progress';
    }
    return 'unread';
  }

  function getComicStatusCounts(comicsInSeries) {
    const scope = global.activeSmartFilter || null;
    const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);

    // Pre-computed counts from lazy loading don't know about smart scope; bypass them
    // when a scope is active so we recompute against the actual comic list.
    if (!scope && comicsInSeries && typeof comicsInSeries === 'object' && !Array.isArray(comicsInSeries) && comicsInSeries._counts) {
      return comicsInSeries._counts;
    }

    const rawComics = Array.isArray(comicsInSeries) ? comicsInSeries : [];
    const comics = scope ? rawComics.filter(matchesScope) : rawComics;
    const counts = {
      total: comics.length,
      inProgress: 0,
      read: 0,
      unread: 0,
    };

    for (const comic of comics) {
      const status = getComicStatus(comic);
      if (status === 'read') {
        counts.read += 1;
      } else if (status === 'in-progress') {
        counts.inProgress += 1;
      } else {
        counts.unread += 1;
      }
    }

    return counts;
  }

  function createEmptyStatusCounts() {
    return { total: 0, inProgress: 0, read: 0, unread: 0 };
  }

  function addStatusCounts(target, addition) {
    if (!target) {
      target = createEmptyStatusCounts();
    }
    if (addition) {
      target.total += addition.total || 0;
      target.inProgress += addition.inProgress || 0;
      target.read += addition.read || 0;
      target.unread += addition.unread || 0;
    }
    return target;
  }

  function getPublisherStatusCounts(publisherData = {}) {
    // Pre-computed counts don't know about smart scope; bypass when a scope is active.
    if (!global.activeSmartFilter && publisherData._counts) {
      return publisherData._counts;
    }

    const counts = createEmptyStatusCounts();
    const seriesEntries = publisherData.series || {};
    for (const comics of Object.values(seriesEntries)) {
      const seriesCounts = getComicStatusCounts(Array.isArray(comics) ? comics : []);
      addStatusCounts(counts, seriesCounts);
    }
    return counts;
  }

  function getRootStatusCounts(rootData = {}) {
    const counts = createEmptyStatusCounts();
    const publishers = rootData.publishers || {};
    for (const publisherData of Object.values(publishers)) {
      const publisherCounts = getPublisherStatusCounts(publisherData);
      addStatusCounts(counts, publisherCounts);
    }
    return counts;
  }

  function getLibraryStatusCounts(libraryData = {}) {
    const counts = createEmptyStatusCounts();
    if (!libraryData || typeof libraryData !== 'object') {
      return counts;
    }
    for (const rootData of Object.values(libraryData)) {
      const rootCounts = getRootStatusCounts(rootData);
      addStatusCounts(counts, rootCounts);
    }
    return counts;
  }

  function statusCountsMatchFilter(counts = createEmptyStatusCounts()) {
    if (activeFilter === 'in-progress') {
      return (counts.inProgress || 0) > 0;
    }
    if (activeFilter === 'read') {
      return (counts.read || 0) > 0;
    }
    if (activeFilter === 'unread') {
      return (counts.unread || 0) > 0;
    }
    // 'all': drop empty entries when a smart scope is active so we don't show
    // root folders / publishers / series that have nothing in scope.
    if (global.activeSmartFilter) {
      return (counts.total || 0) > 0;
    }
    return true;
  }

  function filterPublishersByActiveFilter(publishers = {}) {
    const scope = global.activeSmartFilter || null;
    if (activeFilter === 'all' && !scope) {
      return publishers;
    }

    const filtered = {};
    for (const [publisherName, publisherData] of Object.entries(publishers)) {
      const counts = getPublisherStatusCounts(publisherData);
      // When a scope is active, drop publishers with zero in-scope total.
      if (scope && (counts.total || 0) === 0) continue;
      if (statusCountsMatchFilter(counts)) {
        filtered[publisherName] = publisherData;
      }
    }
    return filtered;
  }

  function filterSeriesByActiveFilter(seriesEntries = {}) {
    const scope = global.activeSmartFilter || null;
    if (activeFilter === 'all' && !scope) {
      return seriesEntries;
    }

    const filtered = {};
    for (const [seriesName, comics] of Object.entries(seriesEntries)) {
      const counts = getComicStatusCounts(comics);
      if (scope && (counts.total || 0) === 0) continue;
      if (statusCountsMatchFilter(counts)) {
        filtered[seriesName] = comics;
      }
    }
    return filtered;
  }

  let inProgressCountElement = null;
  let readCountElement = null;
  let unreadCountElement = null;

  function updateFilterButtonCounts() {
    if (!inProgressCountElement) {
      inProgressCountElement = document.getElementById('in-progress-count');
    }

    if (!readCountElement) {
      readCountElement = document.getElementById('read-count');
    }

    if (!unreadCountElement) {
      unreadCountElement = document.getElementById('unread-count');
    }

    if (!inProgressCountElement && !readCountElement && !unreadCountElement) {
      return;
    }

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

  function updateLibraryReadStatus({ rootFolder, publisher, seriesName, comicId, status }) {
    if (!library) return;

    // Invalidate folder cache if it exists
    if (typeof global.invalidateFolderCache === 'function') {
      global.invalidateFolderCache();
    }

    const normalizedStatus = status === 'read' ? 'read' : 'unread';

    let statusUpdated = false;
    let downloadedStatusUpdated = false;

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
      if (SmartLists.syncDownloadedComicStatusFromLibrary(comic, normalizedStatus)) {
        downloadedStatusUpdated = true;
      }
      statusUpdated = true;
    };

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

  const LibraryStatus = {
    getComicStatus,
    getSeriesStatus,
    getComicStatusCounts,
    createEmptyStatusCounts,
    addStatusCounts,
    getPublisherStatusCounts,
    getRootStatusCounts,
    getLibraryStatusCounts,
    statusCountsMatchFilter,
    filterPublishersByActiveFilter,
    filterSeriesByActiveFilter,
    updateFilterButtonCounts,
    updateLibraryReadStatus
  };

  global.LibraryStatus = LibraryStatus;
  Object.assign(global, LibraryStatus);
})(typeof window !== 'undefined' ? window : globalThis);
