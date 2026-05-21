// Save original console methods before any modifications
const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

// Shared HTML escaper to prevent stored XSS from author-controlled comic metadata.
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeDirName(str) {
  return String(str).trim().replace(/[\\/]+/g, '_').replace(/\s+/g, ' ');
}

export function getRelativePath() {
  const baseUrl = (state.APP_CONFIG?.baseUrl || '').replace(/\/$/, '');
  let path = window.location.pathname;
  if (baseUrl && path.startsWith(baseUrl)) {
    path = path.substring(baseUrl.length);
  }
  return path || '/';
}

const DEBUG_LOG_STATE = {
  enabled: false,
  categories: new Set()
};

function normalizeDebugCategories(categories) {
  if (!Array.isArray(categories)) {
    categories = Array.from(arguments);
  }
  return categories
    .flatMap(category => {
      if (Array.isArray(category)) return category;
      if (typeof category === 'string') return category.split(',');
      return [];
    })
    .map(category => (typeof category === 'string' ? category.trim().toUpperCase() : ''))
    .filter(Boolean);
}

function isDebugCategoryEnabled(category) {
  if (!DEBUG_LOG_STATE.enabled) {
    return false;
  }
  if (DEBUG_LOG_STATE.categories.size === 0) {
    return true;
  }
  if (!category) {
    return false;
  }
  return DEBUG_LOG_STATE.categories.has(category);
}

export function debugLog(category, ...args) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  if (!isDebugCategoryEnabled(normalizedCategory)) {
    return;
  }
  rawConsole.log(`[${normalizedCategory || 'DEBUG'}]`, ...args);
}

export function enableComicsNowDebug(...categories) {
  const normalized = normalizeDebugCategories(categories);
  DEBUG_LOG_STATE.enabled = true;
  DEBUG_LOG_STATE.categories = new Set(normalized);
  rawConsole.log('[DEBUG]', 'Debug logging enabled', normalized.length ? `for categories: ${normalized.join(', ')}` : 'for all categories');
}

export function disableComicsNowDebug() {
  DEBUG_LOG_STATE.enabled = false;
  DEBUG_LOG_STATE.categories.clear();
  rawConsole.log('[DEBUG]', 'Debug logging disabled');
}

export function isComicsNowDebugEnabled(category) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  return isDebugCategoryEnabled(normalizedCategory);
}

// Standardized icons for the application
export const ICONS = {
  READ: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>`,
  UNREAD: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`,
  DOWNLOAD: `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`,
};

// CSS class constants to eliminate duplication
export const CSS_CLASSES = {
  CARD: 'bg-gray-800 rounded-lg shadow-lg cursor-pointer',
  INPUT: 'bg-gray-700 text-white p-2 rounded-lg',
  BUTTON_PRIMARY: 'bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full',
  BUTTON_SECONDARY: 'bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg',
  LOADING: 'bg-gray-800 rounded-lg p-6 text-center text-gray-500 animate-pulse col-span-full',
  ERROR: 'bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full',
  DOWNLOAD_BTN: 'download-btn absolute top-2 right-2 text-green-400 pointer-events-none'
};

