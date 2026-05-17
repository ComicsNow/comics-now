// --- EVENT LISTENERS ---

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

  if (logInterval) clearInterval(logInterval);
}

document.getElementById('settings-tab-general')?.addEventListener('click', () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings', true);
  }
  switchSettingsTab('general');
  if (typeof fetchSettings === 'function') fetchSettings();
  if (typeof refreshLibraryFolders === 'function') refreshLibraryFolders();
});

document.getElementById('settings-tab-logs')?.addEventListener('click', () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings/logs', true);
  }
  switchSettingsTab('logs');
  fetchLogs();
  logInterval = setInterval(fetchLogs, 3000);
});

document.getElementById('settings-tab-downloads').addEventListener('click', async () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings/downloads', true);
  }
  switchSettingsTab('downloads');
  await refreshDownloadsInfo();
});

document.getElementById('settings-tab-comics-defaults')?.addEventListener('click', async () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings/defaults', true);
  }
  switchSettingsTab('comics-defaults');

  // Load user's manga mode preferences when tab is opened
  await loadComicsDefaults();

  // Initialize continuous mode settings
  if (typeof initContinuousModeSettings === 'function') {
    initContinuousModeSettings();
  }
});

document.getElementById('settings-tab-devices').addEventListener('click', async () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings/devices', true);
  }
  switchSettingsTab('devices');

  // Load user list for admin filter (if admin)
  await loadUserList();
  await refreshDeviceList();
});

// Users tab - only exists for admin users
const settingsTabUsersEl = document.getElementById('settings-tab-users');
if (settingsTabUsersEl) {
  settingsTabUsersEl.addEventListener('click', async () => {
    if (!window._isNavigatingFromRouter && window.router) {
      window.router.navigate('/settings/users', true);
    }
    switchSettingsTab('users');

    // Load users list
    if (typeof refreshUsersList === 'function') {
      await refreshUsersList();
    }
  });
}

if (clearDownloadsBtn && !clearDownloadsBtn._clearListener) {
  clearDownloadsBtn._clearListener = async (event) => {
    event.preventDefault();
    if (!confirm('Are you sure you want to delete all offline data? This cannot be undone.')) {
      return;
    }

    await clearOfflineData();
    await forceStorageCleanup();
    alert('All offline data has been cleared.');
    await fetchLibrary();
    await refreshDownloadsInfo();
  };
  clearDownloadsBtn.addEventListener('click', clearDownloadsBtn._clearListener);
}


document.getElementById('settings-tab-guided-reader')?.addEventListener('click', () => {
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/settings/guided-reader', true);
  }
  switchSettingsTab('guided-reader');
  if (typeof openGuidedReaderTab === 'function') openGuidedReaderTab();
});

document.getElementById('log-level-filter').addEventListener('change', fetchLogs);
document.getElementById('log-category-filter').addEventListener('change', fetchLogs);

