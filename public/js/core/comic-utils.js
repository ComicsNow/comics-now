/**
 * Comics Now! - Comic Metadata, Title Normalization & View Routing
 *
 * Title/subtitle deduplication rules, library indexing, and view state transitions.
 */

import { toTrimmedString, getRelativePath } from './dom-utils.js';

export function getComicById(id, includeContext = false) {
  const currentState = (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? (window.state || window) : null));
  const library = currentState?.library || (typeof window !== 'undefined' ? window.library : null);
  if (!library) return null;

  for (const rootPath of Object.keys(library)) {
    const root = library[rootPath];
    if (!root || !root.publishers) continue;
    for (const pubName of Object.keys(root.publishers)) {
      const pub = root.publishers[pubName];
      if (!pub || !pub.series) continue;
      for (const seriesName of Object.keys(pub.series)) {
        const seriesComics = pub.series[seriesName];
        if (!Array.isArray(seriesComics)) continue;
        const found = seriesComics.find(c => String(c.id) === String(id) || c.id == id);
        if (found) {
          if (includeContext) {
            return {
              comic: found,
              rootFolder: rootPath,
              publisher: pubName,
              series: seriesName
            };
          }
          return found;
        }
      }
    }
  }
  return null;
}

export function turnToPage(index) {
  const currentState = (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? (window.state || window) : null));
  if (currentState) {
    currentState.currentPageIndex = index;
    if (typeof currentState.renderPage === 'function') {
      currentState.renderPage();
    }
  }
}

export function pickMetadataValue(metadata = {}, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      const candidate = toTrimmedString(metadata[key]);
      if (candidate) return candidate;
    }
  }
  return '';
}

export function sanitizeComicTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';
  let clean = rawTitle.trim();
  const isDirtyRelease = /\[[^\]]*\]/.test(clean) || /^\s*\d{1,3}\s*[-._]/.test(clean);
  clean = clean.replace(/\.(cbz|cbr|cb7|cbt|zip|rar|tar|pdf)$/i, '');
  clean = clean.replace(/\[[^\]]*\]/g, ' ');
  clean = clean.replace(/^\s*\d{1,3}\s*[-._]\s*(?=[a-zA-Z])/i, '');
  clean = clean.replace(/^\s*\d{1,3}\s+(?=[a-zA-Z])/i, '');
  if (isDirtyRelease) {
    clean = clean.replace(/\s*\((?:19|20)\d{2}\b[^\)]*\)\s*(?=#\d+)/i, ' ');
  }
  clean = clean.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || rawTitle.trim();
}

