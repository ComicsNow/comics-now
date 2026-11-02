import { state } from '../../globals.js';

export function collectDrillInComicIds() {
  const library = state.library || (typeof window !== 'undefined' ? window.library : null);
  const currentRootFolder = state.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null);
  const currentPublisher = state.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);
  const currentSeries = state.currentSeries || (typeof window !== 'undefined' ? window.currentSeries : null);

  if (!library || typeof library !== 'object') return null;
  if (!currentRootFolder && !currentPublisher && !currentSeries) return null;

  const ids = new Set();
  const addAll = (comics) => {
    if (Array.isArray(comics)) {
      comics.forEach(c => c && c.id != null && ids.add(c.id));
    }
  };

  if (currentRootFolder && currentPublisher && currentSeries) {
    addAll(library[currentRootFolder]?.publishers?.[currentPublisher]?.series?.[currentSeries]);
  } else if (currentRootFolder && currentPublisher) {
    const seriesEntries = library[currentRootFolder]?.publishers?.[currentPublisher]?.series || {};
    Object.values(seriesEntries).forEach(addAll);
  } else if (currentRootFolder) {
    const publishers = library[currentRootFolder]?.publishers || {};
    Object.values(publishers).forEach(p => Object.values(p?.series || {}).forEach(addAll));
  }
  return ids;
}

export function scopeListByDrillIn(comics) {
  const ids = collectDrillInComicIds();
  if (!ids) return comics || [];
  return (comics || []).filter(c => c && ids.has(c.id));
}

export function buildSmartListBreadcrumb(smartLabel) {
  const showRootFolderList = state.showRootFolderList || (typeof window !== 'undefined' ? window.showRootFolderList : null);
  const showPublisherList = state.showPublisherList || (typeof window !== 'undefined' ? window.showPublisherList : null);
  const showSeriesList = state.showSeriesList || (typeof window !== 'undefined' ? window.showSeriesList : null);
  const showComicList = state.showComicList || (typeof window !== 'undefined' ? window.showComicList : null);

  const currentRootFolder = state.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null);
  const currentPublisher = state.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);
  const currentSeries = state.currentSeries || (typeof window !== 'undefined' ? window.currentSeries : null);

  const crumbs = [{
    label: 'Libraries',
    action: () => {
      if (typeof showRootFolderList === 'function') showRootFolderList({ force: true });
    }
  }];
  if (currentRootFolder) {
    const libraryNames = state.LIBRARY_NAMES || (typeof window !== 'undefined' ? window.LIBRARY_NAMES : null) || {};
    const libLabel = libraryNames[currentRootFolder] || libraryNames[currentRootFolder.replace(/[\\\/]+$/, '')] || currentRootFolder.split(/[\\\/]/).pop() || currentRootFolder;
    crumbs.push({
      label: libLabel,
      action: () => {
        if (typeof showPublisherList === 'function') showPublisherList(currentRootFolder, { force: true });
      }
    });
  }
  if (currentPublisher) {
    crumbs.push({
      label: currentPublisher,
      action: () => {
        if (typeof showSeriesList === 'function') showSeriesList(currentPublisher, { force: true });
      }
    });
  }
  if (currentSeries) {
    crumbs.push({
      label: currentSeries,
      action: () => {
        if (typeof showComicList === 'function') showComicList(currentSeries);
      }
    });
  }
  crumbs.push({ label: smartLabel });
  return crumbs;
}

export function filterComicsByStatus(comics, activeFilter, getComicStatus) {
  if (!Array.isArray(comics) || !comics.length) return [];
  if (!activeFilter || activeFilter === 'all') return comics;
  const statusFn = typeof getComicStatus === 'function' ? getComicStatus : (() => 'unread');
  return comics.filter(comic => statusFn(comic) === activeFilter);
}