// View management utility to eliminate duplication
export function showView(targetView) {
  if (!state._isNavigatingFromRouter && state.router && !state._isAppInitializing) {
    let path = null;
    if (targetView.id === 'root-folder-list') path = '/';
    else if (targetView.id === 'search-results-view') path = '/search';
    else if (targetView.id === 'folder-list-view' && state.currentFolderPath) {
      path = `/folder?path=${encodeURIComponent(state.currentFolderPath)}`;
    }
    else if (targetView.id === 'publisher-list' && state.currentRootFolder) {
      path = `/library?rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
    }
    else if (targetView.id === 'series-list' && state.currentPublisher) {
      path = `/series-list?publisher=${encodeURIComponent(state.currentPublisher)}`;
      if (state.currentRootFolder) path += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
    }
    else if (targetView.id === 'comic-list' && state.currentSeries) {
      path = `/series/${encodeURIComponent(state.currentSeries)}`;
      if (state.currentPublisher) path += `?publisher=${encodeURIComponent(state.currentPublisher)}`;
      if (state.currentRootFolder) path += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
    }
    else if (targetView.id === 'comic-viewer' && state.currentComic) {
      path = `/comic/${state.currentComic.id}`;
    }

    const settingsModal = document.getElementById('settings-modal');
    const readingListModal = document.getElementById('reading-list-modal');
    const isSettingsOpen = settingsModal && !settingsModal.classList.contains('hidden');
    const isReadingListOpen = readingListModal && !readingListModal.classList.contains('hidden');

    if (path && (getRelativePath() + window.location.search) !== path && !isSettingsOpen && !isReadingListOpen) {
      state.router.navigate(path, true);
    }
  }

  const views = [
    rootFolderListDiv,
    folderListViewDiv,
    publisherListDiv,
    seriesListDiv,
    comicListDiv,
    comicViewerDiv,
    searchResultsView,
    smartListView
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

  // Hide search, filters, and smart lists when comic viewer is shown
  const searchContainer = document.getElementById('search-container');
  const filtersContainer = document.getElementById('filters-container');

  if (targetView === comicViewerDiv) {
    searchContainer?.classList.add('hidden');
    filtersContainer?.classList.add('hidden');
  } else {
    searchContainer?.classList.remove('hidden');
    filtersContainer?.classList.remove('hidden');
  }
}

// Template functions for common HTML patterns
export function createLoadingMessage(message = 'Loading...', count = 8) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton-img"></div>
      <div class="p-2 space-y-1.5 mt-1">
        <div class="skeleton-line w-3/4"></div>
        <div class="skeleton-line w-1/2 mt-1"></div>
      </div>
    </div>`;
  return card.repeat(count);
}

export function createEmptyMessage(message) {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
      <p class="empty-state-message">${message}</p>
    </div>`;
}

export function createErrorMessage(message) {
  return `<div class="${CSS_CLASSES.ERROR}">${escapeHtml(message)}</div>`;
}

export function createCheckmarkIcon() {
  const check = document.createElement('div');
  check.className = CSS_CLASSES.DOWNLOAD_BTN;
  check.innerHTML = ICONS.READ;
  return check;
}

// API client wrapper to standardize fetch calls
export async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`${state.API_BASE_URL}/api/v1/${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

export function encodePath(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function toTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function getComicById(id, includeContext = false) {
  if (!state.library) return null;
  for (const rootPath of Object.keys(state.library)) {
    const root = state.library[rootPath];
    if (!root.publishers) continue;
    for (const pubName of Object.keys(root.publishers)) {
      const pub = root.publishers[pubName];
      if (!pub.series) continue;
      for (const seriesName of Object.keys(pub.series)) {
        const seriesComics = pub.series[seriesName];
        if (!Array.isArray(seriesComics)) continue;
        const found = seriesComics.find(c => c.id == id);
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
  state.currentPageIndex = index;
  if (typeof state.renderPage === 'function') {
    state.renderPage();
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

export function buildComicDisplayInfo(comic = {}) {
  const metadata = comic.metadata || {};

  const issueNumber = pickMetadataValue(metadata, ['Number', 'Issue', 'IssueNumber', 'SortNumber', 'AlternateNumber']);
  let seriesName = pickMetadataValue(metadata, ['Series', 'SeriesName', 'AlternateSeries']);
  if (!seriesName && comic.series) {
    seriesName = toTrimmedString(comic.series);
  }
  const titleText = pickMetadataValue(metadata, ['Title', 'DisplayTitle', 'SortName', 'FullTitle', 'StoryTitle']);

  // If there's no real metadata (series is "Unknown Series"), use filename directly
  const hasNoMetadata = seriesName === 'Unknown Series' && !titleText && !issueNumber;

  const seriesWithIssue = seriesName
    ? (issueNumber ? `${seriesName} #${issueNumber}` : seriesName)
    : (issueNumber ? `Issue ${issueNumber}` : '');

  const displayTitle = hasNoMetadata
    ? (toTrimmedString(comic.name) || 'Untitled Comic')
    : ([
        seriesWithIssue,
        titleText,
        toTrimmedString(comic.title),
        toTrimmedString(comic.name)
      ].find(Boolean) || 'Untitled Comic');

  const subtitleCandidates = [
    titleText,
    toTrimmedString(comic.title),
    toTrimmedString(comic.name)
  ];
  const seen = new Set([displayTitle]);
  let subtitle = '';
  for (const candidate of subtitleCandidates) {
    const trimmed = toTrimmedString(candidate);
    if (!trimmed || seen.has(trimmed)) continue;
    if (/\.[a-z0-9]{2,4}$/i.test(trimmed)) continue; // Skip likely filenames
    subtitle = trimmed;
    break;
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
  if (state.currentView === 'root') return '/';
  if (state.currentView === 'search') {
    return `/search?q=${encodeURIComponent(state.lastSearchQuery || '')}&field=${encodeURIComponent(state.lastSearchField || 'all')}`;
  }
  if (state.currentView === 'publishers' && state.currentRootFolder) {
    return `/library?rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
  }
  if (state.currentView === 'series' && state.currentPublisher) {
    let path = `/series-list?publisher=${encodeURIComponent(state.currentPublisher)}`;
    if (state.currentRootFolder) path += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
    return path;
  }
  if (state.currentView === 'comics' && state.currentSeries) {
    let path = `/series/${encodeURIComponent(state.currentSeries)}`;
    if (state.currentPublisher) path += `?publisher=${encodeURIComponent(state.currentPublisher)}`;
    if (state.currentRootFolder) path += `&rootFolder=${encodeURIComponent(state.currentRootFolder)}`;
    return path;
  }
  if (state.currentView === 'comic' && state.currentComic) {
    return `/comic/${state.currentComic.id}/page/${(state.currentPageIndex || 0) + 1}`;
  }
  return '/';
}

// --- UI ELEMENT SELECTORS ---
export const rootFolderListDiv = document.getElementById('root-folder-list');
export const rootFolderListContainer = document.getElementById('root-folder-list-container');
export const folderListViewDiv = document.getElementById('folder-list-view');
export const folderListContainer = document.getElementById('folder-list-container');
export const searchResultsView = document.getElementById('search-results-view');
export const searchResultsTitle = document.getElementById('search-results-title');
export const searchResultsContainer = document.getElementById('search-results-container');
export const publisherListDiv = document.getElementById('publisher-list');
export const publisherListContainer = document.getElementById('publisher-list-container');
export const seriesListDiv = document.getElementById('series-list');
export const smartListView = document.getElementById('smart-list-view');
export const smartListContainer = document.getElementById('smart-list-container');
export const smartListTitle = document.getElementById('smart-list-title');
export const smartListBackBtn = document.getElementById('smart-list-back-btn');
export const filterButtonsDiv = document.getElementById('filter-buttons');
export const smartListButtonsDiv = document.getElementById('smart-list-buttons');
export const latestAddedButton = document.getElementById('latest-added-btn');
export const latestAddedCountSpan = document.getElementById('latest-added-count');
export const downloadedButton = document.getElementById('downloaded-btn');
export const downloadedCountSpan = document.getElementById('downloaded-count');
export const comicListDiv = document.getElementById('comic-list');
export const comicViewerDiv = document.getElementById('comic-viewer');
export const viewerLibrariesBtn = document.getElementById('viewer-libraries-btn');
export const viewerPublisherBtn = document.getElementById('viewer-publisher-btn');
export const viewerSeriesBtn = document.getElementById('viewer-series-btn');
export const publisherAlphaFilter = document.getElementById('publisher-alpha-filter');
export const seriesAlphaFilter = document.getElementById('series-alpha-filter');
export const comicAlphaFilter = document.getElementById('comic-alpha-filter');
export const publisherTitleH2 = document.getElementById('publisher-title');
export const seriesTitleH2 = document.getElementById('series-title');
export const comicListTitleH2 = document.getElementById('comic-list-title');
export const comicTitleH2 = document.getElementById('comic-title');
export const comicSubtitleP = document.getElementById('comic-subtitle');
export const comicSummarySection = document.getElementById('comic-summary-section');
export const comicSummaryToggle = document.getElementById('comic-summary-toggle');
export const comicSummaryContent = document.getElementById('comic-summary');
export const pageCounterSpan = document.getElementById('page-counter');
export const pageJumpInput = document.getElementById('page-jump-input');
export const pageCounterSpanBottom = document.getElementById('page-counter-bottom');
export const pageJumpInputBottom = document.getElementById('page-jump-input-bottom');
export const viewerPagesDiv = document.getElementById('viewer-pages');
export const pageLoader = document.getElementById('page-loader');
export const prevPageBtn = document.getElementById('prev-page-btn');
export const nextPageBtn = document.getElementById('next-page-btn');
export const prevPageBtnBottom = document.getElementById('prev-page-btn-bottom');
export const nextPageBtnBottom = document.getElementById('next-page-btn-bottom');
export const fullscreenBtn = document.getElementById('fullscreen-btn');
export const viewerTabBtn = document.getElementById('viewer-tab');
export const metadataTabBtn = document.getElementById('metadata-tab');
export const viewerContent = document.getElementById('viewer-content');
export const fitHeightBtn = document.getElementById('fit-height-btn');
export const orientationToggleBtn = document.getElementById('orientation-toggle-btn');
export const metadataContent = document.getElementById('metadata-content');
export const metadataForm = document.getElementById('metadata-form');
export const saveStatusDiv = document.getElementById('save-status');
export const searchForm = document.getElementById('search-form');
export const searchQueryInput = document.getElementById('search-query');
export const searchStatusDiv = document.getElementById('search-status');
export const searchResultsUl = document.getElementById('search-results');
export const librarySearchForm = document.getElementById('library-search-form');
export const librarySearchQuery = document.getElementById('library-search-query');
export const librarySearchField = document.getElementById('library-search-field');
export const clearSearchBtn = document.getElementById('clear-search-btn');
export const fullscreenViewer = document.getElementById('fullscreen-viewer');
export const fullscreenInfoBar = document.getElementById('fullscreen-info-bar');
export const fullscreenProgressIndicator = document.getElementById('fullscreen-progress-indicator');
export const fullscreenPageCounter = document.getElementById('fullscreen-page-counter');
export const fullscreenPageJumpInput = document.getElementById('fullscreen-page-jump-input');
export const fullscreenPrevPageBtn = document.getElementById('fullscreen-prev-page-btn');
export const fullscreenNextPageBtn = document.getElementById('fullscreen-next-page-btn');
export const fullscreenImage = document.getElementById('fullscreen-image');
export const fullscreenCloseBtn = document.getElementById('fullscreen-close-btn');
export const fullscreenCloseBtnBottom = document.getElementById('fullscreen-close-btn-bottom');
export const fullscreenTitle = document.getElementById('fullscreen-title');
export const fullscreenControls = document.getElementById('fullscreen-controls');
export const fullscreenOrientationBtn = document.getElementById('fullscreen-orientation-btn');
export const fullscreenNavLeft = document.getElementById('fullscreen-nav-left');
export const fullscreenNavRight = document.getElementById('fullscreen-nav-right');
export const settingsModal = document.getElementById('settings-modal');
export const settingsForm = document.getElementById('settings-form');
export const scanIntervalInput = document.getElementById('scan-interval-input');
export const apiKeyInput = document.getElementById('api-key-input');
export const settingsStatusDiv = document.getElementById('settings-status');
export const scanButton = document.getElementById('scan-button');
export const fullScanButton = document.getElementById('full-scan-button');
export const logsContainer = document.getElementById('logs-container');
export const downloadsInfoDiv = document.getElementById('downloads-info');
export const clearDownloadsBtn = document.getElementById('clear-downloads-btn');
export const downloadQueueDiv = document.getElementById('download-queue');
export const settingsTabDevices = document.getElementById('settings-tab-devices');
export const settingsContentDevices = document.getElementById('settings-content-devices');
export const devicesStatusDiv = document.getElementById('devices-status');
export const devicesListDiv = document.getElementById('devices-list');
export const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
export const ctButton = document.getElementById('ct-button');
export const ctModal = document.getElementById('ct-modal');
export const ctScheduleInput = document.getElementById('ct-schedule-input');
export const ctSaveBtn = document.getElementById('ct-save-btn');
export const ctMatchBody = document.getElementById('ct-match-body');
export const ctApplyBtn = document.getElementById('ct-apply-btn');
export const ctSkipBtn = document.getElementById('ct-skip-btn');
export const ctConfirmBar = document.getElementById('ct-confirm-bar');
export const ctConfirmMessage = document.getElementById('ct-confirm-message');
export const ctConfirmYes = document.getElementById('ct-confirm-yes');
export const ctConfirmNo = document.getElementById('ct-confirm-no');
export const ctOutputDiv = document.getElementById('ct-output');
export const ctClearOutputBtn = document.getElementById('ct-clear-output');
export const ctRunBtn = document.getElementById('ct-run-btn');
export const ctTabSettings = document.getElementById('ct-tab-settings');
export const ctTabMatches = document.getElementById('ct-tab-matches');
export const ctTabOutput = document.getElementById('ct-tab-output');
export const ctTabManagement = document.getElementById('ct-tab-management');
export const ctContentSettings = document.getElementById('ct-content-settings');
export const ctContentMatches = document.getElementById('ct-content-matches');
export const ctContentOutput = document.getElementById('ct-content-output');
export const ctContentManagement = document.getElementById('ct-content-management');
export const ctMatchesBadge = document.getElementById('ct-matches-badge');

// --- STATE MANAGEMENT ---
export const state = {
  APP_CONFIG: window.APP_CONFIG || {}, // Dynamically injected app config
  API_BASE_URL: '',
  library: {},
  lastSearchQuery: '',
  lastSearchField: 'all',
  lastSearchResults: null,
  activeAlphaFilter: 'All',
  configuredRootFolders: [],
  activeFilter: 'all',
  activeSmartFilter: null,
  smartListViewMode: 'folders',
  currentPageIndex: 0,
  currentComic: null,
  currentMetadata: null,
  currentRootFolder: null,
  currentPublisher: null,
  currentSeries: null,
  currentFolderPath: null,
  currentView: 'root',
  viewerReturnContext: null,
  db: null,
  downloadedComicIds: new Set(),
  preloadedImages: new Map(),
  pageUrlCache: new Map(),
  PRELOAD_AHEAD_COUNT: 5,
  downloadQueue: [],
  isFullscreenZoomed: false,
  fullscreenZoomScale: 1,
  fullscreenZoomBaseWidth: 0,
  fullscreenZoomBaseHeight: 0,
  isFitToHeight: false,
  isLandscapeOrientation: false,
  logInterval: null,
  ctEventSource: null,
  ctAwaitingMatches: false,
  _isNavigatingFromRouter: false,
  _isAppInitializing: false,
  router: null,
  // Dynamic callbacks registered by other modules
  renderPage: null,
  applyFilterAndRender: null,
  showComicList: null,
  showSeriesList: null,
  showPublisherList: null,
  showLatestAddedSmartList: null,
  showDownloadedSmartList: null,
  stopRenameStream: null,
  stopMoveStream: null,
  syncZoomToggleButton: null,
  onFullscreenReset: null,
  applyFullscreenFitMode: null
};

export function resetFullscreenZoom() {
  fullscreenImage.style.transform = '';
  fullscreenImage.style.transformOrigin = '';
  fullscreenImage.style.cursor = 'default';
  fullscreenImage.style.width = '';
  fullscreenImage.style.height = '';
  fullscreenImage.style.maxWidth = '';
  fullscreenImage.style.maxHeight = '';
  fullscreenImage.style.margin = 'auto';
  fullscreenImage.style.touchAction = '';
  fullscreenViewer.scrollTop = 0;
  fullscreenViewer.scrollLeft = 0;
  fullscreenNavLeft.classList.remove('hidden');
  fullscreenNavRight.classList.remove('hidden');
  
  state.isFullscreenZoomed = false;
  state.fullscreenZoomScale = 1;
  state.fullscreenZoomBaseWidth = 0;
  state.fullscreenZoomBaseHeight = 0;

  if (typeof state.onFullscreenReset === 'function') {
    state.onFullscreenReset();
  }
  if (typeof state.applyFullscreenFitMode === 'function') {
    state.applyFullscreenFitMode();
  }
  if (typeof state.syncZoomToggleButton === 'function') {
    state.syncZoomToggleButton();
  }
}

// Register all exported functions, constants, and UI selectors on state & window for Proxy accessibility
const globalsObj = {
  escapeHtml,
  safeDirName,
  getRelativePath,
  debugLog,
  enableComicsNowDebug,
  disableComicsNowDebug,
  isComicsNowDebugEnabled,
  showView,
  createLoadingMessage,
  createEmptyMessage,
  createErrorMessage,
  createCheckmarkIcon,
  apiCall,
  encodePath,
  toTrimmedString,
  getComicById,
  turnToPage,
  pickMetadataValue,
  buildComicDisplayInfo,
  applyDisplayInfoToComic,
  applyDisplayInfoToLibrary,
  getPathForCurrentView,
  resetFullscreenZoom,

  // Constants
  ICONS,
  CSS_CLASSES,

  // UI Element Selectors
  rootFolderListDiv,
  rootFolderListContainer,
  folderListViewDiv,
  folderListContainer,
  searchResultsView,
  searchResultsTitle,
  searchResultsContainer,
  publisherListDiv,
  publisherListContainer,
  seriesListDiv,
  smartListView,
  smartListContainer,
  smartListTitle,
  smartListBackBtn,
  filterButtonsDiv,
  smartListButtonsDiv,
  latestAddedButton,
  latestAddedCountSpan,
  downloadedButton,
  downloadedCountSpan,
  comicListDiv,
  comicViewerDiv,
  viewerLibrariesBtn,
  viewerPublisherBtn,
  viewerSeriesBtn,
  publisherAlphaFilter,
  seriesAlphaFilter,
  comicAlphaFilter,
  publisherTitleH2,
  seriesTitleH2,
  comicListTitleH2,
  comicTitleH2,
  comicSubtitleP,
  comicSummarySection,
  comicSummaryToggle,
  comicSummaryContent,
  pageCounterSpan,
  pageJumpInput,
  pageCounterSpanBottom,
  pageJumpInputBottom,
  viewerPagesDiv,
  pageLoader,
  prevPageBtn,
  nextPageBtn,
  prevPageBtnBottom,
  nextPageBtnBottom,
  fullscreenBtn,
  viewerTabBtn,
  metadataTabBtn,
  viewerContent,
  fitHeightBtn,
  orientationToggleBtn,
  metadataContent,
  metadataForm,
  saveStatusDiv,
  searchForm,
  searchQueryInput,
  searchStatusDiv,
  searchResultsUl,
  librarySearchForm,
  librarySearchQuery,
  librarySearchField,
  clearSearchBtn,
  fullscreenViewer,
  fullscreenInfoBar,
  fullscreenProgressIndicator,
  fullscreenPageCounter,
  fullscreenPageJumpInput,
  fullscreenPrevPageBtn,
  fullscreenNextPageBtn,
  fullscreenImage,
  fullscreenCloseBtn,
  fullscreenCloseBtnBottom,
  fullscreenTitle,
  fullscreenControls,
  fullscreenOrientationBtn,
  fullscreenNavLeft,
  fullscreenNavRight,
  settingsModal,
  settingsForm,
  scanIntervalInput,
  apiKeyInput,
  settingsStatusDiv,
  scanButton,
  fullScanButton,
  logsContainer,
  downloadsInfoDiv,
  clearDownloadsBtn,
  downloadQueueDiv,
  settingsTabDevices,
  settingsContentDevices,
  devicesStatusDiv,
  devicesListDiv,
  refreshDevicesBtn,
  ctButton,
  ctModal,
  ctScheduleInput,
  ctSaveBtn,
  ctMatchBody,
  ctApplyBtn,
  ctSkipBtn,
  ctConfirmBar,
  ctConfirmMessage,
  ctConfirmYes,
  ctConfirmNo,
  ctOutputDiv,
  ctClearOutputBtn,
  ctRunBtn,
  ctTabSettings,
  ctTabMatches,
  ctTabOutput,
  ctTabManagement,
  ctContentSettings,
  ctContentMatches,
  ctContentOutput,
  ctContentManagement,
  ctMatchesBadge
};

Object.assign(state, globalsObj);
if (typeof window !== 'undefined') {
  Object.assign(window, globalsObj);
}

