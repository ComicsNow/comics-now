import {
  state,
  ctButton,
  ctModal,
  ctTabSettings,
  ctTabGemini,
  ctTabMatches,
  ctTabOutput,
  ctTabLogs,
  ctTabManagement,
  ctContentSettings,
  ctContentGemini,
  ctContentMatches,
  ctContentOutput,
  ctContentLogs,
  ctContentManagement,
  ctMatchesBadge,
  clearDownloadsBtn
} from '../globals.js';
import { initSettingsScopeSwitcher, syncScopeWithActiveTab } from '../settings/scope-switcher.js';
import { initCtScopeSwitcher, syncCtScopeWithActiveTab } from '../comictagger/scope-switcher.js';

// Helper to switch settings tabs and update UI
export function switchSettingsTab(tabName) {
  const tabs = ['general', 'logs', 'downloads', 'comics-defaults', 'devices', 'users', 'guided-reader', 'story-arcs'];

  tabs.forEach(tab => {
    const tabEl = document.getElementById(`settings-tab-${tab}`);
    const contentEl = document.getElementById(`settings-content-${tab}`);

    if (tabEl) {
      if (tab === tabName) {
        tabEl.classList.add('active');
      } else {
        tabEl.classList.remove('active');
      }
    }

    if (contentEl) {
      if (tab === tabName) {
        contentEl.classList.remove('hidden');
      } else {
        contentEl.classList.add('hidden');
      }
    }
  });

  if (typeof syncScopeWithActiveTab === 'function') {
    syncScopeWithActiveTab(tabName);
  }

  if (state.logInterval) {
    clearInterval(state.logInterval);
    state.logInterval = null;
  }
}

export function switchCtTab(activeTab, activeContent, routePath) {
  if (activeTab?.classList?.contains('active')) return;
  if (!state._isNavigatingFromRouter && state.router && routePath) {
    state.router.navigate(routePath, true);
  }
  [
    typeof ctTabOutput !== 'undefined' ? ctTabOutput : null,
    typeof ctTabMatches !== 'undefined' ? ctTabMatches : null,
    typeof ctTabSettings !== 'undefined' ? ctTabSettings : null,
    document.getElementById('ct-tab-story-arcs'),
    typeof ctTabGemini !== 'undefined' ? ctTabGemini : null,
    typeof ctTabLogs !== 'undefined' ? ctTabLogs : null,
    typeof ctTabManagement !== 'undefined' ? ctTabManagement : null,
    document.getElementById('mgmt-tab-operations'),
    document.getElementById('mgmt-tab-name'),
    document.getElementById('mgmt-tab-folder'),
    document.getElementById('mgmt-tab-errors')
  ].forEach(t => t?.classList.remove('active'));

  [
    typeof ctContentOutput !== 'undefined' ? ctContentOutput : null,
    typeof ctContentMatches !== 'undefined' ? ctContentMatches : null,
    typeof ctContentSettings !== 'undefined' ? ctContentSettings : null,
    document.getElementById('ct-content-story-arcs'),
    typeof ctContentGemini !== 'undefined' ? ctContentGemini : null,
    typeof ctContentLogs !== 'undefined' ? ctContentLogs : null,
    typeof ctContentManagement !== 'undefined' ? ctContentManagement : null
  ].forEach(c => c?.classList.add('hidden'));

  activeTab?.classList.add('active');
  activeContent?.classList.remove('hidden');

  if (activeTab?.id && typeof syncCtScopeWithActiveTab === 'function') {
    const tabKey = activeTab.id.replace(/^ct-tab-/, '').replace(/^mgmt-tab-/, '');
    syncCtScopeWithActiveTab(tabKey);
  }

  const stopRenameFn = state.stopRenameStream || window.stopRenameStream;
  const stopMoveFn = state.stopMoveStream || window.stopMoveStream;
  const isMgmt = activeTab === (typeof ctTabManagement !== 'undefined' ? ctTabManagement : null) ||
                 activeTab?.id?.startsWith('mgmt-tab-');
  if (!isMgmt) {
    if (typeof stopRenameFn === 'function') stopRenameFn();
    if (typeof stopMoveFn === 'function') stopMoveFn();
  }
}

/**
 * Initializes settings tab navigation and subtab dirty guards.
 */
