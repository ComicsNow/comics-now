// --- EVENT LISTENERS ---
document.getElementById('settings-tab-general').addEventListener('click', () => {
  document.getElementById('settings-tab-general').classList.add('active');
  document.getElementById('settings-tab-logs').classList.remove('active');
  document.getElementById('settings-tab-downloads').classList.remove('active');
  document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
  document.getElementById('settings-tab-devices').classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-tab-comics-management').classList.remove('active');
  document.getElementById('settings-content-general').classList.remove('hidden');
  document.getElementById('settings-content-logs').classList.add('hidden');
  document.getElementById('settings-content-downloads').classList.add('hidden');
  document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
  document.getElementById('settings-content-devices').classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  document.getElementById('settings-content-comics-management').classList.add('hidden');
  if (logInterval) clearInterval(logInterval);
});

document.getElementById('settings-tab-logs').addEventListener('click', () => {
  document.getElementById('settings-tab-logs').classList.add('active');
  document.getElementById('settings-tab-general').classList.remove('active');
  document.getElementById('settings-tab-downloads').classList.remove('active');
  document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
  document.getElementById('settings-tab-devices').classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-tab-comics-management').classList.remove('active');
  document.getElementById('settings-content-logs').classList.remove('hidden');
  document.getElementById('settings-content-general').classList.add('hidden');
  document.getElementById('settings-content-downloads').classList.add('hidden');
  document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
  document.getElementById('settings-content-devices').classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  document.getElementById('settings-content-comics-management').classList.add('hidden');
  fetchLogs();
  if (logInterval) clearInterval(logInterval);
  logInterval = setInterval(fetchLogs, 3000);
});

document.getElementById('settings-tab-downloads').addEventListener('click', async () => {
  document.getElementById('settings-tab-downloads').classList.add('active');
  document.getElementById('settings-tab-general').classList.remove('active');
  document.getElementById('settings-tab-logs').classList.remove('active');
  document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
  document.getElementById('settings-tab-devices').classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-tab-comics-management').classList.remove('active');
  document.getElementById('settings-content-downloads').classList.remove('hidden');
  document.getElementById('settings-content-general').classList.add('hidden');
  document.getElementById('settings-content-logs').classList.add('hidden');
  document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
  document.getElementById('settings-content-devices').classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  document.getElementById('settings-content-comics-management').classList.add('hidden');
  if (logInterval) clearInterval(logInterval);

  await refreshDownloadsInfo();
});

document.getElementById('settings-tab-comics-defaults')?.addEventListener('click', async () => {
  document.getElementById('settings-tab-comics-defaults').classList.add('active');
  document.getElementById('settings-tab-general').classList.remove('active');
  document.getElementById('settings-tab-logs').classList.remove('active');
  document.getElementById('settings-tab-downloads').classList.remove('active');
  document.getElementById('settings-tab-devices').classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-tab-comics-management').classList.remove('active');
  document.getElementById('settings-content-comics-defaults').classList.remove('hidden');
  document.getElementById('settings-content-general').classList.add('hidden');
  document.getElementById('settings-content-logs').classList.add('hidden');
  document.getElementById('settings-content-downloads').classList.add('hidden');
  document.getElementById('settings-content-devices').classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  document.getElementById('settings-content-comics-management').classList.add('hidden');
  if (logInterval) clearInterval(logInterval);

  // Load user's manga mode preferences when tab is opened
  await loadComicsDefaults();
});

document.getElementById('settings-tab-devices').addEventListener('click', async () => {
  document.getElementById('settings-tab-devices').classList.add('active');
  document.getElementById('settings-tab-general').classList.remove('active');
  document.getElementById('settings-tab-logs').classList.remove('active');
  document.getElementById('settings-tab-downloads').classList.remove('active');
  document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-tab-comics-management').classList.remove('active');
  document.getElementById('settings-content-devices').classList.remove('hidden');
  document.getElementById('settings-content-general').classList.add('hidden');
  document.getElementById('settings-content-logs').classList.add('hidden');
  document.getElementById('settings-content-downloads').classList.add('hidden');
  document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  document.getElementById('settings-content-comics-management').classList.add('hidden');
  if (logInterval) clearInterval(logInterval);

  // Load user list for admin filter (if admin)
  await loadUserList();
  await refreshDeviceList();
});

// Users tab - only exists for admin users
const settingsTabUsersEl = document.getElementById('settings-tab-users');
if (settingsTabUsersEl) {
  settingsTabUsersEl.addEventListener('click', async () => {
    document.getElementById('settings-tab-users').classList.add('active');
    document.getElementById('settings-tab-general').classList.remove('active');
    document.getElementById('settings-tab-logs').classList.remove('active');
    document.getElementById('settings-tab-downloads').classList.remove('active');
    document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
    document.getElementById('settings-tab-devices').classList.remove('active');
    document.getElementById('settings-tab-comics-management').classList.remove('active');
    document.getElementById('settings-content-users').classList.remove('hidden');
    document.getElementById('settings-content-general').classList.add('hidden');
    document.getElementById('settings-content-logs').classList.add('hidden');
    document.getElementById('settings-content-downloads').classList.add('hidden');
    document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
    document.getElementById('settings-content-devices').classList.add('hidden');
    document.getElementById('settings-content-comics-management').classList.add('hidden');
    if (logInterval) clearInterval(logInterval);

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

document.getElementById('settings-tab-comics-management').addEventListener('click', () => {
  document.getElementById('settings-tab-comics-management').classList.add('active');
  document.getElementById('settings-tab-general').classList.remove('active');
  document.getElementById('settings-tab-logs').classList.remove('active');
  document.getElementById('settings-tab-downloads').classList.remove('active');
  document.getElementById('settings-tab-comics-defaults')?.classList.remove('active');
  document.getElementById('settings-tab-devices').classList.remove('active');
  document.getElementById('settings-tab-users')?.classList.remove('active');
  document.getElementById('settings-content-comics-management').classList.remove('hidden');
  document.getElementById('settings-content-general').classList.add('hidden');
  document.getElementById('settings-content-logs').classList.add('hidden');
  document.getElementById('settings-content-downloads').classList.add('hidden');
  document.getElementById('settings-content-comics-defaults')?.classList.add('hidden');
  document.getElementById('settings-content-devices').classList.add('hidden');
  document.getElementById('settings-content-users')?.classList.add('hidden');
  if (logInterval) clearInterval(logInterval);
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
ctRunBtn.addEventListener('click', async () => {
  await fetch(`${API_BASE_URL}/api/v1/comictagger/run`, { method: 'POST' });
});
ctTabSettings.addEventListener('click', () => {
  ctTabSettings.classList.add('active');
  ctTabOutput.classList.remove('active');
  ctContentSettings.classList.remove('hidden');
  ctContentOutput.classList.add('hidden');
});
ctTabOutput.addEventListener('click', () => {
  ctTabOutput.classList.add('active');
  ctTabSettings.classList.remove('active');
  ctContentOutput.classList.remove('hidden');
  ctContentSettings.classList.add('hidden');
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
    if (!response.ok) throw new Error('Failed to save metadata.');
    saveStatusDiv.textContent = 'Changes saved successfully!';
    setComicSummary(window.currentMetadata.Summary, { preserveExpansion: true });
    setTimeout(() => { saveStatusDiv.textContent = ''; }, 3000);
  } catch (error) {
    saveStatusDiv.textContent = `Save failed: ${error.message}`;
  }
});

