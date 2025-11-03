// --- PWA Service Worker ---
// --- PWA Service Worker ---
// (We register it after we know the base URL in initializeApp)


// Save original console methods before any modifications
const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

// Silence all non-error console output
console.log = function() {};
console.info = function() {};
console.debug = function() {};


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

function debugLog(category, ...args) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  if (!isDebugCategoryEnabled(normalizedCategory)) {
    return;
  }
  rawConsole.log(`[${normalizedCategory || 'DEBUG'}]`, ...args);
}

function enableComicsNowDebug(...categories) {
  const normalized = normalizeDebugCategories(categories);
  DEBUG_LOG_STATE.enabled = true;
  DEBUG_LOG_STATE.categories = new Set(normalized);
  rawConsole.log('[DEBUG]', 'Debug logging enabled', normalized.length ? `for categories: ${normalized.join(', ')}` : 'for all categories');
}

function disableComicsNowDebug() {
  DEBUG_LOG_STATE.enabled = false;
  DEBUG_LOG_STATE.categories.clear();
  rawConsole.log('[DEBUG]', 'Debug logging disabled');
}

function isComicsNowDebugEnabled(category) {
  const normalizedCategory = typeof category === 'string' ? category.toUpperCase() : '';
  return isDebugCategoryEnabled(normalizedCategory);
}

if (typeof window !== 'undefined') {
  window.debugLog = debugLog;
  window.enableComicsNowDebug = enableComicsNowDebug;
  window.disableComicsNowDebug = disableComicsNowDebug;
  window.isComicsNowDebugEnabled = isComicsNowDebugEnabled;
}


let API_BASE_URL = ''; // Will be set on initial load

// CSS class constants to eliminate duplication
const CSS_CLASSES = {
  CARD: 'bg-gray-800 rounded-lg shadow-lg cursor-pointer',
  INPUT: 'bg-gray-700 text-white p-2 rounded-lg',
  BUTTON_PRIMARY: 'bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full',
  BUTTON_SECONDARY: 'bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg',
  LOADING: 'bg-gray-800 rounded-lg p-6 text-center text-gray-500 animate-pulse col-span-full',
  ERROR: 'bg-gray-800 rounded-lg p-6 text-center text-red-400 col-span-full',
  DOWNLOAD_BTN: 'download-btn absolute top-2 right-2 text-green-400 pointer-events-none'
};