export function initSettingsTabListeners() {
  if (typeof initSettingsScopeSwitcher === 'function') {
    initSettingsScopeSwitcher();
  }

  // Guard: warn before leaving the Comics Defaults subtab with unsaved changes.
  document.addEventListener('click', (e) => {
    if (!state.comicsDefaultsDirty) return;
    const tabBtn = e.target.closest('[id^="settings-tab-"]');
    if (!tabBtn || tabBtn.id === 'settings-tab-comics-defaults') return;

    const proceed = confirm(
      'You have unsaved changes in Comics Defaults. Leave without saving? Your changes will be lost.'
    );
    if (!proceed) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    state.comicsDefaultsDirty = false;
    if (typeof window !== 'undefined') window.comicsDefaultsDirty = false;
  }, true);

  document.getElementById('settings-tab-general')?.addEventListener('click', () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings', true);
    }
    switchSettingsTab('general');
    if (typeof state.fetchSettings === 'function') state.fetchSettings();
    else if (typeof window.fetchSettings === 'function') window.fetchSettings();

    if (typeof state.refreshLibraryFolders === 'function') state.refreshLibraryFolders();
    else if (typeof window.refreshLibraryFolders === 'function') window.refreshLibraryFolders();
  });

  document.getElementById('settings-tab-logs')?.addEventListener('click', () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/logs', true);
    }
    switchSettingsTab('logs');

    const fetchLogsFn = state.fetchLogs || window.fetchLogs;
    if (typeof fetchLogsFn === 'function') {
      fetchLogsFn();
      state.logInterval = setInterval(fetchLogsFn, 3000);
    }
  });

  document.getElementById('settings-tab-downloads')?.addEventListener('click', async () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/downloads', true);
    }
    switchSettingsTab('downloads');

    const refreshFn = state.refreshDownloadsInfo || window.refreshDownloadsInfo;
    if (typeof refreshFn === 'function') {
      await refreshFn();
    }
  });

  document.getElementById('settings-tab-comics-defaults')?.addEventListener('click', async () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/defaults', true);
    }
    switchSettingsTab('comics-defaults');

    const loadDefaultsFn = state.loadComicsDefaults || window.loadComicsDefaults;
    if (typeof loadDefaultsFn === 'function') {
      await loadDefaultsFn();
    }
  });

  document.getElementById('settings-tab-devices')?.addEventListener('click', async () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/devices', true);
    }
    switchSettingsTab('devices');

    const loadUserListFn = state.loadUserList || window.loadUserList;
    if (typeof loadUserListFn === 'function') {
      await loadUserListFn();
    }

    const refreshDevicesFn = state.refreshDeviceList || window.refreshDeviceList;
    if (typeof refreshDevicesFn === 'function') {
      await refreshDevicesFn();
    }
  });

  const settingsTabUsersEl = document.getElementById('settings-tab-users');
  if (settingsTabUsersEl) {
    settingsTabUsersEl.addEventListener('click', async () => {
      if (!state._isNavigatingFromRouter && state.router) {
        state.router.navigate('/settings/users', true);
      }
      switchSettingsTab('users');

      const refreshUsersFn = state.refreshUsersList || window.refreshUsersList;
      if (typeof refreshUsersFn === 'function') {
        await refreshUsersFn();
      }
    });
  }

  if (clearDownloadsBtn && !clearDownloadsBtn._clearListener) {
    clearDownloadsBtn._clearListener = async (event) => {
      event.preventDefault();
      if (!confirm('Are you sure you want to delete all offline data? This cannot be undone.')) {
        return;
      }

      const clearOfflineFn = state.clearOfflineData || window.clearOfflineData;
      const forceCleanupFn = state.forceStorageCleanup || window.forceStorageCleanup;
      const fetchLibFn = state.fetchLibrary || window.fetchLibrary;
      const refreshDownFn = state.refreshDownloadsInfo || window.refreshDownloadsInfo;

      if (typeof clearOfflineFn === 'function') await clearOfflineFn();
      if (typeof forceCleanupFn === 'function') await forceCleanupFn();
      alert('All offline data has been cleared.');
      if (typeof fetchLibFn === 'function') await fetchLibFn();
      if (typeof refreshDownFn === 'function') await refreshDownFn();
    };
    clearDownloadsBtn.addEventListener('click', clearDownloadsBtn._clearListener);
  }

  document.getElementById('settings-tab-guided-reader')?.addEventListener('click', () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/guided-reader', true);
    }
    switchSettingsTab('guided-reader');

    const openGuidedFn = state.openGuidedReaderTab || window.openGuidedReaderTab;
    if (typeof openGuidedFn === 'function') {
      openGuidedFn();
    }
  });

  document.getElementById('log-level-filter')?.addEventListener('change', () => {
    const fetchLogsFn = state.fetchLogs || window.fetchLogs;
    if (typeof fetchLogsFn === 'function') fetchLogsFn();
  });
  document.getElementById('log-category-filter')?.addEventListener('change', () => {
    const fetchLogsFn = state.fetchLogs || window.fetchLogs;
    if (typeof fetchLogsFn === 'function') fetchLogsFn();
  });
}