export function buildComicDisplayInfo(comic = {}) {
  let metadata = comic.metadata || {};
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = {};
    }
  }

  const issueNumber = pickMetadataValue(metadata, ['Number', 'Issue', 'IssueNumber', 'SortNumber', 'AlternateNumber']);
  let seriesName = pickMetadataValue(metadata, ['Series', 'SeriesName', 'AlternateSeries']);
  if (!seriesName && comic.series) {
    seriesName = toTrimmedString(comic.series);
  }
  const titleText = pickMetadataValue(metadata, ['Title', 'DisplayTitle', 'SortName', 'FullTitle', 'StoryTitle']);

  const hasNoMetadata = (!seriesName || seriesName === 'Unknown Series') && !titleText && !issueNumber;

  const seriesWithIssue = seriesName
    ? (issueNumber ? `${seriesName} #${issueNumber}` : seriesName)
    : (issueNumber ? `Issue ${issueNumber}` : '');

  const cleanFallbackName = sanitizeComicTitle(comic.name) || toTrimmedString(comic.name) || 'Untitled Comic';

  const displayTitle = hasNoMetadata
    ? cleanFallbackName
    : ([
        seriesWithIssue,
        titleText,
        toTrimmedString(comic.title),
        cleanFallbackName
      ].find(Boolean) || 'Untitled Comic');

  let subtitle = '';
  const rawStoryTitle = titleText || toTrimmedString(comic.title);
  if (rawStoryTitle) {
    const trimmedTitle = toTrimmedString(rawStoryTitle);
    const isFilename = /\.(cbz|cbr|cb7|cbt|zip|rar|tar|pdf)$/i.test(trimmedTitle) ||
                       (comic.name && trimmedTitle.toLowerCase() === toTrimmedString(comic.name).toLowerCase());
    const sLower = (seriesName || '').toLowerCase().trim();
    const tLower = trimmedTitle.toLowerCase().trim();
    const dLower = displayTitle.toLowerCase().trim();
    const isRedundant = tLower === sLower ||
                        tLower === dLower ||
                        (Boolean(sLower) && tLower.startsWith(sLower) && /^(?:[:\s\-_–—#()]+|\s*(?:issue|no|vol|volume|pt|part|book|bk)\s*\d*|\d+)+$/i.test(tLower.slice(sLower.length)));

    if (trimmedTitle && !isFilename && !isRedundant) {
      subtitle = trimmedTitle;
    }
  }

  const altText = displayTitle || subtitle || 'Comic cover';

  return {
    displayTitle,
    subtitle,
    altText,
    issueNumber,
    seriesName,
    titleText,
    seriesWithIssue
  };
}

export function applyDisplayInfoToComic(comic) {
  if (!comic || typeof comic !== 'object') return buildComicDisplayInfo();
  const info = buildComicDisplayInfo(comic);
  comic.displayName = info.displayTitle;
  comic.subtitle = info.subtitle;
  comic.altText = info.altText;
  return info;
}

export function applyDisplayInfoToLibrary(libraryData) {
  if (!libraryData || typeof libraryData !== 'object') return;
  for (const rootKey of Object.keys(libraryData)) {
    const publishers = libraryData[rootKey]?.publishers || {};
    for (const publisherName of Object.keys(publishers)) {
      const seriesEntries = publishers[publisherName]?.series || {};
      for (const seriesName of Object.keys(seriesEntries)) {
        const comics = seriesEntries[seriesName];
        if (Array.isArray(comics)) {
          comics.forEach(applyDisplayInfoToComic);
        }
      }
    }
  }
}

export function getPathForCurrentView() {
  const currentState = (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? (window.state || window) : null)) || {};
  if (currentState.currentView === 'root') return '/';
  if (currentState.currentView === 'search') {
    return `/search?q=${encodeURIComponent(currentState.lastSearchQuery || '')}&field=${encodeURIComponent(currentState.lastSearchField || 'all')}`;
  }
  if (currentState.currentView === 'publishers' && currentState.currentRootFolder) {
    return `/library?rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
  }
  if (currentState.currentView === 'series' && currentState.currentPublisher) {
    let path = `/series-list?publisher=${encodeURIComponent(currentState.currentPublisher)}`;
    if (currentState.currentRootFolder) path += `&rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
    return path;
  }
  if (currentState.currentView === 'comics' && currentState.currentSeries) {
    let path = `/series/${encodeURIComponent(currentState.currentSeries)}`;
    if (currentState.currentPublisher) path += `?publisher=${encodeURIComponent(currentState.currentPublisher)}`;
    if (currentState.currentRootFolder) path += `&rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
    return path;
  }
  if (currentState.currentView === 'comic' && currentState.currentComic) {
    return `/comic/${currentState.currentComic.id}/page/${(currentState.currentPageIndex || 0) + 1}`;
  }
  return '/';
}

export function showView(targetView) {
  const currentState = (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? (window.state || window) : null)) || {};

  if (!currentState._isNavigatingFromRouter && currentState.router && !currentState._isAppInitializing && targetView) {
    let path = null;
    if (targetView.id === 'root-folder-list') path = '/';
    else if (targetView.id === 'search-results-view') path = '/search';
    else if (targetView.id === 'folder-list-view' && currentState.currentFolderPath) {
      path = `/folder?path=${encodeURIComponent(currentState.currentFolderPath)}`;
    }
    else if (targetView.id === 'publisher-list' && currentState.currentRootFolder) {
      path = `/library?rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
    }
    else if (targetView.id === 'series-list' && currentState.currentPublisher) {
      path = `/series-list?publisher=${encodeURIComponent(currentState.currentPublisher)}`;
      if (currentState.currentRootFolder) path += `&rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
    }
    else if (targetView.id === 'comic-list' && currentState.currentSeries) {
      path = `/series/${encodeURIComponent(currentState.currentSeries)}`;
      if (currentState.currentPublisher) path += `?publisher=${encodeURIComponent(currentState.currentPublisher)}`;
      if (currentState.currentRootFolder) path += `&rootFolder=${encodeURIComponent(currentState.currentRootFolder)}`;
    }
    else if (targetView.id === 'comic-viewer' && currentState.currentComic) {
      path = `/comic/${currentState.currentComic.id}`;
    }

    const settingsModal = document.getElementById('settings-modal');
    const readingListModal = document.getElementById('reading-list-modal');
    const isSettingsOpen = settingsModal && !settingsModal.classList.contains('hidden');
    const isReadingListOpen = readingListModal && !readingListModal.classList.contains('hidden');

    if (path && (getRelativePath() + window.location.search) !== path && !isSettingsOpen && !isReadingListOpen) {
      currentState.router.navigate(path, true);
    }
  }

  const views = [
    document.getElementById('root-folder-list'),
    document.getElementById('folder-list-view'),
    document.getElementById('publisher-list'),
    document.getElementById('series-list'),
    document.getElementById('comic-list'),
    document.getElementById('comic-viewer'),
    document.getElementById('search-results-view'),
    document.getElementById('smart-list-view')
  ];

  views.forEach(view => {
    if (view) {
      if (view === targetView) {
        view.classList.remove('hidden');
      } else {
        view.classList.add('hidden');
      }
    }
  });

  const comicViewerDiv = document.getElementById('comic-viewer');
  const searchContainer = document.getElementById('search-container');
  const filtersContainer = document.getElementById('filters-container');

  if (targetView === comicViewerDiv) {
    searchContainer?.classList.add('hidden');
    filtersContainer?.classList.add('hidden');
  } else {
    searchContainer?.classList.remove('hidden');
    filtersContainer?.classList.remove('hidden');
  }

  const rootFolderListDiv = document.getElementById('root-folder-list');
  const logoContainer = document.querySelector('.logo-container');
  if (logoContainer) {
    if (targetView === rootFolderListDiv) {
      logoContainer.classList.remove('logo-compact');
    } else {
      logoContainer.classList.add('logo-compact');
    }
  }

  if (targetView !== comicViewerDiv && typeof window !== 'undefined') {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    });
  }
}
