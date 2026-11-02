import { state } from '../../globals.js';

export function getComicStatus(comic) {
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

export function getSeriesStatus(comicsInSeries) {
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

export function createEmptyStatusCounts() {
  return { total: 0, inProgress: 0, read: 0, unread: 0 };
}

export function addStatusCounts(target, addition) {
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

export function getComicStatusCounts(comicsInSeries) {
  const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
  const scope = state.activeSmartFilter || window.activeSmartFilter || null;
  const matchesScope = SmartLists.comicMatchesActiveSmartScope || (() => true);

  const isInbox = state.currentRootFolder === 'Smart Inbox';

  // Pre-computed counts from lazy loading don't know about smart scope; bypass them
  // when a smart scope or inbox is active so we recompute against the actual comic list.
  if (!scope && !isInbox && comicsInSeries && typeof comicsInSeries === 'object' && !Array.isArray(comicsInSeries) && comicsInSeries._counts) {
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
    if (isInbox) {
      const tag = comic.tagStatus || 'pending';
      if (tag === 'successful') {
        counts.unread += 1;
      } else if (tag === 'failed') {
        counts.inProgress += 1;
      } else {
        counts.read += 1;
      }
    } else {
      const status = getComicStatus(comic);
      if (status === 'read') {
        counts.read += 1;
      } else if (status === 'in-progress') {
        counts.inProgress += 1;
      } else {
        counts.unread += 1;
      }
    }
  }

  return counts;
}

export function getPublisherStatusCounts(publisherData = {}) {
  // Pre-computed counts don't know about smart scope; bypass when a scope is active.
  const activeSmartFilter = state.activeSmartFilter || window.activeSmartFilter;
  if (!activeSmartFilter && publisherData._counts) {
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

export function getRootStatusCounts(rootData = {}) {
  const counts = createEmptyStatusCounts();
  const publishers = rootData.publishers || {};
  for (const publisherData of Object.values(publishers)) {
    const publisherCounts = getPublisherStatusCounts(publisherData);
    addStatusCounts(counts, publisherCounts);
  }
  return counts;
}

export function getLibraryStatusCounts(libraryData = {}) {
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

export function statusCountsMatchFilter(counts = createEmptyStatusCounts()) {
  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  const activeSmartFilter = state.activeSmartFilter || window.activeSmartFilter;

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
  if (activeSmartFilter) {
    return (counts.total || 0) > 0;
  }
  return true;
}

export function filterPublishersByActiveFilter(publishers = {}) {
  const scope = state.activeSmartFilter || window.activeSmartFilter || null;
  const activeFilter = state.activeFilter || window.activeFilter || 'all';
  if (activeFilter === 'all' && !scope) {
    return publishers;
  }

  const filtered = {};
  for (const [publisherName, publisherData] of Object.entries(publishers)) {
    if (scope === 'reading-list') {
      const SmartLists = state.LibrarySmartLists || window.LibrarySmartLists || {};
      const getReadingLists = state.getReadingListsForPublisher || window.getReadingListsForPublisher || SmartLists.getReadingListsForPublisher;
      const readingLists = typeof getReadingLists === 'function' ? getReadingLists(publisherName) : [];
      if (readingLists.length === 0) continue;
    }
    const counts = getPublisherStatusCounts(publisherData);
    // When a scope is active (other than reading-list where we already checked reading lists), drop publishers with zero in-scope total.
    if (scope && scope !== 'reading-list' && (counts.total || 0) === 0) continue;
    if (statusCountsMatchFilter(counts)) {
      filtered[publisherName] = publisherData;
    }
  }
  return filtered;
}

export function filterSeriesByActiveFilter(seriesEntries = {}) {
  const scope = state.activeSmartFilter || window.activeSmartFilter || null;
  const activeFilter = state.activeFilter || window.activeFilter || 'all';
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
