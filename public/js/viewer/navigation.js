import { state, global as canonicalGlobal } from '../globals.js';
import {
  IMAGE_FILE_REGEX,
  MAC_OS_RESOURCE_PREFIX,
  normalizePagesResponse,
  loadOfflineComicPages
} from './nav/offline-loader.js';
import {
  setLibraryControlsVisibility,
  navigateBackFromViewer,
  rebindViewerEvents
} from './nav/return-nav.js';
import { openComicViewer } from './nav/viewer-opener.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

const ViewerNavigation = {
  setLibraryControlsVisibility,
  navigateBackFromViewer,
  openComicViewer,
  rebindViewerEvents,
};

global.ViewerNavigation = ViewerNavigation;
Object.assign(global, ViewerNavigation);

export {
  IMAGE_FILE_REGEX,
  MAC_OS_RESOURCE_PREFIX,
  setLibraryControlsVisibility,
  normalizePagesResponse,
  loadOfflineComicPages,
  navigateBackFromViewer,
  rebindViewerEvents,
  openComicViewer,
  ViewerNavigation
};

state.IMAGE_FILE_REGEX = IMAGE_FILE_REGEX;
state.MAC_OS_RESOURCE_PREFIX = MAC_OS_RESOURCE_PREFIX;
state.setLibraryControlsVisibility = setLibraryControlsVisibility;
state.normalizePagesResponse = normalizePagesResponse;
state.loadOfflineComicPages = loadOfflineComicPages;
state.navigateBackFromViewer = navigateBackFromViewer;
state.rebindViewerEvents = rebindViewerEvents;
state.openComicViewer = openComicViewer;
state.ViewerNavigation = ViewerNavigation;

if (typeof window !== 'undefined') {
  window.IMAGE_FILE_REGEX = IMAGE_FILE_REGEX;
  window.MAC_OS_RESOURCE_PREFIX = MAC_OS_RESOURCE_PREFIX;
  window.setLibraryControlsVisibility = setLibraryControlsVisibility;
  window.normalizePagesResponse = normalizePagesResponse;
  window.loadOfflineComicPages = loadOfflineComicPages;
  window.navigateBackFromViewer = navigateBackFromViewer;
  window.rebindViewerEvents = rebindViewerEvents;
  window.openComicViewer = openComicViewer;
  window.ViewerNavigation = ViewerNavigation;
}
