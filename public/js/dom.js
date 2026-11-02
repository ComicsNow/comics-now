/**
 * Centralized DOM element queries for Comics Now.
 * Allows modules to import specific elements directly without polluting global window or state namespaces.
 */

function getEl(id) {
  return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

export const rootFolderListDiv = getEl('root-folder-list');
export const rootFolderListContainer = getEl('root-folder-list-container');
export const folderListViewDiv = getEl('folder-list-view');
export const folderListContainer = getEl('folder-list-container');
export const searchResultsView = getEl('search-results-view');
export const searchResultsTitle = getEl('search-results-title');
export const searchResultsContainer = getEl('search-results-container');
export const publisherListDiv = getEl('publisher-list');
export const publisherListContainer = getEl('publisher-list-container');
export const seriesListDiv = getEl('series-list');
export const smartListView = getEl('smart-list-view');
export const smartListContainer = getEl('smart-list-container');
export const smartListTitle = getEl('smart-list-title');
export const filterButtonsDiv = getEl('filter-buttons');
export const smartListButtonsDiv = getEl('smart-list-buttons');
export const latestAddedButton = getEl('latest-added-btn');
export const latestAddedCountSpan = getEl('latest-added-count');
export const downloadedButton = getEl('downloaded-btn');
export const downloadedCountSpan = getEl('downloaded-count');
export const comicListDiv = getEl('comic-list');
export const comicViewerDiv = getEl('comic-viewer');
export const publisherAlphaFilter = getEl('publisher-alpha-filter');
export const seriesAlphaFilter = getEl('series-alpha-filter');
export const seriesSortContainer = getEl('series-sort-container');
export const seriesSortSelect = getEl('series-sort-select');
export const comicAlphaFilter = getEl('comic-alpha-filter');
export const folderAlphaFilter = getEl('folder-alpha-filter');
export const publisherTitleH2 = getEl('publisher-title');
export const seriesTitleH2 = getEl('series-title');
export const comicListTitleH2 = getEl('comic-list-title');
export const comicTitleH2 = getEl('comic-title');
export const comicSubtitleP = getEl('comic-subtitle');
export const comicSummarySection = getEl('comic-summary-section');
export const comicSummaryToggle = getEl('comic-summary-toggle');
export const comicSummaryContent = getEl('comic-summary');
export const pageCounterSpan = getEl('page-counter');
export const pageJumpInput = getEl('page-jump-input');
export const pageCounterSpanBottom = getEl('page-counter-bottom');
export const pageJumpInputBottom = getEl('page-jump-input-bottom');
export const viewerPagesDiv = getEl('viewer-pages');
export const pageLoader = getEl('page-loader');
export const prevPageBtn = getEl('prev-page-btn');
export const nextPageBtn = getEl('next-page-btn');
export const prevPageBtnBottom = getEl('prev-page-btn-bottom');
export const nextPageBtnBottom = getEl('next-page-btn-bottom');
export const fullscreenBtn = getEl('fullscreen-btn');
export const viewerTabBtn = getEl('viewer-tab');
export const metadataTabBtn = getEl('metadata-tab');
export const viewerContent = getEl('viewer-content');
export const fitHeightBtn = getEl('fit-height-btn');
export const orientationToggleBtn = getEl('orientation-toggle-btn');
export const metadataContent = getEl('metadata-content');
export const metadataForm = getEl('metadata-form');
export const saveStatusDiv = getEl('save-status');
export const searchForm = getEl('search-form');
export const searchQueryInput = getEl('search-query');
export const searchStatusDiv = getEl('search-status');
export const searchResultsUl = getEl('search-results');
export const librarySearchForm = getEl('library-search-form');
export const librarySearchQuery = getEl('library-search-query');
export const librarySearchField = getEl('library-search-field');
export const clearSearchBtn = getEl('clear-search-btn');
export const fullscreenViewer = getEl('fullscreen-viewer');
export const fullscreenInfoBar = getEl('fullscreen-info-bar');
export const fullscreenProgressIndicator = getEl('fullscreen-progress-indicator');
export const fullscreenPageCounter = getEl('fullscreen-page-counter');
export const fullscreenPageJumpInput = getEl('fullscreen-page-jump-input');
export const fullscreenPrevPageBtn = getEl('fullscreen-prev-page-btn');
export const fullscreenNextPageBtn = getEl('fullscreen-next-page-btn');
export const fullscreenImage = getEl('fullscreen-image');
export const fullscreenCloseBtn = getEl('fullscreen-close-btn');
export const fullscreenCloseBtnBottom = getEl('fullscreen-close-btn-bottom');
export const fullscreenTitle = getEl('fullscreen-title');
export const fullscreenControls = getEl('fullscreen-controls');
export const fullscreenOrientationBtn = getEl('fullscreen-orientation-btn');
export const fullscreenNavLeft = getEl('fullscreen-nav-left');
export const fullscreenNavRight = getEl('fullscreen-nav-right');
export const settingsModal = getEl('settings-modal');
export const settingsForm = getEl('settings-form');
export const scanIntervalInput = getEl('scan-interval-input');
export const settingsStatusDiv = getEl('settings-status');
export const scanButton = getEl('scan-button');
export const fullScanButton = getEl('full-scan-button');
export const logsContainer = getEl('logs-container');
export const downloadsInfoDiv = getEl('downloads-info');
export const clearDownloadsBtn = getEl('clear-downloads-btn');
export const downloadQueueDiv = getEl('download-queue');
export const settingsTabDevices = getEl('settings-tab-devices');
export const settingsContentDevices = getEl('settings-content-devices');
export const devicesStatusDiv = getEl('devices-status');
export const devicesListDiv = getEl('devices-list');
export const refreshDevicesBtn = getEl('refresh-devices-btn');
export const ctButton = getEl('ct-button');
export const ctModal = getEl('ct-modal');
export const ctScheduleInput = getEl('ct-schedule-input');
export const ctSaveBtn = getEl('ct-save-btn');
export const ctMatchBody = getEl('ct-match-body');
export const ctApplyBtn = getEl('ct-apply-btn');
export const ctSkipBtn = getEl('ct-skip-btn');
export const ctConfirmBar = getEl('ct-confirm-bar');
export const ctConfirmMessage = getEl('ct-confirm-message');
export const ctConfirmYes = getEl('ct-confirm-yes');
export const ctConfirmNo = getEl('ct-confirm-no');
export const ctOutputDiv = getEl('ct-output');
export const ctClearOutputBtn = getEl('ct-clear-output');
export const ctRunBtn = getEl('ct-run-btn');
export const ctCancelBtn = getEl('ct-cancel-btn');
export const ctTabSettings = getEl('ct-tab-settings');
export const ctTabGemini = getEl('ct-tab-gemini');
export const ctTabMatches = getEl('ct-tab-matches');
export const ctTabOutput = getEl('ct-tab-output');
export const ctTabLogs = getEl('ct-tab-logs');
export const ctTabManagement = getEl('ct-tab-management');
export const ctContentSettings = getEl('ct-content-settings');
export const ctContentGemini = getEl('ct-content-gemini');
export const ctContentMatches = getEl('ct-content-matches');
export const ctContentOutput = getEl('ct-content-output');
export const ctContentLogs = getEl('ct-content-logs');
export const ctContentManagement = getEl('ct-content-management');
export const ctMatchesBadge = getEl('ct-matches-badge');

const elementCache = new Map();
export function getElement(id) {
  if (!elementCache.has(id)) {
    elementCache.set(id, getEl(id));
  }
  return elementCache.get(id);
}
