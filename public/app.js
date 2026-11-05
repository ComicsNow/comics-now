import { state } from './js/globals.js';
import { hideAdminUI } from './js/utils/admin-ui.js';
import {
  cacheAppConfig,
  loadCachedAppConfig,
  resolveAppConfig,
  showOfflineLibraryUnavailableMessage,
  initEnvironment,
  registerServiceWorker,
  initAppStorage,
  initUIControls,
  loadInitialData,
  initializeApp
} from './js/app/bootstrap.js';
import {
  loadLibraryOfflineFirst,
  fetchLibraryFromServer,
  showUserBadge
} from './js/app/library-loader.js';
import {
  refreshReadingListModal
} from './js/app/reading-list-modal.js';
import {
  openReadingListModal,
  closeReadingListModal,
  createReadingList,
  deleteReadingList,
  hideReadingListDetail,
  bindReadingListModalEvents
} from './js/app/reading-list-actions.js';
import { showReadingListDetail } from './js/app/reading-list-detail.js';

// Side-effect imports to load and register all other ES Modules in order
import './js/reading-list-dag.js';
import './js/router.js';
import './js/utils/device-detection.js';
import './js/offline/db-core.js';
import './js/offline/db-jwt.js';
import './js/offline/db-library-cache.js';
import './js/offline/db-queue.js';
import './js/offline/db-comics.js';
import './js/offline/db-namespace.js';
import './js/jwt-capture.js';
import './js/offline/status.js';
import './js/offline/downloads.js';
import './js/offline/download-progress.js';
import './js/offline/download-notifications.js';
import './js/offline/download-actions.js';
import './js/offline/downloads-namespace.js';
import './js/offline.js';
import './js/library/data.js';
import './js/library/smartlists.js';
import './js/library/status.js';
import './js/library/smart-filters.js';
import './js/library/breadcrumb.js';
import './js/library/alpha-list.js';
import './js/library/search.js';
import './js/library/render.js';
import './js/library/folder-viewer.js';
import './js/library/device-library.js';
import './js/library.js';
import './js/context-menu/menu-builder.js';
import './js/manga.js';
import './js/continuous.js';
import './js/context-menu/actions-shared.js';
import './js/context-menu/actions-tag-search.js';
import './js/context-menu/actions-comic.js';
import './js/context-menu/actions-series.js';
import './js/context-menu/actions-publisher.js';
import './js/context-menu/actions-library.js';
import './js/context-menu/actions-folder.js';
import './js/metadata.js';
import './js/bulk-status.js';
import './js/viewer/fullscreen.js';
import './js/viewer/full-image.js';
import './js/viewer/ui-page-jump.js';
import './js/viewer/ui-orientation.js';
import './js/viewer/ui-summary.js';
import './js/viewer/ui.js';
import './js/viewer/ui-init.js';
import './js/viewer/page-previews.js';
import './js/viewer/navigation.js';
import './js/viewer/viewer-server.js';
import './js/viewer/viewer-local.js';
import './js/viewer/end-navigation.js';
import './js/viewer/guided/data.js';
import './js/viewer/guided/geometry.js';
import './js/viewer/guided/overlay.js';
import './js/viewer/guided/mode-registry.js';
import './js/viewer/guided/modes/guided.js';
import './js/viewer/guided/modes/bubble.js';
import './js/viewer/guided/modes/western-speech-zoom.js';
import './js/viewer/guided/modes/manga-panel-zoom.js';
import './js/viewer/guided/modes/manga-speech-zoom.js';
import './js/viewer/guided/pan.js';
import './js/viewer/guided/input.js';
import './js/viewer/guided/lifecycle.js';
import './js/viewer/guided/buttons.js';
import './js/viewer/guided/index.js';
import './js/settings/shared.js';
import './js/settings/devices.js';
import './js/settings/users.js';
import './js/settings/user-access.js';
import './js/settings/user-stats.js';
import './js/impersonation.js';
import './js/settings/comics-defaults.js';
import './js/settings/comics-management.js';
import './js/settings.js';
import './js/guided-reader.js';
import './js/comictagger.js';
import './js/events.js';
import './js/comicvine.js';
import './js/progress.js';
import './js/sync.js';
import './js/auth.js';
import './js/reading-lists.js';

document.addEventListener('DOMContentLoaded', bindReadingListModalEvents);

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initializeApp();
}

export {
  cacheAppConfig,
  loadCachedAppConfig,
  resolveAppConfig,
  showOfflineLibraryUnavailableMessage,
  initEnvironment,
  registerServiceWorker,
  initAppStorage,
  initUIControls,
  loadInitialData,
  initializeApp,
  loadLibraryOfflineFirst,
  fetchLibraryFromServer,
  showUserBadge,
  hideAdminUI,
  openReadingListModal,
  closeReadingListModal,
  refreshReadingListModal,
  createReadingList,
  deleteReadingList,
  showReadingListDetail,
  hideReadingListDetail
};

state.cacheAppConfig = cacheAppConfig;
state.loadCachedAppConfig = loadCachedAppConfig;
state.resolveAppConfig = resolveAppConfig;
state.showOfflineLibraryUnavailableMessage = showOfflineLibraryUnavailableMessage;
state.initEnvironment = initEnvironment;
state.registerServiceWorker = registerServiceWorker;
state.initAppStorage = initAppStorage;
state.initUIControls = initUIControls;
state.loadInitialData = loadInitialData;
state.initializeApp = initializeApp;
state.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
state.fetchLibraryFromServer = fetchLibraryFromServer;
state.showUserBadge = showUserBadge;
state.hideAdminUI = hideAdminUI;
state.openReadingListModal = openReadingListModal;
state.closeReadingListModal = closeReadingListModal;
state.refreshReadingListModal = refreshReadingListModal;
state.createReadingList = createReadingList;
state.deleteReadingList = deleteReadingList;
state.showReadingListDetail = showReadingListDetail;
state.hideReadingListDetail = hideReadingListDetail;

if (typeof window !== 'undefined') {
  window.cacheAppConfig = cacheAppConfig;
  window.loadCachedAppConfig = loadCachedAppConfig;
  window.resolveAppConfig = resolveAppConfig;
  window.showOfflineLibraryUnavailableMessage = showOfflineLibraryUnavailableMessage;
  window.initEnvironment = initEnvironment;
  window.registerServiceWorker = registerServiceWorker;
  window.initAppStorage = initAppStorage;
  window.initUIControls = initUIControls;
  window.loadInitialData = loadInitialData;
  window.initializeApp = initializeApp;
  window.loadLibraryOfflineFirst = loadLibraryOfflineFirst;
  window.fetchLibraryFromServer = fetchLibraryFromServer;
  window.showUserBadge = showUserBadge;
  window.hideAdminUI = hideAdminUI;
  window.openReadingListModal = openReadingListModal;
  window.closeReadingListModal = closeReadingListModal;
  window.refreshReadingListModal = refreshReadingListModal;
  window.createReadingList = createReadingList;
  window.deleteReadingList = deleteReadingList;
  window.showReadingListDetail = showReadingListDetail;
  window.hideReadingListDetail = hideReadingListDetail;
}
