import {
  state,
  getRelativePath,
  settingsModal,
  settingsTabDevices,
  settingsForm,
  scanIntervalInput,
  apiKeyInput,
  settingsStatusDiv,
  scanButton,
  fullScanButton,
  logsContainer
} from './globals.js';

import { triggerScan } from './events.js';

const global = new Proxy(typeof window !== 'undefined' ? window : globalThis, {
  get(target, prop) {
    if (prop in state) {
      return state[prop];
    }
    const val = target[prop];
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
  set(target, prop, value) {
    state[prop] = value;
    try {
      target[prop] = value;
    } catch (e) {}
    return true;
  }
});

// --- SETTINGS & LOGS ---
function openSettingsModal() {
  // Always ensure admin UI is hidden for non-admins when opening settings
  if (typeof global.hideAdminUI === 'function') {
    global.hideAdminUI();
  }

  if (!global._isNavigatingFromRouter && global.router) {
    if (!getRelativePath().startsWith('/settings')) {
      global.router.navigate('/settings', true);
    }
  }
  settingsModal.classList.remove('hidden');
  fetchSettings();
  refreshLibraryFolders();
  if (settingsTabDevices && settingsTabDevices.classList.contains('active')) {
    if (typeof global.refreshDeviceList === 'function') {
      global.refreshDeviceList();
    }
  }
  // If the Guided Reader tab is the active one when re-opening settings,
  // re-arm its live polling/SSE — closeSettingsModal tears it down.
  const guidedPane = document.getElementById('settings-content-guided-reader');
  if (guidedPane && !guidedPane.classList.contains('hidden')
      && typeof global.openGuidedReaderTab === 'function') {
    global.openGuidedReaderTab();
  }
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  if (global.logInterval) {
    clearInterval(global.logInterval);
    global.logInterval = null;
  }
  if (global.router && getRelativePath().startsWith('/settings')) {
    const path = global.getPathForCurrentView ? global.getPathForCurrentView() : '/';
    global.router.navigate(path, true);
  }
}

let initialMetadataStorage = 'archive';

async function fetchSettings() {
  try {
    const response = await fetch(`${global.API_BASE_URL}/api/v1/settings`);
    const data = await response.json();
    if (scanIntervalInput) {
      scanIntervalInput.value = data.scanInterval || 5;
    }

    // Handle allowed formats
    const allowedFormatsSelect = document.getElementById('allowed-formats-select');
    if (allowedFormatsSelect && data.allowedFormats) {
      allowedFormatsSelect.value = data.allowedFormats;
    }

    // Handle metadata storage
    const metadataStorageSelect = document.getElementById('metadata-storage-select');
    if (metadataStorageSelect && data.metadataStorage) {
      metadataStorageSelect.value = data.metadataStorage;
      initialMetadataStorage = data.metadataStorage;
    }

    // Handle API key display
    if (apiKeyInput) {
      if (data.comicVineApiKey !== undefined) {
        // Admin user - show actual key
        apiKeyInput.value = data.comicVineApiKey || '';
        apiKeyInput.placeholder = 'Enter your ComicVine API key';
      } else if (data.hasApiKey) {
        // Non-admin user with key configured - show masked
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '••••••••••••••••';
        apiKeyInput.disabled = true;
      } else {
        // No key configured
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'Not configured';
        apiKeyInput.disabled = true;
      }
    }
  } catch (error) {
    if (settingsStatusDiv) {
      settingsStatusDiv.textContent = 'Failed to load settings.';
    }
  }
}

async function refreshLibraryFolders() {
  const list = document.getElementById('library-folders-list');
  const adminSection = document.getElementById('admin-only-libraries');
  if (!list) return;

  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`);

    if (res.status === 403) {
      if (adminSection) adminSection.classList.add('hidden');
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch libraries');

    if (adminSection) adminSection.classList.remove('hidden');

    // Update global state so the main UI knows about these folders
    if (Array.isArray(data.libraries)) {
      global.configuredRootFolders = data.libraries.map((lib, index) => `lib_${index}`);
      global.LIBRARY_NAMES = global.LIBRARY_NAMES || {};
      data.libraries.forEach((lib, index) => {
        const id = `lib_${index}`;
        const name = lib.path.split(/[\\\/]/).filter(Boolean).pop() || `Library ${index + 1}`;
        global.LIBRARY_NAMES[id] = name;
      });
    }

    list.innerHTML = data.libraries.map(lib => `
      <div class="flex items-center justify-between bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-all group">
        <div class="flex items-center min-w-0 flex-1">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-3 text-purple-400 opacity-70 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <div class="min-w-0 flex-1">
            <div class="text-sm truncate text-gray-200" title="${lib.path}">${lib.path}</div>
            <div class="text-[10px] uppercase tracking-wider text-gray-500 font-bold">${lib.hierarchyMode === 'folder' ? 'Folder Mode' : 'Metadata Mode'}</div>
          </div>
        </div>
        <button class="remove-library-btn text-gray-500 hover:text-red-400 font-bold px-2 transition-colors flex-shrink-0" data-path="${lib.path}" title="Remove Library">&times;</button>
      </div>
    `).join('') || '<p class="text-sm text-gray-500 italic">No library folders added.</p>';

    // Add event listeners for remove buttons
    list.querySelectorAll('.remove-library-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = btn.dataset.path;
        if (confirm(`Remove library folder: ${path}?`)) {
          await removeLibraryFolder(path);
        }
      });
    });
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p class="text-sm text-red-500">Error: ${err.message}</p>`;
  }
}