ctButton.addEventListener('click', openCTModal);
document.getElementById('ct-close-btn').addEventListener('click', closeCTModal);
ctSaveBtn.addEventListener('click', saveCtSettings);
ctApplyBtn.addEventListener('click', () => showCtConfirm('apply'));
ctSkipBtn.addEventListener('click', () => showCtConfirm('skip'));
ctConfirmYes.addEventListener('click', handleCtConfirmYes);
ctConfirmNo.addEventListener('click', handleCtConfirmNo);
ctClearOutputBtn.addEventListener('click', () => { ctOutputDiv.innerHTML = ''; });
document.getElementById('ct-grab-btn')?.addEventListener('click', function() {
  const btn = this;
  const icon = btn.querySelector('svg');
  if (icon) icon.classList.add('animate-spin');
  btn.classList.add('opacity-50', 'pointer-events-none');
  
  if (typeof fetchPendingMatchDetails === 'function') {
    fetchPendingMatchDetails().finally(() => {
      setTimeout(() => {
        if (icon) icon.classList.remove('animate-spin');
        btn.classList.remove('opacity-50', 'pointer-events-none');
      }, 800);
    });
  }
});
ctRunBtn.addEventListener('click', async () => {
  await fetch(`${API_BASE_URL}/api/v1/comictagger/run`, { method: 'POST' });
});
ctTabSettings.addEventListener('click', () => {
  if (ctTabSettings.classList.contains('active')) return;
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/comictagger', true);
  }
  ctTabSettings.classList.add('active');
  ctTabMatches.classList.remove('active');
  ctTabOutput.classList.remove('active');
  ctTabManagement.classList.remove('active');
  ctContentSettings.classList.remove('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentOutput.classList.add('hidden');
  ctContentManagement.classList.add('hidden');

  if (typeof window.stopRenameStream === 'function') window.stopRenameStream();
  if (typeof window.stopMoveStream === 'function') window.stopMoveStream();
});
ctTabMatches.addEventListener('click', () => {
  if (ctTabMatches.classList.contains('active')) return;
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/comictagger/matches', true);
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

  if (typeof window.stopRenameStream === 'function') window.stopRenameStream();
  if (typeof window.stopMoveStream === 'function') window.stopMoveStream();
});
ctTabOutput.addEventListener('click', () => {
  if (ctTabOutput.classList.contains('active')) return;
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/comictagger/output', true);
  }
  ctTabOutput.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctTabMatches.classList.remove('active');
  ctTabManagement.classList.remove('active');
  ctContentOutput.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentManagement.classList.add('hidden');

  if (typeof window.stopRenameStream === 'function') window.stopRenameStream();
  if (typeof window.stopMoveStream === 'function') window.stopMoveStream();
});
ctTabManagement.addEventListener('click', () => {
  if (ctTabManagement.classList.contains('active')) return;
  if (!window._isNavigatingFromRouter && window.router) {
    window.router.navigate('/comictagger/management', true);
  }
  ctTabManagement.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctTabMatches.classList.remove('active');
  ctTabOutput.classList.remove('active');
  ctContentManagement.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
  ctContentMatches.classList.add('hidden');
  ctContentOutput.classList.add('hidden');

  if (typeof startRenameStream === 'function') startRenameStream();
  if (typeof startMoveStream === 'function') startMoveStream();
});
ctModal.addEventListener('keydown', (e) => {
  if (!ctConfirmBar.classList.contains('hidden')) {
    if (e.key === 'Enter') handleCtConfirmYes();
    if (e.key === 'Escape' || e.key === ' ') handleCtConfirmNo();
  }
});



async function triggerScan(button = null, full = false) {
  if (button) button.disabled = true;
  try {
    const options = { method: 'POST' };
    if (full) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ full: true });
    }
    await fetch(`${API_BASE_URL}/api/v1/scan`, options);
  } catch (e) {
    
    throw e;
  } finally {
    if (button) button.disabled = false;
  }
}

metadataForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveStatusDiv.textContent = 'Saving...';
  const formData = new FormData(metadataForm);
  if (!window.currentMetadata) {
    window.currentMetadata = await (await fetch(`${API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(window.currentComic.path))}`)).json();
  }

  for (const [key, value] of formData.entries()) {
    window.currentMetadata[key] = value;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/comics/info?path=${encodeURIComponent(encodePath(window.currentComic.path))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(window.currentMetadata)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Failed to save metadata.');
    
    if (result.writeBack === 'skipped') {
      saveStatusDiv.textContent = 'Changes saved to database (CBZ write-back skipped for Folder Mode)';
    } else {
      saveStatusDiv.textContent = 'Changes saved successfully!';
    }
    
    setComicSummary(window.currentMetadata.Summary, { preserveExpansion: true });
    setTimeout(() => { saveStatusDiv.textContent = ''; }, 5000);
  } catch (error) {
    saveStatusDiv.textContent = `Save failed: ${error.message}`;
  }
});