// View management utility to eliminate duplication
function showView(targetView) {
  const views = [
    rootFolderListDiv,
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
function createLoadingMessage(message = 'Loading...') {
  return `<div class="${CSS_CLASSES.LOADING}">${message}</div>`;
}

function createErrorMessage(message) {
  return `<div class="${CSS_CLASSES.ERROR}">${message}</div>`;
}

function createCheckmarkIcon() {
  const check = document.createElement('div');
  check.className = CSS_CLASSES.DOWNLOAD_BTN;
  check.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
  </svg>`;
  return check;
}

// API client wrapper to standardize fetch calls
async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/${endpoint}`, {
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

function encodePath(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function toTrimmedString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function pickMetadataValue(metadata = {}, keys = []) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      const candidate = toTrimmedString(metadata[key]);
      if (candidate) return candidate;
    }
  }
  return '';
}

function buildComicDisplayInfo(comic = {}) {
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

function applyDisplayInfoToComic(comic) {
  if (!comic || typeof comic !== 'object') return buildComicDisplayInfo();
  const info = buildComicDisplayInfo(comic);
  comic.displayName = info.displayTitle;
  comic.subtitle = info.subtitle;
  comic.altText = info.altText;
  return info;
}

function applyDisplayInfoToLibrary(libraryData) {
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

// --- UI ELEMENT SELECTORS ---
const rootFolderListDiv = document.getElementById('root-folder-list');
const rootFolderListContainer = document.getElementById('root-folder-list-container');
const searchResultsView = document.getElementById('search-results-view');
const searchResultsTitle = document.getElementById('search-results-title');
const searchResultsContainer = document.getElementById('search-results-container');
const publisherListDiv = document.getElementById('publisher-list');
const publisherListContainer = document.getElementById('publisher-list-container');
const seriesListDiv = document.getElementById('series-list');
const smartListView = document.getElementById('smart-list-view');
const smartListContainer = document.getElementById('smart-list-container');
const smartListTitle = document.getElementById('smart-list-title');
const smartListBackBtn = document.getElementById('smart-list-back-btn');
const filterButtonsDiv = document.getElementById('filter-buttons');
const smartListButtonsDiv = document.getElementById('smart-list-buttons');
const latestAddedButton = document.getElementById('latest-added-btn');
const latestAddedCountSpan = document.getElementById('latest-added-count');
const downloadedButton = document.getElementById('downloaded-btn');
const downloadedCountSpan = document.getElementById('downloaded-count');
const comicListDiv = document.getElementById('comic-list');
const comicViewerDiv = document.getElementById('comic-viewer');
const viewerLibrariesBtn = document.getElementById('viewer-libraries-btn');
const viewerPublisherBtn = document.getElementById('viewer-publisher-btn');
const viewerSeriesBtn = document.getElementById('viewer-series-btn');
const viewerBackBtn = document.getElementById('viewer-back-btn');
const publisherAlphaFilter = document.getElementById('publisher-alpha-filter');
const seriesAlphaFilter = document.getElementById('series-alpha-filter');
const comicAlphaFilter = document.getElementById('comic-alpha-filter');
const publisherTitleH2 = document.getElementById('publisher-title');
const seriesTitleH2 = document.getElementById('series-title');
const comicListTitleH2 = document.getElementById('comic-list-title');
const comicTitleH2 = document.getElementById('comic-title');
const comicSubtitleP = document.getElementById('comic-subtitle');
const comicSummarySection = document.getElementById('comic-summary-section');
const comicSummaryToggle = document.getElementById('comic-summary-toggle');
const comicSummaryContent = document.getElementById('comic-summary');
const pageCounterSpan = document.getElementById('page-counter');
const pageJumpInput = document.getElementById('page-jump-input');
const pageCounterSpanBottom = document.getElementById('page-counter-bottom');
const pageJumpInputBottom = document.getElementById('page-jump-input-bottom');
const viewerPagesDiv = document.getElementById('viewer-pages');
const pageLoader = document.getElementById('page-loader');
const prevPageBtn = document.getElementById('prev-page-btn');
const nextPageBtn = document.getElementById('next-page-btn');
const prevPageBtnBottom = document.getElementById('prev-page-btn-bottom');
const nextPageBtnBottom = document.getElementById('next-page-btn-bottom');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const viewerTabBtn = document.getElementById('viewer-tab');
const metadataTabBtn = document.getElementById('metadata-tab');
const viewerContent = document.getElementById('viewer-content');
const fitHeightBtn = document.getElementById('fit-height-btn');
const orientationToggleBtn = document.getElementById('orientation-toggle-btn');
const metadataContent = document.getElementById('metadata-content');
const metadataForm = document.getElementById('metadata-form');
const saveStatusDiv = document.getElementById('save-status');
const searchForm = document.getElementById('search-form');
const searchQueryInput = document.getElementById('search-query');
const searchStatusDiv = document.getElementById('search-status');
const searchResultsUl = document.getElementById('search-results');
const librarySearchForm = document.getElementById('library-search-form');
const librarySearchQuery = document.getElementById('library-search-query');
const librarySearchField = document.getElementById('library-search-field');
const clearSearchBtn = document.getElementById('clear-search-btn');
const fullscreenViewer = document.getElementById('fullscreen-viewer');
const fullscreenInfoBar = document.getElementById('fullscreen-info-bar');
const fullscreenProgressIndicator = document.getElementById('fullscreen-progress-indicator');
const fullscreenPageCounter = document.getElementById('fullscreen-page-counter');
const fullscreenPageJumpInput = document.getElementById('fullscreen-page-jump-input');
const fullscreenPrevPageBtn = document.getElementById('fullscreen-prev-page-btn');
const fullscreenNextPageBtn = document.getElementById('fullscreen-next-page-btn');
const fullscreenImage = document.getElementById('fullscreen-image');
fullscreenImage.crossOrigin = 'anonymous';
const fullscreenCloseBtn = document.getElementById('fullscreen-close-btn');
const fullscreenCloseBtnBottom = document.getElementById('fullscreen-close-btn-bottom');
const fullscreenControls = document.getElementById('fullscreen-controls');
const fullscreenOrientationBtn = document.getElementById('fullscreen-orientation-btn');
const fullscreenNavLeft = document.getElementById('fullscreen-nav-left');
const fullscreenNavRight = document.getElementById('fullscreen-nav-right');
const settingsModal = document.getElementById('settings-modal');
const settingsForm = document.getElementById('settings-form');
const scanIntervalInput = document.getElementById('scan-interval-input');
const apiKeyInput = document.getElementById('api-key-input');
const settingsStatusDiv = document.getElementById('settings-status');
const scanButton = document.getElementById('scan-button');
const fullScanButton = document.getElementById('full-scan-button');
const logsContainer = document.getElementById('logs-container');
const downloadsInfoDiv = document.getElementById('downloads-info');
const clearDownloadsBtn = document.getElementById('clear-downloads-btn');
const downloadQueueDiv = document.getElementById('download-queue');
const settingsTabDevices = document.getElementById('settings-tab-devices');
const settingsContentDevices = document.getElementById('settings-content-devices');
const devicesStatusDiv = document.getElementById('devices-status');
const devicesListDiv = document.getElementById('devices-list');
const refreshDevicesBtn = document.getElementById('refresh-devices-btn');
const ctButton = document.getElementById('ct-button');
const ctModal = document.getElementById('ct-modal');
const ctScheduleInput = document.getElementById('ct-schedule-input');
const ctSaveBtn = document.getElementById('ct-save-btn');
const ctMatchBody = document.getElementById('ct-match-body');
const ctApplyBtn = document.getElementById('ct-apply-btn');
const ctSkipBtn = document.getElementById('ct-skip-btn');
const ctConfirmBar = document.getElementById('ct-confirm-bar');
const ctConfirmMessage = document.getElementById('ct-confirm-message');
const ctConfirmYes = document.getElementById('ct-confirm-yes');
const ctConfirmNo = document.getElementById('ct-confirm-no');
const ctOutputDiv = document.getElementById('ct-output');
const ctClearOutputBtn = document.getElementById('ct-clear-output');
const ctRunBtn = document.getElementById('ct-run-btn');
const ctTabSettings = document.getElementById('ct-tab-settings');
const ctTabOutput = document.getElementById('ct-tab-output');
const ctContentSettings = document.getElementById('ct-content-settings');
const ctContentOutput = document.getElementById('ct-content-output');
let logInterval = null;
let ctEventSource = null;
let ctAwaitingMatches = false;
let ctPollInterval = null;

// --- STATE MANAGEMENT ---
let library = {};
let configuredRootFolders = [];
// Simplified to only support 'all' filter - smart lists removed
let activeFilter = 'all';
let currentPageIndex = 0;
let currentComic = null;
let currentMetadata = null;
let currentRootFolder = null;
let currentPublisher = null;
let currentSeries = null;
let currentView = 'root';
let viewerReturnContext = null;
let db; // IndexedDB handle
let downloadedComicIds = new Set();
let preloadedImages = new Map(); // Cache of preloaded Image objects keyed by URL
const pageUrlCache = new Map(); // Cache of generated page URLs by page name

const PRELOAD_AHEAD_COUNT = 5; // Number of pages to preload ahead of the current one
let downloadQueue = [];
let isFullscreenZoomed = false;
let fullscreenZoomScale = 1;
let fullscreenZoomBaseWidth = 0;
let fullscreenZoomBaseHeight = 0;
let isFitToHeight = false;
let isLandscapeOrientation = false;

function resetFullscreenZoom() {
  fullscreenImage.style.transform = '';
  fullscreenImage.style.transformOrigin = '';
  fullscreenImage.style.cursor = 'zoom-in';
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
  // Update both local variables and window properties for consistency
  isFullscreenZoomed = false;
  fullscreenZoomScale = 1;
  fullscreenZoomBaseWidth = 0;
  fullscreenZoomBaseHeight = 0;
  if (typeof window !== 'undefined') {
    window.isFullscreenZoomed = false;
    window.fullscreenZoomScale = 1;
    window.fullscreenZoomBaseWidth = 0;
    window.fullscreenZoomBaseHeight = 0;
  }
  if (typeof onFullscreenReset === 'function') {
    onFullscreenReset();
  }
  if (typeof applyFullscreenFitMode === 'function') {
    applyFullscreenFitMode();
  }
}

// Make key variables globally accessible
if (typeof window !== 'undefined') {
  window.currentPageIndex = currentPageIndex;
  window.currentComic = currentComic;
  window.currentMetadata = currentMetadata;
  window.currentRootFolder = currentRootFolder;
  window.currentPublisher = currentPublisher;
  window.currentSeries = currentSeries;
  window.currentView = currentView;
  window.viewerReturnContext = viewerReturnContext;
  window.library = library;
  window.configuredRootFolders = configuredRootFolders;
  window.activeFilter = activeFilter;
  window.downloadedComicIds = downloadedComicIds;
  window.preloadedImages = preloadedImages;
  window.pageUrlCache = pageUrlCache;
  window.PRELOAD_AHEAD_COUNT = PRELOAD_AHEAD_COUNT;
  window.isFitToHeight = isFitToHeight;
  window.isLandscapeOrientation = isLandscapeOrientation;
  window.isFullscreenZoomed = isFullscreenZoomed;
  window.fullscreenZoomScale = fullscreenZoomScale;
  window.fullscreenZoomBaseWidth = fullscreenZoomBaseWidth;
  window.fullscreenZoomBaseHeight = fullscreenZoomBaseHeight;

  // Expose UI elements
  window.comicViewerDiv = comicViewerDiv;
  window.comicListDiv = comicListDiv;
  window.smartListView = smartListView;
  window.searchResultsView = searchResultsView;
  window.comicTitleH2 = comicTitleH2;
  window.comicSubtitleP = comicSubtitleP;
  window.comicSummarySection = comicSummarySection;
  window.comicSummaryToggle = comicSummaryToggle;
  window.comicSummaryContent = comicSummaryContent;
  window.metadataTabBtn = metadataTabBtn;
  window.metadataContent = metadataContent;
  window.metadataForm = metadataForm;
  window.viewerContent = viewerContent;
  window.viewerPagesDiv = viewerPagesDiv;
  window.pageLoader = pageLoader;
  window.pageCounterSpan = pageCounterSpan;
  window.pageJumpInput = pageJumpInput;
  window.pageCounterSpanBottom = pageCounterSpanBottom;
  window.pageJumpInputBottom = pageJumpInputBottom;
  window.prevPageBtn = prevPageBtn;
  window.nextPageBtn = nextPageBtn;
  window.prevPageBtnBottom = prevPageBtnBottom;
  window.nextPageBtnBottom = nextPageBtnBottom;
  window.viewerTabBtn = viewerTabBtn;

  // Expose viewer navigation buttons
  window.viewerLibrariesBtn = viewerLibrariesBtn;
  window.viewerPublisherBtn = viewerPublisherBtn;
  window.viewerSeriesBtn = viewerSeriesBtn;
  window.viewerBackBtn = viewerBackBtn;

  // Expose viewer control buttons
  window.fitHeightBtn = fitHeightBtn;
  window.orientationToggleBtn = orientationToggleBtn;
  window.fullscreenBtn = fullscreenBtn;
  window.fullscreenViewer = fullscreenViewer;
  window.fullscreenImage = fullscreenImage;
  window.fullscreenOrientationBtn = fullscreenOrientationBtn;
  window.fullscreenCloseBtn = fullscreenCloseBtn;
  window.fullscreenCloseBtnBottom = fullscreenCloseBtnBottom;
  window.fullscreenNavLeft = fullscreenNavLeft;
  window.fullscreenNavRight = fullscreenNavRight;
  window.fullscreenControls = fullscreenControls;
  window.fullscreenInfoBar = fullscreenInfoBar;
  window.fullscreenProgressIndicator = fullscreenProgressIndicator;
  window.fullscreenPageCounter = fullscreenPageCounter;
  window.fullscreenPageJumpInput = fullscreenPageJumpInput;
  window.fullscreenPrevPageBtn = fullscreenPrevPageBtn;
  window.fullscreenNextPageBtn = fullscreenNextPageBtn;

  // Expose navigation functions (will be set by render.js)
  window.showView = window.showView || showView;
  window.applyFilterAndRender = null; // Will be set by render.js
  window.showComicList = null; // Will be set by render.js
  window.showSeriesList = null; // Will be set by render.js
  window.showPublisherList = null; // Will be set by render.js
  window.showLatestAddedSmartList = null; // Will be set by render.js
  window.showLatestConvertedSmartList = null; // Will be set by render.js
  window.showDownloadedSmartList = null; // Will be set by render.js
}

