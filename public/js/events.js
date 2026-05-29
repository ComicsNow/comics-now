// --- EVENT LISTENERS ---

import {
  state,
  encodePath,
  ctButton,
  ctModal,
  ctSaveBtn,
  ctApplyBtn,
  ctSkipBtn,
  ctConfirmYes,
  ctConfirmNo,
  ctClearOutputBtn,
  ctOutputDiv,
  ctRunBtn,
  ctTabSettings,
  ctTabMatches,
  ctTabOutput,
  ctTabManagement,
  ctContentSettings,
  ctContentMatches,
  ctContentOutput,
  ctContentManagement,
  ctMatchesBadge,
  metadataForm,
  saveStatusDiv,
  clearDownloadsBtn
} from './globals.js';

// Helper to switch settings tabs and update UI
function switchSettingsTab(tabName) {
  const tabs = ['general', 'logs', 'downloads', 'comics-defaults', 'devices', 'users', 'guided-reader'];
  
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

  if (state.logInterval) {
    clearInterval(state.logInterval);
    state.logInterval = null;
  }
}

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

  // Load user's manga mode preferences when tab is opened
  const loadDefaultsFn = state.loadComicsDefaults || window.loadComicsDefaults;
  if (typeof loadDefaultsFn === 'function') {
    await loadDefaultsFn();
  }

  // Initialize continuous mode settings
  const initContinuousFn = state.initContinuousModeSettings || window.initContinuousModeSettings;
  if (typeof initContinuousFn === 'function') {
    initContinuousFn();
  }
});

document.getElementById('settings-tab-devices')?.addEventListener('click', async () => {
  if (!state._isNavigatingFromRouter && state.router) {
    state.router.navigate('/settings/devices', true);
  }
  switchSettingsTab('devices');

  // Load user list for admin filter (if admin)
  const loadUserListFn = state.loadUserList || window.loadUserList;
  if (typeof loadUserListFn === 'function') {
    await loadUserListFn();
  }
  
  const refreshDevicesFn = state.refreshDeviceList || window.refreshDeviceList;
  if (typeof refreshDevicesFn === 'function') {
    await refreshDevicesFn();
  }
});

