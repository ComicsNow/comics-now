/**
 * Comics Now! - UI Element Selectors & Fullscreen Controls
 *
 * Pre-cached DOM references and fullscreen zoom reset handlers.
 */

const doc = typeof document !== 'undefined' ? document : { getElementById: () => null };

export const rootFolderListDiv = doc.getElementById('root-folder-list');
export const rootFolderListContainer = doc.getElementById('root-folder-list-container');
export const folderListViewDiv = doc.getElementById('folder-list-view');
export const folderListContainer = doc.getElementById('folder-list-container');
export const searchResultsView = doc.getElementById('search-results-view');
export const searchResultsTitle = doc.getElementById('search-results-title');
export const searchResultsContainer = doc.getElementById('search-results-container');
export const publisherListDiv = doc.getElementById('publisher-list');
export const publisherListContainer = doc.getElementById('publisher-list-container');
export const seriesListDiv = doc.getElementById('series-list');
export const smartListView = doc.getElementById('smart-list-view');
export const smartListContainer = doc.getElementById('smart-list-container');
export const smartListTitle = doc.getElementById('smart-list-title');
export const filterButtonsDiv = doc.getElementById('filter-buttons');
export const smartListButtonsDiv = doc.getElementById('smart-list-buttons');
export const latestAddedButton = doc.getElementById('latest-added-btn');
export const latestAddedCountSpan = doc.getElementById('latest-added-count');
export const downloadedButton = doc.getElementById('downloaded-btn');
export const downloadedCountSpan = doc.getElementById('downloaded-count');
export const comicListDiv = doc.getElementById('comic-list');
export const comicViewerDiv = doc.getElementById('comic-viewer');
export const publisherAlphaFilter = doc.getElementById('publisher-alpha-filter');
export const seriesAlphaFilter = doc.getElementById('series-alpha-filter');
export const seriesSortContainer = doc.getElementById('series-sort-container');
export const seriesSortSelect = doc.getElementById('series-sort-select');
export const comicAlphaFilter = doc.getElementById('comic-alpha-filter');
export const folderAlphaFilter = doc.getElementById('folder-alpha-filter');
export const publisherTitleH2 = doc.getElementById('publisher-title');
export const seriesTitleH2 = doc.getElementById('series-title');
export const comicListTitleH2 = doc.getElementById('comic-list-title');
export const comicTitleH2 = doc.getElementById('comic-title');
export const comicSubtitleP = doc.getElementById('comic-subtitle');
export const comicSummarySection = doc.getElementById('comic-summary-section');
export const comicSummaryToggle = doc.getElementById('comic-summary-toggle');
export const comicSummaryContent = doc.getElementById('comic-summary');
export const pageCounterSpan = doc.getElementById('page-counter');
export const pageJumpInput = doc.getElementById('page-jump-input');
export const pageCounterSpanBottom = doc.getElementById('page-counter-bottom');
export const pageJumpInputBottom = doc.getElementById('page-jump-input-bottom');
export const viewerPagesDiv = doc.getElementById('viewer-pages');
export const pageLoader = doc.getElementById('page-loader');
export const prevPageBtn = doc.getElementById('prev-page-btn');
export const nextPageBtn = doc.getElementById('next-page-btn');
export const prevPageBtnBottom = doc.getElementById('prev-page-btn-bottom');
export const nextPageBtnBottom = doc.getElementById('next-page-btn-bottom');
export const fullscreenBtn = doc.getElementById('fullscreen-btn');
export const viewerTabBtn = doc.getElementById('viewer-tab');
export const metadataTabBtn = doc.getElementById('metadata-tab');
export const viewerContent = doc.getElementById('viewer-content');
export const fitHeightBtn = doc.getElementById('fit-height-btn');
export const orientationToggleBtn = doc.getElementById('orientation-toggle-btn');
export const metadataContent = doc.getElementById('metadata-content');
export const metadataForm = doc.getElementById('metadata-form');
export const saveStatusDiv = doc.getElementById('save-status');
export const searchForm = doc.getElementById('search-form');
export const searchQueryInput = doc.getElementById('search-query');
export const searchStatusDiv = doc.getElementById('search-status');
export const searchResultsUl = doc.getElementById('search-results');
export const librarySearchForm = doc.getElementById('library-search-form');
export const librarySearchQuery = doc.getElementById('library-search-query');
export const librarySearchField = doc.getElementById('library-search-field');
export const clearSearchBtn = doc.getElementById('clear-search-btn');
export const fullscreenViewer = doc.getElementById('fullscreen-viewer');
export const fullscreenInfoBar = doc.getElementById('fullscreen-info-bar');
export const fullscreenProgressIndicator = doc.getElementById('fullscreen-progress-indicator');
export const fullscreenPageCounter = doc.getElementById('fullscreen-page-counter');
export const fullscreenPageJumpInput = doc.getElementById('fullscreen-page-jump-input');
export const fullscreenPrevPageBtn = doc.getElementById('fullscreen-prev-page-btn');
export const fullscreenNextPageBtn = doc.getElementById('fullscreen-next-page-btn');
export const fullscreenImage = doc.getElementById('fullscreen-image');
export const fullscreenCloseBtn = doc.getElementById('fullscreen-close-btn');
export const fullscreenCloseBtnBottom = doc.getElementById('fullscreen-close-btn-bottom');
export const fullscreenTitle = doc.getElementById('fullscreen-title');
export const fullscreenControls = doc.getElementById('fullscreen-controls');
export const fullscreenOrientationBtn = doc.getElementById('fullscreen-orientation-btn');
export const fullscreenNavLeft = doc.getElementById('fullscreen-nav-left');
export const fullscreenNavRight = doc.getElementById('fullscreen-nav-right');
export const settingsModal = doc.getElementById('settings-modal');
export const settingsForm = doc.getElementById('settings-form');
export const scanIntervalInput = doc.getElementById('scan-interval-input');
export const settingsStatusDiv = doc.getElementById('settings-status');
export const scanButton = doc.getElementById('scan-button');
export const fullScanButton = doc.getElementById('full-scan-button');
export const logsContainer = doc.getElementById('logs-container');
export const downloadsInfoDiv = doc.getElementById('downloads-info');
export const clearDownloadsBtn = doc.getElementById('clear-downloads-btn');
export const downloadQueueDiv = doc.getElementById('download-queue');
export const settingsTabDevices = doc.getElementById('settings-tab-devices');
export const settingsContentDevices = doc.getElementById('settings-content-devices');
export const devicesStatusDiv = doc.getElementById('devices-status');
export const devicesListDiv = doc.getElementById('devices-list');
export const refreshDevicesBtn = doc.getElementById('refresh-devices-btn');
export const ctButton = doc.getElementById('ct-button');
export const ctModal = doc.getElementById('ct-modal');
export const ctScheduleInput = doc.getElementById('ct-schedule-input');
export const ctSaveBtn = doc.getElementById('ct-save-btn');
export const ctMatchBody = doc.getElementById('ct-match-body');
export const ctApplyBtn = doc.getElementById('ct-apply-btn');
export const ctSkipBtn = doc.getElementById('ct-skip-btn');
export const ctConfirmBar = doc.getElementById('ct-confirm-bar');
export const ctConfirmMessage = doc.getElementById('ct-confirm-message');
export const ctConfirmYes = doc.getElementById('ct-confirm-yes');
export const ctConfirmNo = doc.getElementById('ct-confirm-no');
export const ctOutputDiv = doc.getElementById('ct-output');
export const ctClearOutputBtn = doc.getElementById('ct-clear-output');
export const ctRunBtn = doc.getElementById('ct-run-btn');
export const ctCancelBtn = doc.getElementById('ct-cancel-btn');
export const ctTabSettings = doc.getElementById('ct-tab-settings');
export const ctTabGemini = doc.getElementById('ct-tab-gemini');
export const ctTabMatches = doc.getElementById('ct-tab-matches');
export const ctTabOutput = doc.getElementById('ct-tab-output');
export const ctTabLogs = doc.getElementById('ct-tab-logs');
export const ctTabManagement = doc.getElementById('ct-tab-management');
export const ctContentSettings = doc.getElementById('ct-content-settings');
export const ctContentGemini = doc.getElementById('ct-content-gemini');
export const ctContentMatches = doc.getElementById('ct-content-matches');
export const ctContentOutput = doc.getElementById('ct-content-output');
export const ctContentLogs = doc.getElementById('ct-content-logs');
export const ctContentManagement = doc.getElementById('ct-content-management');
export const ctMatchesBadge = doc.getElementById('ct-matches-badge');