/**
 * Initializes ComicTagger tab listeners and grab button animation.
 */
export function initCtTabListeners() {
  if (typeof initCtScopeSwitcher === 'function') {
    initCtScopeSwitcher();
  }

  ctButton?.addEventListener('click', () => {
    const openCTFn = state.openCTModal || window.openCTModal;
    if (typeof openCTFn === 'function') openCTFn();
  });

  document.getElementById('ct-close-btn')?.addEventListener('click', () => {
    const closeCTFn = state.closeCTModal || window.closeCTModal;
    if (typeof closeCTFn === 'function') closeCTFn();
  });

  document.getElementById('ct-grab-btn')?.addEventListener('click', function() {
    const btn = this;
    const icon = btn.querySelector('svg');
    if (icon) icon.classList.add('animate-spin');
    btn.classList.add('opacity-50', 'pointer-events-none');

    const fetchPendingFn = state.fetchPendingMatchDetails || window.fetchPendingMatchDetails;
    if (typeof fetchPendingFn === 'function') {
      fetchPendingFn().finally(() => {
        setTimeout(() => {
          if (icon) icon.classList.remove('animate-spin');
          btn.classList.remove('opacity-50', 'pointer-events-none');
        }, 800);
      });
    }
  });

  ctTabOutput?.addEventListener('click', () => {
    switchCtTab(ctTabOutput, ctContentOutput, '/tag-comics-now/output');
    const ctSyncFn = state.ctSyncLogsAndState || window.ctSyncLogsAndState;
    if (typeof ctSyncFn === 'function') ctSyncFn();
  });

  ctTabMatches?.addEventListener('click', () => {
    switchCtTab(ctTabMatches, ctContentMatches, '/tag-comics-now/matches');
    if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');
    const fetchPendingMatchDetailsFn = state.fetchPendingMatchDetails || window.fetchPendingMatchDetails;
    if (typeof fetchPendingMatchDetailsFn === 'function') fetchPendingMatchDetailsFn(true);
  });

  ctTabSettings?.addEventListener('click', () => {
    switchCtTab(ctTabSettings, ctContentSettings, '/tag-comics-now');
  });

  const ctTabStoryArcs = document.getElementById('ct-tab-story-arcs');
  const ctContentStoryArcs = document.getElementById('ct-content-story-arcs');
  if (ctTabStoryArcs) {
    ctTabStoryArcs.addEventListener('click', () => {
      switchCtTab(ctTabStoryArcs, ctContentStoryArcs, '/tag-comics-now/story-arcs');
      const openArcsFn = state.openStoryArcsTab || window.openStoryArcsTab;
      if (typeof openArcsFn === 'function') {
        openArcsFn();
      }
    });
  }

  const bridgeToStoryArcsBtn = document.getElementById('bridge-to-story-arcs-settings-btn');
  if (bridgeToStoryArcsBtn) {
    bridgeToStoryArcsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctTabStoryArcs?.click();
    });
  }

  if (typeof ctTabGemini !== 'undefined' && ctTabGemini) {
    ctTabGemini.addEventListener('click', () => {
      switchCtTab(ctTabGemini, ctContentGemini, '/tag-comics-now/gemini');
    });
  }

  ctTabLogs?.addEventListener('click', () => {
    switchCtTab(ctTabLogs, ctContentLogs, '/tag-comics-now/logs');
    const loadScanLogsFn = state.loadScanLogs || window.loadScanLogs;
    if (typeof loadScanLogsFn === 'function') loadScanLogsFn();
  });

  ctTabManagement?.addEventListener('click', () => {
    switchCtTab(ctTabManagement, ctContentManagement, '/tag-comics-now/management');
    const startRenameFn = state.startRenameStream || window.startRenameStream;
    const startMoveFn = state.startMoveStream || window.startMoveStream;
    if (typeof startRenameFn === 'function') startRenameFn();
    if (typeof startMoveFn === 'function') startMoveFn();
  });

  ctModal?.addEventListener('keydown', (e) => {
    const confirmBar = document.getElementById('ct-confirm-bar');
    if (confirmBar && !confirmBar.classList.contains('hidden')) {
      if (e.key === 'Enter') {
        const handleCtConfirmYesFn = state.handleCtConfirmYes || window.handleCtConfirmYes;
        if (typeof handleCtConfirmYesFn === 'function') handleCtConfirmYesFn();
      }
      if (e.key === ' ') {
        const handleCtConfirmNoFn = state.handleCtConfirmNo || window.handleCtConfirmNo;
        if (typeof handleCtConfirmNoFn === 'function') handleCtConfirmNoFn();
      }
    }
  });
}
