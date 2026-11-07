import {
  state,
  getRelativePath,
  settingsModal,
  settingsTabDevices,
  global as canonicalGlobal
} from './globals.js';

import {
  refreshLibraryFolders,
  removeLibraryFolder
} from './settings/libraries.js';

import {
  fetchSettings,
  fetchLogs
} from './settings/form-sync.js';

import {
  refreshStoryArcsSyncStatus
} from './settings/story-arcs-settings.js';

const global = typeof canonicalGlobal !== 'undefined' ? canonicalGlobal : new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get: (t, p) => (typeof state !== 'undefined' && p in state) ? state[p] : t[p],
  set: (t, p, v) => { if (typeof state !== 'undefined') state[p] = v; try { t[p] = v; } catch {} return true; }
});

// --- SETTINGS MODAL DIALOG LIFECYCLE ---
export function openSettingsModal() {
  if (typeof global.hideAdminUI === 'function') {
    global.hideAdminUI();
  }

  if (!global._isNavigatingFromRouter && global.router) {
    if (!getRelativePath().startsWith('/settings')) {
      global.router.navigate('/settings', true);
    }
  }
  if (settingsModal) {
    settingsModal.classList.remove('hidden');
  }
  fetchSettings();
  if (typeof refreshStoryArcsSyncStatus === 'function') {
    refreshStoryArcsSyncStatus();
  }
  refreshLibraryFolders();
  if (settingsTabDevices && settingsTabDevices.classList.contains('active')) {
    if (typeof global.refreshDeviceList === 'function') {
      global.refreshDeviceList();
    }
  }
  const defaultsTab = document.getElementById('settings-tab-comics-defaults');
  if (defaultsTab && defaultsTab.classList.contains('active')) {
    if (typeof global.loadComicsDefaults === 'function') {
      global.loadComicsDefaults();
    }
  }
  const guidedPane = document.getElementById('settings-content-guided-reader');
  if (guidedPane && !guidedPane.classList.contains('hidden')
      && typeof global.openGuidedReaderTab === 'function') {
    global.openGuidedReaderTab();
  }
}

export function closeSettingsModal() {
  if (settingsModal) {
    settingsModal.classList.add('hidden');
  }
  if (global.logInterval) {
    clearInterval(global.logInterval);
    global.logInterval = null;
  }
  if (global.router && getRelativePath().startsWith('/settings')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }
}

export {
  fetchSettings,
  refreshLibraryFolders,
  removeLibraryFolder,
  fetchLogs
};

state.openSettingsModal = openSettingsModal;
state.closeSettingsModal = closeSettingsModal;
state.fetchSettings = fetchSettings;
state.refreshLibraryFolders = refreshLibraryFolders;
state.removeLibraryFolder = removeLibraryFolder;
state.fetchLogs = fetchLogs;

if (typeof window !== 'undefined') {
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.fetchSettings = fetchSettings;
  window.refreshLibraryFolders = refreshLibraryFolders;
  window.removeLibraryFolder = removeLibraryFolder;
  window.fetchLogs = fetchLogs;
}