async function removeLibraryFolder(path) {
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to remove library');

    await refreshLibraryFolders();
    if (typeof global.fetchLibraryFromServer === 'function') {
      await global.fetchLibraryFromServer();
    } else if (typeof global.fetchLibrary === 'function') {
      await global.fetchLibrary();
    }
    if (typeof global.showSettingsMessage === 'function') {
      global.showSettingsMessage('Library removed successfully', 'success');
    }
  } catch (err) {
    if (typeof global.showSettingsMessage === 'function') {
      global.showSettingsMessage(`Error: ${err.message}`, 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('add-library-btn');
  const pathInput = document.getElementById('new-library-path');
  const modeSelect = document.getElementById('new-library-mode');

  if (addBtn && pathInput) {
    addBtn.addEventListener('click', async () => {
      const path = pathInput.value.trim();
      const mode = modeSelect ? modeSelect.value : 'metadata';
      if (!path) return;

      try {
        addBtn.disabled = true;
        const res = await fetch(`${global.API_BASE_URL}/api/v1/admin/libraries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, hierarchyMode: mode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to add library');

        pathInput.value = '';
        await refreshLibraryFolders();
        if (typeof global.fetchLibraryFromServer === 'function') {
          await global.fetchLibraryFromServer();
        } else if (typeof global.fetchLibrary === 'function') {
          await global.fetchLibrary();
        }
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Library added successfully', 'success');
        }
      } catch (err) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage(`Error: ${err.message}`, 'error');
        }
      } finally {
        addBtn.disabled = false;
      }
    });
  }
});

if (settingsForm) {
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (settingsStatusDiv) settingsStatusDiv.textContent = 'Saving...';

    const interval = scanIntervalInput ? scanIntervalInput.value : null;
    const apiKey = apiKeyInput ? apiKeyInput.value : null;
    const allowedFormats = document.getElementById('allowed-formats-select')?.value || 'cbz';
    const metadataStorage = document.getElementById('metadata-storage-select')?.value || 'archive';

    try {
      const res = await fetch(`${global.API_BASE_URL}/api/v1/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval, apiKey, allowedFormats, metadataStorage })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred.' }));
        throw new Error(errorData.message);
      }

      if (settingsStatusDiv) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage('Settings saved!', 'success');
        }
      }
      if (typeof global.fetchLibrary === 'function') {
        global.fetchLibrary(); // Refresh library after saving settings
      }
    } catch (error) {
      if (settingsStatusDiv) {
        if (typeof global.showSettingsMessage === 'function') {
          global.showSettingsMessage(`Error: ${error.message}`, 'error');
        }
      }
    }
  });
}

if (scanButton) {
  scanButton.addEventListener('click', async () => {
    scanButton.textContent = 'Scanning...';
    scanButton.disabled = true;
    try {
      await triggerScan();
      if (typeof global.showSettingsMessage === 'function') {
        global.showSettingsMessage('Scan initiated successfully.', 'success');
      }
    } catch (e) {
      if (typeof global.showSettingsMessage === 'function') {
        global.showSettingsMessage('Failed to start scan.', 'error');
      }
    } finally {
      setTimeout(async () => {
        scanButton.textContent = 'Scan Now';
        scanButton.disabled = false;
        if (typeof global.fetchLibrary === 'function') {
          await global.fetchLibrary();
        }
      }, 3000);
    }
  });
}

if (fullScanButton) {
  fullScanButton.addEventListener('click', async () => {
    fullScanButton.textContent = 'Scanning...';
    fullScanButton.disabled = true;
    try {
      await triggerScan(null, true);
      if (typeof global.showSettingsMessage === 'function') {
        global.showSettingsMessage('Full scan initiated successfully.', 'success');
      }
    } catch (e) {
      if (typeof global.showSettingsMessage === 'function') {
        global.showSettingsMessage('Failed to start full scan.', 'error');
      }
    } finally {
      setTimeout(async () => {
        fullScanButton.textContent = 'Full Scan';
        fullScanButton.disabled = false;
        if (typeof global.fetchLibrary === 'function') {
          await global.fetchLibrary();
        }
      }, 3000);
    }
  });
}

async function fetchLogs() {
  const levelFilter = document.getElementById('log-level-filter');
  const categoryFilter = document.getElementById('log-category-filter');
  if (!levelFilter || !categoryFilter || !logsContainer) return;

  const level = levelFilter.value;
  const category = categoryFilter.value;
  try {
    const res = await fetch(`${global.API_BASE_URL}/api/v1/logs?level=${level}&category=${category}`);
    if (!res.ok) throw new Error('Server returned an error');
    const logs = await res.json();
    logsContainer.innerHTML = logs.reverse().map(log =>
      `<div class="log-entry"><span class="log-${log.level}">${log.level}</span> <span class="log-${log.category}">[${log.category}]</span> ${log.message}</div>`
    ).join('');
  } catch (e) {
    logsContainer.innerHTML = '<div class="text-red-500">Failed to fetch logs.</div>';
  }
}

export {
  openSettingsModal,
  closeSettingsModal,
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
