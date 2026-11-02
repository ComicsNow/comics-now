/**
 * Comics Now! - Application Globals & Store Registry Facade
 *
 * Re-exports core utilities, UI selectors, constants, and manages central state proxy.
 */

import { ComicsStore, createStateProxy, createGlobalProxy } from './store/index.js';
import { html, raw, render, clearElement } from './ui/template.js';
import { getIconSvg, rawIcon, renderIcon } from './ui/icons.js';
import { ICONS, CSS_CLASSES } from './core/constants.js';
import {
  debugLog,
  enableComicsNowDebug,
  disableComicsNowDebug,
  isComicsNowDebugEnabled
} from './core/debug.js';
import {
  escapeHtml,
  safeDirName,
  getRelativePath,
  encodePath,
  toTrimmedString,
  createLoadingMessage,
  createEmptyMessage,
  createErrorMessage,
  createCheckmarkIcon,
  triggerEinkFlash
} from './core/dom-utils.js';
import {
  getComicById,
  turnToPage,
  pickMetadataValue,
  sanitizeComicTitle,
  buildComicDisplayInfo,
  applyDisplayInfoToComic,
  applyDisplayInfoToLibrary,
  getPathForCurrentView,
  showView
} from './core/comic-utils.js';
import * as elements from './core/elements.js';

export {
  html,
  raw,
  render,
  clearElement,
  getIconSvg,
  rawIcon,
  renderIcon,
  ICONS,
  CSS_CLASSES,
  debugLog,
  enableComicsNowDebug,
  disableComicsNowDebug,
  isComicsNowDebugEnabled,
  escapeHtml,
  safeDirName,
  getRelativePath,
  encodePath,
  toTrimmedString,
  createLoadingMessage,
  createEmptyMessage,
  createErrorMessage,
  createCheckmarkIcon,
  triggerEinkFlash,
  getComicById,
  turnToPage,
  pickMetadataValue,
  sanitizeComicTitle,
  buildComicDisplayInfo,
  applyDisplayInfoToComic,
  applyDisplayInfoToLibrary,
  getPathForCurrentView,
  showView,
  createGlobalProxy
};

export * from './core/elements.js';

export async function apiCall(endpoint, options = {}) {
  const baseUrl = (state && state.API_BASE_URL) || '';
  const response = await fetch(`${baseUrl}/api/v1/${endpoint}`, {
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
}

function detectEinkDevice() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 'none';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('kindle') && !ua.includes('fire')) return 'monochrome';
  if (ua.includes('kobo')) return 'monochrome';
  if (ua.includes('onyx') || ua.includes('boox') || ua.includes('pocketbook') || ua.includes('eink') || ua.includes('e-ink')) {
    return 'monochrome';
  }
  return 'none';
}

const initialAppState = {
  einkMode: (typeof localStorage !== 'undefined' ? localStorage.getItem('eink_mode') || detectEinkDevice() : 'none'),
  APP_CONFIG: (typeof window !== 'undefined' && window.APP_CONFIG) || {},
  API_BASE_URL: (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.baseUrl) ? window.APP_CONFIG.baseUrl.replace(/\/$/, '') : '',
  library: {},
  lastSearchQuery: '',
  lastSearchField: 'all',
  lastSearchResults: null,
  activeAlphaFilter: 'All',
  seriesSortOrder: (typeof localStorage !== 'undefined' ? localStorage.getItem('publisher_series_sort') || localStorage.getItem('seriesSortOrder') || 'name' : 'name'),
  configuredRootFolders: [],
  activeFilter: 'all',
  activeSmartFilter: null,
  smartListViewMode: 'folders',
  GuidedView: {},
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

const StoreConstructor = typeof ComicsStore !== 'undefined' ? ComicsStore : class FallbackStore {
  constructor(initial = {}) {
    this.state = { ...initial };
    this.audit = { record() {}, getEntries() { return []; }, clear() {} };
    this.bus = { on() { return () => {}; }, off() {}, emit() {} };
  }
  get(k) { return this.state[k]; }
  set(k, v) { this.state[k] = v; }
  subscribe() { return () => {}; }
};

export const store = new StoreConstructor(initialAppState);

export const state = typeof createStateProxy === 'function'
  ? createStateProxy(store, {
      warnOnDirectMutation: typeof window !== 'undefined' && Boolean(window.__COMICS_WARN_DIRECT_MUTATIONS__ || isComicsNowDebugEnabled('STORE'))
    })
  : store.state;

export const global = typeof createGlobalProxy === 'function' ? createGlobalProxy(state) : state;
export const actions = (store && store.actions) ? store.actions : {};

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
  sanitizeComicTitle,
  buildComicDisplayInfo,
  applyDisplayInfoToComic,
  applyDisplayInfoToLibrary,
  getPathForCurrentView,
  triggerEinkFlash,
  ICONS,
  CSS_CLASSES,
  ...(typeof elements !== 'undefined' ? elements : {})
};

if (typeof html !== 'undefined') globalsObj.html = html;
if (typeof raw !== 'undefined') globalsObj.raw = raw;
if (typeof render !== 'undefined') globalsObj.render = render;
if (typeof clearElement !== 'undefined') globalsObj.clearElement = clearElement;
if (typeof getIconSvg !== 'undefined') globalsObj.getIconSvg = getIconSvg;
if (typeof rawIcon !== 'undefined') globalsObj.rawIcon = rawIcon;
if (typeof renderIcon !== 'undefined') globalsObj.renderIcon = renderIcon;

Object.assign(state, globalsObj);
if (typeof window !== 'undefined') {
  Object.assign(window, globalsObj);
  window.state = state;
  window.global = global;
  window.API_BASE_URL = state.API_BASE_URL;
  window.seriesSortOrder = state.seriesSortOrder;
  window.__COMICS_STORE__ = store;
}