// Users tab - only exists for admin users
const settingsTabUsersEl = document.getElementById('settings-tab-users');
if (settingsTabUsersEl) {
  settingsTabUsersEl.addEventListener('click', async () => {
    if (!state._isNavigatingFromRouter && state.router) {
      state.router.navigate('/settings/users', true);
    }
    switchSettingsTab('users');

    // Load users list
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

ctButton?.addEventListener('click', () => {
  const openCTFn = state.openCTModal || window.openCTModal;
  if (typeof openCTFn === 'function') openCTFn();
});
document.getElementById('ct-close-btn')?.addEventListener('click', () => {
  const closeCTFn = state.closeCTModal || window.closeCTModal;
  if (typeof closeCTFn === 'function') closeCTFn();
});
ctSaveBtn?.addEventListener('click', () => {
  const saveCtFn = state.saveCtSettings || window.saveCtSettings;
  if (typeof saveCtFn === 'function') saveCtFn();
});
ctApplyBtn?.addEventListener('click', () => {
  const showCtConfirmFn = state.showCtConfirm || window.showCtConfirm;
  if (typeof showCtConfirmFn === 'function') showCtConfirmFn('apply');
});
ctSkipBtn?.addEventListener('click', () => {
  const showCtConfirmFn = state.showCtConfirm || window.showCtConfirm;
  if (typeof showCtConfirmFn === 'function') showCtConfirmFn('skip');
});
ctConfirmYes?.addEventListener('click', () => {
  const handleCtConfirmYesFn = state.handleCtConfirmYes || window.handleCtConfirmYes;
  if (typeof handleCtConfirmYesFn === 'function') handleCtConfirmYesFn();
});
ctConfirmNo?.addEventListener('click', () => {
  const handleCtConfirmNoFn = state.handleCtConfirmNo || window.handleCtConfirmNo;
  if (typeof handleCtConfirmNoFn === 'function') handleCtConfirmNoFn();
});
ctClearOutputBtn?.addEventListener('click', () => { 
  if (ctOutputDiv) ctOutputDiv.innerHTML = ''; 
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

ctRunBtn?.addEventListener('click', async () => {
  await fetch(`${state.API_BASE_URL}/api/v1/comictagger/run`, { method: 'POST' });
});

ctTabSettings?.addEventListener('click', () => {
  if (ctTabSettings.classList.contains('active')) return;
  if (!state._isNavigatingFromRouter && state.router) {
    state.router.navigate('/comictagger', true);
  }
  ctTabSettings.classList.add('active');
  ctTabMatches.classList.remove('active');
  ctTabOutput.classList.remove('active');
  ctTabManagement.classList.remove('active');
  ctContentSettings.classList.remove('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentOutput.classList.add('hidden');
  ctContentManagement.classList.add('hidden');

  const stopRenameFn = state.stopRenameStream || window.stopRenameStream;
  const stopMoveFn = state.stopMoveStream || window.stopMoveStream;
  if (typeof stopRenameFn === 'function') stopRenameFn();
  if (typeof stopMoveFn === 'function') stopMoveFn();
});

ctTabMatches?.addEventListener('click', () => {
  if (ctTabMatches.classList.contains('active')) return;
  if (!state._isNavigatingFromRouter && state.router) {
    state.router.navigate('/comictagger/matches', true);
  }
  ctTabMatches.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctTabOutput.classList.remove('active');
  ctTabManagement.classList.remove('active');
  ctContentMatches.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
  ctContentOutput.classList.add('hidden');
  ctContentManagement.classList.add('hidden');
  // Clear badge when viewing matches
  if (ctMatchesBadge) ctMatchesBadge.classList.add('hidden');

  const stopRenameFn = state.stopRenameStream || window.stopRenameStream;
  const stopMoveFn = state.stopMoveStream || window.stopMoveStream;
  if (typeof stopRenameFn === 'function') stopRenameFn();
  if (typeof stopMoveFn === 'function') stopMoveFn();
});

ctTabOutput?.addEventListener('click', () => {
  if (ctTabOutput.classList.contains('active')) return;
  if (!state._isNavigatingFromRouter && state.router) {
    state.router.navigate('/comictagger/output', true);
  }
  ctTabOutput.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctTabMatches.classList.remove('active');
  ctTabManagement.classList.remove('active');
  ctContentOutput.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentManagement.classList.add('hidden');

  const stopRenameFn = state.stopRenameStream || window.stopRenameStream;
  const stopMoveFn = state.stopMoveStream || window.stopMoveStream;
  if (typeof stopRenameFn === 'function') stopRenameFn();
  if (typeof stopMoveFn === 'function') stopMoveFn();
});

ctTabManagement?.addEventListener('click', () => {
  if (ctTabManagement.classList.contains('active')) return;
  if (!state._isNavigatingFromRouter && state.router) {
    state.router.navigate('/comictagger/management', true);
  }
  ctTabManagement.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctTabMatches.classList.remove('active');
  ctTabOutput.classList.remove('active');
  ctContentManagement.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentOutput.classList.add('hidden');

  const startRenameFn = state.startRenameStream || window.startRenameStream;
  const startMoveFn = state.startMoveStream || window.startMoveStream;
  if (typeof startRenameFn === 'function') startRenameFn();
  if (typeof startMoveFn === 'function') startMoveFn();
});

ctModal?.addEventListener('keydown', (e) => {
  if (ctConfirmBar && !ctConfirmBar.classList.contains('hidden')) {
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

export async function triggerScan(button = null, full = false) {
  if (button) button.disabled = true;
  try {
    const options = { method: 'POST' };
    if (full) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ full: true });
    }
    await fetch(`${state.API_BASE_URL}/api/v1/scan`, options);
  } catch (e) {
    throw e;
  } finally {
    if (button) button.disabled = false;
  }
}
state.triggerScan = triggerScan;
if (typeof window !== 'undefined') {
  window.triggerScan = triggerScan;
}

metadataForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Instantly clear the unsaved changes flag so that any concurrent clicks during the async save do not trigger the warning
  state.metadataHasUnsavedChanges = false;

  if (saveStatusDiv) saveStatusDiv.textContent = 'Saving...';
  const formData = new FormData(metadataForm);
  if (!state.currentMetadata) {
    state.currentMetadata = await (await fetch(`${state.API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(state.currentComic.path))}`)).json();
  }

  for (const [key, value] of formData.entries()) {
    state.currentMetadata[key] = value;
  }

  try {
    const response = await fetch(`${state.API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(state.currentComic.path))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentMetadata)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Failed to save metadata.');

    if (saveStatusDiv) {
      if (result.writeBack === 'skipped') {
        saveStatusDiv.textContent = 'Changes saved to database (CBZ write-back skipped for Folder Mode)';
      } else {
        saveStatusDiv.textContent = 'Changes saved successfully!';
      }
    }

    if (state.currentComic) {
      state.currentComic.metadata = JSON.stringify(state.currentMetadata);
      const hasSeries = (state.currentMetadata.Series || '').toString().trim().length > 0;
      const hasPublisher = (state.currentMetadata.Publisher || '').toString().trim().length > 0;
      const hasDate = (state.currentMetadata.Year || state.currentMetadata.CoverDate || state.currentMetadata.StoreDate || state.currentMetadata['Cover Date'] || state.currentMetadata['Store Date'] || '').toString().trim().length > 0;
      const newTag = (hasSeries && hasPublisher && hasDate) ? 'successful' : 'failed';
      state.currentComic.tagStatus = newTag;

      const comicMap = state.comicIdMap || window.comicIdMap;
      if (comicMap) {
        const mapped = comicMap.get(state.currentComic.id);
        if (mapped) {
          mapped.metadata = state.currentComic.metadata;
          mapped.tagStatus = newTag;
        }
      }

      const updateFilterCountsFn = state.updateFilterButtonCounts || window.updateFilterButtonCounts;
      if (typeof updateFilterCountsFn === 'function') {
        updateFilterCountsFn();
      }
    }
    
    const setComicSummaryFn = state.setComicSummary || window.setComicSummary;
    if (typeof setComicSummaryFn === 'function') {
      setComicSummaryFn(state.currentMetadata.Summary, { preserveExpansion: true });
    }
    
    setTimeout(() => { 
      if (saveStatusDiv) saveStatusDiv.textContent = ''; 
    }, 5000);
  } catch (error) {
    // Restore the unsaved changes flag on failure so the user is protected
    state.metadataHasUnsavedChanges = true;
    if (saveStatusDiv) saveStatusDiv.textContent = `Save failed: ${error.message}`;
  }
});

// --- Unsaved Changes Warning Interceptors ---
if (metadataForm) {
  metadataForm.addEventListener('input', () => {
    state.metadataHasUnsavedChanges = true;
  });
  metadataForm.addEventListener('change', () => {
    state.metadataHasUnsavedChanges = true;
  });
}

// Capturing-phase global click interceptor
document.addEventListener('click', (e) => {
  if (state.metadataHasUnsavedChanges) {
    // Allow internal clicks within the metadata panel, tab clicks, and form saves to pass through
    if (e.target.closest('#metadata-content') || e.target.closest('#metadata-tab') || e.target.closest('button[type="submit"]')) {
      return;
    }
    
    const confirmDiscard = confirm('You have unsaved changes in metadata. Are you sure you want to discard them?');
    if (!confirmDiscard) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      state.metadataHasUnsavedChanges = false;
    }
  }
}, true);