export function resetFullscreenZoom() {
  const img = doc.getElementById('fullscreen-image');
  const viewer = doc.getElementById('fullscreen-viewer');
  const navLeft = doc.getElementById('fullscreen-nav-left');
  const navRight = doc.getElementById('fullscreen-nav-right');

  if (img) {
    img.style.transform = '';
    img.style.transformOrigin = '';
    img.style.cursor = 'default';
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    img.style.margin = 'auto';
    img.style.touchAction = '';
  }
  if (viewer) {
    viewer.scrollTop = 0;
    viewer.scrollLeft = 0;
  }
  if (navLeft) navLeft.classList.remove('hidden');
  if (navRight) navRight.classList.remove('hidden');

  const curState = (typeof state !== 'undefined' ? state : (typeof window !== 'undefined' ? window.state : null)) || {};
  const curActions = (typeof actions !== 'undefined' ? actions : (typeof window !== 'undefined' ? window.actions : null)) || {};

  if (curActions.viewer?.setZoom) {
    curActions.viewer.setZoom(false, { scale: 1, baseWidth: 0, baseHeight: 0 });
  } else {
    curState.isFullscreenZoomed = false;
    curState.fullscreenZoomScale = 1;
    curState.fullscreenZoomBaseWidth = 0;
    curState.fullscreenZoomBaseHeight = 0;
  }

  if (typeof curState.onFullscreenReset === 'function') {
    curState.onFullscreenReset();
  }
  if (typeof curState.applyFullscreenFitMode === 'function') {
    curState.applyFullscreenFitMode();
  }
  if (typeof curState.syncZoomToggleButton === 'function') {
    curState.syncZoomToggleButton();
  }
}
