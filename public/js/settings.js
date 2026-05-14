// --- SETTINGS & LOGS ---
function openSettingsModal() {
  // Always ensure admin UI is hidden for non-admins when opening settings
  if (typeof window.hideAdminUI === 'function') {
    window.hideAdminUI();
  }

  if (!window._isNavigatingFromRouter && window.router) {
    if (!getRelativePath().startsWith('/settings')) {
      window.router.navigate('/settings', true);
    }
  }
  settingsModal.classList.remove('hidden');
  fetchSettings();
  refreshLibraryFolders();
  if (settingsTabDevices && settingsTabDevices.classList.contains('active')) {
    refreshDeviceList();
  }
  // If the Guided Reader tab is the active one when re-opening settings,
  // re-arm its live polling/SSE — closeSettingsModal tears it down.
  const guidedPane = document.getElementById('settings-content-guided-reader');
  if (guidedPane && !guidedPane.classList.contains('hidden')
      && typeof window.openGuidedReaderTab === 'function') {
    window.openGuidedReaderTab();
  }
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  if (logInterval) clearInterval(logInterval);
  if (window.router && getRelativePath().startsWith('/settings')) {
    const path = window.getPathForCurrentView ? window.getPathForCurrentView() : '/';
    window.router.navigate(path, true);
  }
}

let initialMetadataStorage = 'archive';

async function fetchSettings() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/settings`);
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
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/libraries`);

    if (res.status === 403) {
      if (adminSection) adminSection.classList.add('hidden');
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch libraries');

    if (adminSection) adminSection.classList.remove('hidden');

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
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/libraries`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to remove library');

    await refreshLibraryFolders();
    showSettingsMessage('Library removed successfully', 'success');
  } catch (err) {
    showSettingsMessage(`Error: ${err.message}`, 'error');
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
        const res = await fetch(`${API_BASE_URL}/api/v1/admin/libraries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, hierarchyMode: mode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to add library');

        pathInput.value = '';
        await refreshLibraryFolders();
        showSettingsMessage('Library added successfully', 'success');
      } catch (err) {
        showSettingsMessage(`Error: ${err.message}`, 'error');
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
      const res = await fetch(`${API_BASE_URL}/api/v1/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval, apiKey, allowedFormats, metadataStorage })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred.' }));
        throw new Error(errorData.message);
      }

      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Settings saved!';
      setTimeout(() => {
        if (settingsStatusDiv) settingsStatusDiv.textContent = '';
        closeSettingsModal();
        fetchLibrary(); // Refresh library after saving settings
      }, 1500);
    } catch (error) {
      if (settingsStatusDiv) settingsStatusDiv.textContent = `Error: ${error.message}`;
    }
  });
}

if (scanButton) {
  scanButton.addEventListener('click', async () => {
    scanButton.textContent = 'Scanning...';
    scanButton.disabled = true;
    try {
      await triggerScan();
      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Scan initiated successfully.';
    } catch (e) {
      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Failed to start scan.';
    } finally {
      setTimeout(async () => {
        scanButton.textContent = 'Scan Now';
        scanButton.disabled = false;
        if (settingsStatusDiv) settingsStatusDiv.textContent = '';
        await fetchLibrary();
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
      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Full scan initiated successfully.';
    } catch (e) {
      if (settingsStatusDiv) settingsStatusDiv.textContent = 'Failed to start full scan.';
    } finally {
      setTimeout(async () => {
        fullScanButton.textContent = 'Full Scan';
        fullScanButton.disabled = false;
        if (settingsStatusDiv) settingsStatusDiv.textContent = '';
        await fetchLibrary();
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
    const res = await fetch(`${API_BASE_URL}/api/v1/logs?level=${level}&category=${category}`);
    if (!res.ok) throw new Error('Server returned an error');
    const logs = await res.json();
    logsContainer.innerHTML = logs.reverse().map(log =>
      `<div class="log-entry"><span class="log-${log.level}">${log.level}</span> <span class="log-${log.category}">[${log.category}]</span> ${log.message}</div>`
    ).join('');
  } catch (e) {
    logsContainer.innerHTML = '<div class="text-red-500">Failed to fetch logs.</div>';
  }
}

// --- DEVICE MANAGEMENT ---
let devicesStatusTimeout = null;

function escapeHtmlValue(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDeviceTimestamp(timestamp) {
  if (!timestamp) return 'Never';
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'Never';
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}

function getStoredDeviceInfo() {
  const deviceId = (window.syncManager && window.syncManager.deviceId) || localStorage.getItem('comicsNow_deviceId');
  const deviceName = (window.syncManager && window.syncManager.deviceName) || localStorage.getItem('comicsNow_deviceName');
  return { deviceId, deviceName };
}

function setDevicesStatus(message = '', tone = 'info', autoClear) {
  if (!devicesStatusDiv) return;

  if (devicesStatusTimeout) {
    clearTimeout(devicesStatusTimeout);
    devicesStatusTimeout = null;
  }

  devicesStatusDiv.textContent = message;
  devicesStatusDiv.classList.remove('text-red-400', 'text-green-400', 'text-gray-300', 'text-gray-400');

  if (!message) {
    devicesStatusDiv.classList.add('text-gray-400');
    return;
  }

  if (tone === 'error') {
    devicesStatusDiv.classList.add('text-red-400');
  } else if (tone === 'success') {
    devicesStatusDiv.classList.add('text-green-400');
  } else {
    devicesStatusDiv.classList.add('text-gray-300');
  }

  const shouldAutoClear = autoClear !== undefined ? autoClear : tone !== 'error';
  if (shouldAutoClear) {
    devicesStatusTimeout = setTimeout(() => {
      devicesStatusTimeout = null;
      setDevicesStatus('');
    }, 4000);
  }
}

function renderDeviceList(devices) {
  if (!devicesListDiv) return;

  if (!Array.isArray(devices) || devices.length === 0) {
    devicesListDiv.innerHTML = '<div class="bg-gray-700 text-gray-300 p-4 rounded-lg">No registered devices found.</div>';
    return;
  }

  const { deviceId: currentDeviceId } = getStoredDeviceInfo();

  const deviceCards = devices.map((device) => {
    const displayName = device.deviceName ? escapeHtmlValue(device.deviceName) : 'Unnamed Device';
    const deviceId = escapeHtmlValue(device.deviceId);
    const lastSeen = formatDeviceTimestamp(device.lastSeen);
    const created = formatDeviceTimestamp(device.created);
    const isCurrent = currentDeviceId && device.deviceId === currentDeviceId;
    const currentBadge = isCurrent
      ? '<span class="px-2 py-0.5 text-xs bg-purple-600 text-white rounded-full uppercase tracking-wide">This Device</span>'
      : '';

    return `
      <div class="bg-gray-800/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-gray-700/50 hover:border-purple-500/50 transition-colors group">
        <div class="space-y-1 text-sm">
          <div class="text-white font-semibold text-base flex flex-wrap items-center gap-2">
            <span>${displayName}</span>
            ${currentBadge}
          </div>
          <div class="text-gray-400 font-mono text-xs break-all opacity-60">ID: ${deviceId}</div>
          <div class="text-gray-400 mt-2">
            <span class="text-gray-500">Last seen:</span> ${lastSeen}
          </div>
          <div class="text-gray-400">
            <span class="text-gray-500">Registered:</span> ${created}
          </div>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto">
          <button
            class="device-remove-btn bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white font-bold py-2 px-4 rounded-lg transition-all border border-red-600/30"
            data-device-id="${device.deviceId}"
            data-device-name="${displayName}"
          >
            Remove
          </button>
        </div>
      </div>
    `;
  }).join('');

  devicesListDiv.innerHTML = deviceCards;

  // Add event listeners to remove buttons
  document.querySelectorAll('.device-remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const deviceId = e.target.dataset.deviceId;
      const deviceName = e.target.dataset.deviceName;

      if (!confirm(`Are you sure you want to remove device "${deviceName}"? This will clear its sync history.`)) {
        return;
      }

      try {
        btn.disabled = true;
        btn.textContent = 'Removing...';

        const res = await fetch(`${API_BASE_URL}/api/v1/devices/${deviceId}`, {
          method: 'DELETE'
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || 'Failed to remove device');
        }

        setDevicesStatus('Device removed successfully', 'success', true);
        await refreshDeviceList();
      } catch (error) {
        
        setDevicesStatus(`Failed to remove device: ${error.message}`, 'error', false);
        btn.disabled = false;
        btn.textContent = 'Remove';
      }
    });
  });
}

async function loadUserList() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/users`);

    // If forbidden (not admin), hide the filter
    if (res.status === 403) {
      const filterDiv = document.getElementById('devices-user-filter');
      if (filterDiv) filterDiv.classList.add('hidden');
      return;
    }

    const data = await res.json();

    if (res.ok && data.users && Array.isArray(data.users)) {
      const userSelect = document.getElementById('devices-user-select');
      const filterDiv = document.getElementById('devices-user-filter');

      if (userSelect && filterDiv) {
        // Show filter for admins
        filterDiv.classList.remove('hidden');

        // Populate dropdown
        userSelect.innerHTML = '<option value="">My Devices</option>';
        data.users.forEach(user => {
          const option = document.createElement('option');
          option.value = user.userId;
          option.textContent = `${user.email} (${user.userId})`;
          userSelect.appendChild(option);
        });

        // Add change event listener
        if (!userSelect._changeListener) {
          userSelect._changeListener = true;
          userSelect.addEventListener('change', () => {
            refreshDeviceList();
          });
        }
      }
    }
  } catch (error) {
    
    // Silently fail - user filter just won't be available
  }
}

async function refreshDeviceList() {
  if (!devicesListDiv) return;

  const originalButtonLabel = refreshDevicesBtn ? refreshDevicesBtn.textContent : null;
  if (refreshDevicesBtn) {
    refreshDevicesBtn.disabled = true;
    refreshDevicesBtn.textContent = 'Refreshing...';
  }

  setDevicesStatus('Loading devices...', 'info', false);
  devicesListDiv.innerHTML = '<div class="bg-gray-700 text-gray-300 p-4 rounded-lg">Loading devices...</div>';

  try {
    // Check if user filter is set (admin only)
    const userSelect = document.getElementById('devices-user-select');
    const selectedUserId = userSelect ? userSelect.value : '';

    const url = selectedUserId
      ? `${API_BASE_URL}/api/v1/devices?userId=${encodeURIComponent(selectedUserId)}`
      : `${API_BASE_URL}/api/v1/devices`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Failed to load devices');
    }

    renderDeviceList(data.devices || []);

    // Show viewing info for admins
    if (data.viewingUserId && data.viewingUserId !== data.currentUserId) {
      setDevicesStatus(`Viewing devices for user: ${data.viewingUserId}`, 'info', false);
    } else {
      setDevicesStatus('', 'info');
    }
  } catch (error) {
    
    devicesListDiv.innerHTML = '<div class="bg-gray-700 text-red-400 p-4 rounded-lg">Failed to load devices.</div>';
    setDevicesStatus(`Failed to load devices: ${error.message}`, 'error', false);
  } finally {
    if (refreshDevicesBtn) {
      refreshDevicesBtn.disabled = false;
      refreshDevicesBtn.textContent = originalButtonLabel || 'Refresh';
    }
  }
}

if (refreshDevicesBtn && !refreshDevicesBtn._refreshListener) {
  refreshDevicesBtn._refreshListener = async () => {
    await refreshDeviceList();
  };
  refreshDevicesBtn.addEventListener('click', refreshDevicesBtn._refreshListener);
}

if (devicesListDiv && !devicesListDiv._deviceClickListener) {
  devicesListDiv._deviceClickListener = async (event) => {
    const button = event.target.closest('button[data-device-id]');
    if (!button) return;

    const deviceId = button.dataset.deviceId;
    const deviceName = button.dataset.deviceName || 'Unnamed Device';
    const { deviceId: currentDeviceId } = getStoredDeviceInfo();
    const isCurrentDevice = currentDeviceId && deviceId === currentDeviceId;

    const confirmMessage = isCurrentDevice
      ? `Remove "${deviceName}"? This is the current device. Removing it will clear its sync history and reset local sync.`
      : `Remove "${deviceName}"? This will clear its sync history.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = 'Removing...';
    setDevicesStatus('Removing device...', 'info', false);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/devices/${deviceId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || 'Failed to remove device');
      }

      if (isCurrentDevice && window.syncManager && typeof window.syncManager.clearStoredDevice === 'function') {
        window.syncManager.clearStoredDevice();
      }

      setDevicesStatus('Device removed.', 'success');
      await refreshDeviceList();
    } catch (error) {
      
      setDevicesStatus(`Failed to remove device: ${error.message}`, 'error', false);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  };

  devicesListDiv.addEventListener('click', devicesListDiv._deviceClickListener);
}

// --- USER MANAGEMENT ---
const settingsTabUsers = document.getElementById('settings-tab-users');
const refreshUsersBtn = document.getElementById('refresh-users-btn');
const usersStatusDiv = document.getElementById('users-status');
const usersListDiv = document.getElementById('users-list');

function setUsersStatus(message, type = 'info', showSpinner = false) {
  if (!usersStatusDiv) return;
  usersStatusDiv.textContent = message;
  usersStatusDiv.className = `text-sm mb-3 ${type === 'error' ? 'text-red-400' : 'text-gray-400'}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

async function refreshUsersList() {
  if (!usersListDiv) return;

  try {
    setUsersStatus('Loading users...', 'info', true);

    const response = await fetch(`${API_BASE_URL}/api/v1/users`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Failed to load users');
    }

    const users = data.users || [];

    if (users.length === 0) {
      usersListDiv.innerHTML = '<p class="text-gray-400 text-center py-4">No users found</p>';
      setUsersStatus('No users registered', 'info', false);
      return;
    }

    setUsersStatus(`${users.length} user${users.length === 1 ? '' : 's'} registered`, 'info', false);

    usersListDiv.innerHTML = users.map(user => `
      <div class="user-card bg-gray-800/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-gray-700/50 hover:border-purple-500/50 transition-all group cursor-pointer" data-user-id="${escapeHtml(user.userId)}" data-user-email="${escapeHtml(user.email)}" data-user-role="${escapeHtml(user.role)}">
        <div class="flex-1 space-y-1">
          <div class="flex items-center gap-3 mb-1">
            <div class="p-2 rounded-full bg-purple-600/10 text-purple-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <span class="text-white font-bold text-lg">${escapeHtml(user.email)}</span>
            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-wider ${user.role === 'admin' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}">
              ${escapeHtml(user.role)}
            </span>
          </div>
          <div class="text-sm text-gray-400 space-y-1 pl-10">
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Registered:</span>
              <span class="text-gray-300">${formatTimestamp(user.created)}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Last seen:</span>
              <span class="text-gray-300">${formatTimestamp(user.lastSeen)}</span>
            </div>
            <div class="text-xs text-gray-600 font-mono mt-1 opacity-60">
              ID: ${escapeHtml(user.userId)}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto pl-10 sm:pl-0">
          ${user.role !== 'admin' 
            ? '<span class="text-purple-400 group-hover:translate-x-1 transition-transform">Manage Access →</span>' 
            : '<span class="text-gray-500 italic text-sm">Full Admin Access</span>'}
        </div>
      </div>
    `).join('');

    // Add click handlers to user cards
    document.querySelectorAll('.user-card').forEach(card => {
      card.addEventListener('click', () => {
        const userId = card.dataset.userId;
        const userEmail = card.dataset.userEmail;
        const userRole = card.dataset.userRole;
        showUserAccessView(userId, userEmail, userRole);
      });
    });

  } catch (error) {

    setUsersStatus(`Failed to load users: ${error.message}`, 'error', false);
    usersListDiv.innerHTML = '<p class="text-red-400 text-center py-4">Failed to load users</p>';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize users tab
if (settingsTabUsers) {
  settingsTabUsers.addEventListener('click', () => {
    refreshUsersList();
  });
}

if (refreshUsersBtn) {
  refreshUsersBtn.addEventListener('click', () => {
    refreshUsersList();
  });
}

// --- USER LIBRARY ACCESS MANAGEMENT ---
let currentAccessUser = null;
let libraryTreeData = null;
let userAccessData = null;

async function showUserAccessView(userId, userEmail, userRole) {
  if (userRole === 'admin') {
    alert('Admin users have full access to all libraries automatically.');
    return;
  }

  currentAccessUser = { userId, userEmail, userRole };

  // Hide users list, show access view
  usersListDiv.classList.add('hidden');
  setUsersStatus('', 'info', false);

  // Create access view UI
  const accessView = document.createElement('div');
  accessView.id = 'user-access-view';
  accessView.className = 'bg-gradient-to-r from-purple-900/30 to-blue-900/30 border-2 border-purple-700/50 rounded-xl p-6 shadow-lg transition-all duration-300';
  accessView.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex-1">
        <button id="back-to-users-btn" class="flex items-center text-gray-400 hover:text-white transition-colors mb-4 group">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-1 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Users
        </button>
        <div class="flex items-center">
          <div class="bg-purple-600/20 p-2 rounded-lg mr-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 class="text-xl font-bold text-white">Library Access for ${escapeHtml(userEmail)}</h3>
            <p class="text-sm text-gray-400">Configure content permissions</p>
          </div>
        </div>
      </div>
    </div>

    <div id="access-status" class="text-sm text-purple-400 mb-4 pl-14"></div>

    <div class="space-y-6">
      <!-- Collapsible Guide -->
      <div class="pl-14">
        <button id="access-guide-toggle" class="text-xs font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-2" aria-expanded="false">
          <span>How to Use Library Access</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div id="access-guide-content" class="hidden mt-4 bg-black/30 rounded-xl p-5 border border-purple-500/20 text-sm">
          <h5 class="font-bold text-white mb-3">Understanding Access Control</h5>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-purple-400 text-xs uppercase mb-1">📚 Library Level</h6>
                <p class="text-gray-400 text-xs">Grant or deny access to entire root library folders.</p>
              </div>
              <div>
                <h6 class="font-bold text-green-400 text-xs uppercase mb-1">🏢 Publisher Level</h6>
                <p class="text-gray-400 text-xs">Control access to all comics from a specific publisher.</p>
              </div>
            </div>
            
            <div class="space-y-3">
              <div>
                <h6 class="font-bold text-blue-400 text-xs uppercase mb-1">📖 Series Level</h6>
                <p class="text-gray-400 text-xs">Fine-tune access to specific series.</p>
              </div>
              <div>
                <h6 class="font-bold text-yellow-400 text-xs uppercase mb-1">📕 Comic Level</h6>
                <p class="text-gray-400 text-xs">Grant or revoke access to individual comic books.</p>
              </div>
            </div>
          </div>

          <div class="mt-4 pt-4 border-t border-purple-500/20">
            <h6 class="font-bold text-white text-xs uppercase mb-2">Checkboxes:</h6>
            <div class="flex flex-wrap gap-4">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-blue-600 rounded text-[10px] font-bold">D</span>
                <span class="text-xs text-gray-400">Direct (This item only)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-yellow-600 rounded text-[10px] font-bold">R</span>
                <span class="text-xs text-gray-400">Recursive (All siblings)</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 flex items-center justify-center bg-purple-600 rounded text-[10px] font-bold">C</span>
                <span class="text-xs text-gray-400">Child (All descendants)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-black/20 rounded-xl border border-purple-500/30 overflow-hidden">
        <div class="flex items-center justify-between p-4 border-b border-purple-500/20 bg-purple-900/10">
          <h4 class="font-bold text-white text-sm uppercase tracking-wider">Content Hierarchy</h4>
          <div class="flex gap-2">
            <button id="select-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Select All
            </button>
            <button id="deselect-all-btn" class="text-[10px] font-bold uppercase tracking-widest bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors border border-gray-700">
              Deselect All
            </button>
          </div>
        </div>

        <div id="access-tree-container" class="p-4 space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-600/50 scrollbar-track-transparent">
          <div class="text-center text-gray-400 py-8 animate-pulse">Loading library structure...</div>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-4 border-t border-purple-500/20">
        <button id="cancel-access-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2.5 px-6 rounded-full transition-all border border-gray-600 shadow-lg">
          Cancel
        </button>
        <button id="save-access-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-8 rounded-full transition-all shadow-lg hover:shadow-purple-900/40">
          Save Access
        </button>
      </div>
    </div>
  `;

  usersListDiv.parentElement.appendChild(accessView);

  // Add event listeners
  document.getElementById('back-to-users-btn').addEventListener('click', hideUserAccessView);
  document.getElementById('cancel-access-btn').addEventListener('click', hideUserAccessView);
  document.getElementById('save-access-btn').addEventListener('click', saveUserAccess);
  document.getElementById('select-all-btn').addEventListener('click', () => toggleAllAccess(true));
  document.getElementById('deselect-all-btn').addEventListener('click', () => toggleAllAccess(false));

  // Add guide toggle listener
  const guideToggle = document.getElementById('access-guide-toggle');
  const guideContent = document.getElementById('access-guide-content');
  if (guideToggle && guideContent) {
    guideToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isExpanded = guideToggle.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        guideContent.classList.add('hidden');
        guideToggle.setAttribute('aria-expanded', 'false');
        guideToggle.textContent = 'How to Use Library Access';
      } else {
        guideContent.classList.remove('hidden');
        guideToggle.setAttribute('aria-expanded', 'true');
        guideToggle.textContent = 'Hide Guide';
      }
    });
  }

  // Load data
  await loadLibraryTreeAndUserAccess(userId);
}

function hideUserAccessView() {
  const accessView = document.getElementById('user-access-view');
  if (accessView) {
    accessView.remove();
  }
  usersListDiv.classList.remove('hidden');
  currentAccessUser = null;
  libraryTreeData = null;
  userAccessData = null;
}

async function loadLibraryTreeAndUserAccess(userId) {
  const statusDiv = document.getElementById('access-status');
  const treeContainer = document.getElementById('access-tree-container');

  try {
    statusDiv.textContent = 'Loading library structure and user access...';

    // Load library tree and user access in parallel
    const [treeResponse, accessResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/library-tree`),
      fetch(`${API_BASE_URL}/api/v1/users/${userId}/access`)
    ]);

    const treeData = await treeResponse.json();
    const accessData = await accessResponse.json();

    if (!treeResponse.ok) {
      throw new Error(treeData.message || 'Failed to load library tree');
    }

    if (!accessResponse.ok) {
      throw new Error(accessData.message || 'Failed to load user access');
    }

    libraryTreeData = treeData.tree || {};
    userAccessData = accessData.access || [];

    // Build access lookup map with direct/child flags
    const accessMap = new Map();
    userAccessData.forEach(item => {
      const key = `${item.accessType}:${item.accessValue}`;
      accessMap.set(key, {
        direct: item.direct_access === 1 || item.direct_access === true,
        child: item.child_access === 1 || item.child_access === true
      });
    });

    // Render tree
    renderLibraryAccessTree(libraryTreeData, accessMap, treeContainer);
    statusDiv.textContent = '';

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'text-sm text-red-400';
    treeContainer.innerHTML = '<div class="text-center text-red-400 py-4">Failed to load library data</div>';
  }
}

function renderLibraryAccessTree(tree, accessMap, container) {
  container.innerHTML = '';

  const rootFolders = Object.keys(tree).sort();

  if (rootFolders.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4">No content found</div>';
    return;
  }

  // Hierarchy: root_folder → publisher → series → comic
  rootFolders.forEach(rootFolder => {
    const publishers = tree[rootFolder];
    const rootDiv = createTreeNode('root_folder', rootFolder, publishers, accessMap, null);
    container.appendChild(rootDiv);
  });
}

function createTreeNode(type, value, children, accessMap, parentNodeDiv) {
  const key = `${type}:${value}`;
  const access = accessMap.get(key) || { direct: false, child: false };
  const hasChildren = children && ((Array.isArray(children) && children.length > 0) || (typeof children === 'object' && Object.keys(children).length > 0));
  const isLeaf = type === 'comic'; // Comics are leaf nodes

  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'border border-gray-700 rounded-lg overflow-hidden mb-2';

  // Create header
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 p-3 bg-gray-900 hover:bg-gray-800 transition-colors';

  // For non-leaf nodes: show three checkboxes (Direct, Recursive, Child)
  // For leaf nodes (comics): show single checkbox
  if (!isLeaf && hasChildren) {
    // Three checkboxes container
    const checkboxesContainer = document.createElement('div');
    checkboxesContainer.className = 'flex flex-col gap-1';

    // Direct access checkbox (D)
    const directCheckbox = document.createElement('input');
    directCheckbox.type = 'checkbox';
    directCheckbox.checked = access.direct;
    directCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-1';
    directCheckbox.dataset.accessType = type;
    directCheckbox.dataset.accessValue = value;
    directCheckbox.dataset.accessMode = 'direct';
    directCheckbox.title = 'Direct access (this item only)';

    // Recursive checkbox (R) - UI helper to select all siblings
    const recursiveCheckbox = document.createElement('input');
    recursiveCheckbox.type = 'checkbox';
    recursiveCheckbox.checked = false; // Never checked by default (UI helper only)
    recursiveCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-yellow-600 focus:ring-yellow-500 focus:ring-1';
    recursiveCheckbox.dataset.accessType = type;
    recursiveCheckbox.dataset.accessValue = value;
    recursiveCheckbox.dataset.accessMode = 'recursive';
    recursiveCheckbox.title = 'Recursive (select all siblings at this level)';

    // Child access checkbox (C)
    const childCheckbox = document.createElement('input');
    childCheckbox.type = 'checkbox';
    childCheckbox.checked = access.child;
    childCheckbox.className = 'w-3.5 h-3.5 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-1';
    childCheckbox.dataset.accessType = type;
    childCheckbox.dataset.accessValue = value;
    childCheckbox.dataset.accessMode = 'child';
    childCheckbox.title = 'Child access (all descendants)';

    checkboxesContainer.appendChild(directCheckbox);
    checkboxesContainer.appendChild(recursiveCheckbox);
    checkboxesContainer.appendChild(childCheckbox);
    header.appendChild(checkboxesContainer);

    // Add event listener to recursive checkbox to select all siblings
    recursiveCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (parentNodeDiv) {
        // Find all sibling nodes at the same level
        const siblingsContainer = parentNodeDiv.querySelector('.children-container');
        if (siblingsContainer) {
          // Find all direct child nodes (siblings of this node)
          siblingsContainer.querySelectorAll(':scope > .border').forEach(siblingNode => {
            // Find the Direct checkbox in each sibling
            const siblingDirectCheckbox = siblingNode.querySelector('input[data-access-mode="direct"]');
            if (siblingDirectCheckbox) {
              // Bidirectional: check R = check all sibling D, uncheck R = uncheck all sibling D
              siblingDirectCheckbox.checked = recursiveCheckbox.checked;
            }
          });
        }
      }
    });

    // Add event listener to child checkbox to cascade down and auto-check parent D
    childCheckbox.addEventListener('change', (e) => {
      e.stopPropagation();

      if (childCheckbox.checked) {
        // Auto-check Direct on this same node (need direct access if you have child access)
        directCheckbox.checked = true;

        // Recursively check all D and C on all descendants
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            const mode = checkbox.dataset.accessMode;
            // Check all Direct and Child checkboxes, skip Recursive (UI helper)
            if (mode === 'direct' || mode === 'child' || mode === 'both') {
              checkbox.checked = true;
            }
          });
        }
      } else {
        // Uncheck C: optionally uncheck all descendant D and C
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            const mode = checkbox.dataset.accessMode;
            // Uncheck all Direct and Child checkboxes
            if (mode === 'direct' || mode === 'child' || mode === 'both') {
              checkbox.checked = false;
            }
          });
        }
      }
    });

    // Add labels for the checkboxes
    const labelsContainer = document.createElement('div');
    labelsContainer.className = 'flex flex-col text-xs text-gray-500';
    labelsContainer.innerHTML = '<span>D</span><span>R</span><span>C</span>';
    header.appendChild(labelsContainer);

  } else {
    // Single checkbox for leaf nodes or nodes without children
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = access.direct || access.child;
    checkbox.className = 'w-4 h-4 rounded border-gray-600 text-purple-600 focus:ring-purple-500 focus:ring-2';
    checkbox.dataset.accessType = type;
    checkbox.dataset.accessValue = value;
    checkbox.dataset.accessMode = 'both';
    header.appendChild(checkbox);
  }

  // Label
  const label = document.createElement('label');
  label.className = 'flex-1 text-white cursor-pointer text-sm';
  label.textContent = type === 'comic' ? value.name || value : value;
  header.appendChild(label);

  // Expand icon (only for non-leaf nodes with children)
  if (hasChildren && !isLeaf) {
    const expandIcon = document.createElement('span');
    expandIcon.className = 'text-gray-400 transition-transform cursor-pointer';
    expandIcon.innerHTML = '▼';
    header.appendChild(expandIcon);

    // Toggle expansion on header click
    header.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const childrenContainer = nodeDiv.querySelector('.children-container');
        if (childrenContainer) {
          childrenContainer.classList.toggle('hidden');
          expandIcon.classList.toggle('rotate-180');
        }
      }
    });
  }

  nodeDiv.appendChild(header);

  // Create children container
  if (hasChildren && !isLeaf) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'children-container pl-6 pr-3 pb-2 bg-gray-900 hidden';

    if (type === 'root_folder') {
      // Children are publishers (object with series objects)
      Object.keys(children).sort().forEach(publisher => {
        const series = children[publisher];
        const publisherNode = createTreeNode('publisher', publisher, series, accessMap, nodeDiv);
        childrenContainer.appendChild(publisherNode);
      });
    } else if (type === 'publisher') {
      // Children are series (object with comics arrays)
      Object.keys(children).sort().forEach(seriesName => {
        const comics = children[seriesName];
        const seriesNode = createTreeNode('series', seriesName, comics, accessMap, nodeDiv);
        childrenContainer.appendChild(seriesNode);
      });
    } else if (type === 'series') {
      // Children are comics (array of comic objects)
      if (Array.isArray(children)) {
        children.forEach(comic => {
          const comicNode = createTreeNode('comic', comic, null, accessMap, nodeDiv);
          childrenContainer.appendChild(comicNode);
        });
      }
    }

    nodeDiv.appendChild(childrenContainer);
  }

  return nodeDiv;
}

function toggleAllAccess(selectAll) {
  const treeContainer = document.getElementById('access-tree-container');
  if (!treeContainer) return;

  treeContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.checked = selectAll;
  });
}

async function saveUserAccess() {
  const statusDiv = document.getElementById('access-status');
  const saveBtn = document.getElementById('save-access-btn');

  if (!currentAccessUser) return;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusDiv.textContent = 'Saving access permissions...';
    statusDiv.className = 'text-sm text-gray-400';

    // Collect access data from checkboxes
    // Group by accessType:accessValue to combine direct/child
    // Skip 'recursive' mode as it's UI-only (not saved to database)
    const accessMap = new Map();

    document.querySelectorAll('#access-tree-container input[type="checkbox"]').forEach(checkbox => {
      const accessType = checkbox.dataset.accessType;
      const accessValue = checkbox.dataset.accessValue;
      const accessMode = checkbox.dataset.accessMode;
      const key = `${accessType}:${accessValue}`;

      // Skip recursive checkbox - it's just a UI helper
      if (accessMode === 'recursive') {
        return;
      }

      if (!accessMap.has(key)) {
        accessMap.set(key, {
          accessType,
          accessValue,
          direct_access: false,
          child_access: false
        });
      }

      const item = accessMap.get(key);
      if (accessMode === 'direct') {
        item.direct_access = checkbox.checked;
      } else if (accessMode === 'child') {
        item.child_access = checkbox.checked;
      } else if (accessMode === 'both') {
        // For leaf nodes (comics)
        item.direct_access = checkbox.checked;
        item.child_access = checkbox.checked;
      }
    });

    // Convert map to array, filtering out items with no access
    const access = Array.from(accessMap.values()).filter(item =>
      item.direct_access || item.child_access
    );

    const response = await fetch(`${API_BASE_URL}/api/v1/users/${currentAccessUser.userId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to save access permissions');
    }

    statusDiv.textContent = 'Access permissions saved successfully!';
    statusDiv.className = 'text-sm text-green-400';

    setTimeout(() => {
      hideUserAccessView();
      refreshUsersList();
    }, 1500);

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    statusDiv.className = 'text-sm text-red-400';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Access';
  }
}

// --- COMICS MANAGEMENT ---
document.addEventListener('DOMContentLoaded', () => {
  const renameCbzBtn = document.getElementById('rename-cbz-btn');
  const renameStatusDiv = document.getElementById('rename-status');
  const renameOutputDiv = document.getElementById('rename-output');
  const renameClearBtn = document.getElementById('rename-clear-output');
  const moveComicsBtn = document.getElementById('move-comics-btn');
  const moveStatusDiv = document.getElementById('move-status');
  const moveOutputDiv = document.getElementById('move-output');
  const moveClearBtn = document.getElementById('move-clear-output');

  let renameEventSource = null;
  let moveEventSource = null;

  // Setup rename output streaming
  window.startRenameStream = function() {
    if (renameEventSource) return;

    renameOutputDiv.classList.remove('hidden');
    renameEventSource = new EventSource(`${API_BASE_URL}/api/v1/rename/stream`);

    renameEventSource.onmessage = (event) => {
      const entry = JSON.parse(event.data);
      const line = document.createElement('div');
      line.textContent = entry.message;
      renameOutputDiv.appendChild(line);
      renameOutputDiv.scrollTop = renameOutputDiv.scrollHeight;
    };

    renameEventSource.onerror = () => {
      
    };
  };

  window.stopRenameStream = function() {
    if (renameEventSource) {
      renameEventSource.close();
      renameEventSource = null;
    }
  };

  // Setup move output streaming
  window.startMoveStream = function() {
    if (moveEventSource) return;

    moveOutputDiv.classList.remove('hidden');
    moveEventSource = new EventSource(`${API_BASE_URL}/api/v1/move/stream`);

    moveEventSource.onmessage = (event) => {
      const entry = JSON.parse(event.data);
      const line = document.createElement('div');
      line.textContent = entry.message;
      moveOutputDiv.appendChild(line);
      moveOutputDiv.scrollTop = moveOutputDiv.scrollHeight;
    };

    moveEventSource.onerror = () => {
      
    };
  };

  window.stopMoveStream = function() {
    if (moveEventSource) {
      moveEventSource.close();
      moveEventSource = null;
    }
  };

  // Clear rename output
  if (renameClearBtn) {
    renameClearBtn.addEventListener('click', async () => {
      renameOutputDiv.innerHTML = '';
      renameOutputDiv.classList.add('hidden');
      try {
        await fetch(`${API_BASE_URL}/api/v1/rename/clear`, { method: 'POST' });
      } catch (error) {
        
      }
    });
  }

  // Clear move output
  if (moveClearBtn) {
    moveClearBtn.addEventListener('click', async () => {
      moveOutputDiv.innerHTML = '';
      moveOutputDiv.classList.add('hidden');
      try {
        await fetch(`${API_BASE_URL}/api/v1/move/clear`, { method: 'POST' });
      } catch (error) {
        
      }
    });
  }

  // Management sub-tabs
  const mgmtTabOperations = document.getElementById('mgmt-tab-operations');
  const mgmtTabErrors = document.getElementById('mgmt-tab-errors');
  const mgmtContentOperations = document.getElementById('mgmt-content-operations');
  const mgmtContentErrors = document.getElementById('mgmt-content-errors');
  const errorsList = document.getElementById('errors-list');
  const errorsRefreshBtn = document.getElementById('errors-refresh-btn');

  async function loadOperationErrors() {
    if (!errorsList) return;
    errorsList.innerHTML = '<p class="text-sm text-gray-500 animate-pulse">Loading errors...</p>';
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/operation-errors`);
      const data = await res.json();
      if (!data.ok || data.errors.length === 0) {
        errorsList.innerHTML = '<p class="text-sm text-gray-500">No errors recorded this session.</p>';
        return;
      }
      errorsList.innerHTML = data.errors.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const badge = e.source === 'rename'
          ? '<span class="text-blue-400 text-xs font-bold uppercase">rename</span>'
          : '<span class="text-green-400 text-xs font-bold uppercase">move</span>';
        return `<div class="bg-gray-900 rounded-lg p-3 border border-red-900/40">
          <div class="flex items-center gap-2 mb-1">${badge}<span class="text-gray-500 text-xs">${time}</span></div>
          <p class="text-red-400 text-xs font-mono break-all">${e.message}</p>
        </div>`;
      }).join('');
    } catch {
      errorsList.innerHTML = '<p class="text-sm text-red-400">Failed to load errors.</p>';
    }
  }

  if (mgmtTabOperations && mgmtTabErrors) {
    mgmtTabOperations.addEventListener('click', () => {
      mgmtTabOperations.classList.add('active');
      mgmtTabErrors.classList.remove('active');
      mgmtContentOperations.classList.remove('hidden');
      mgmtContentErrors.classList.add('hidden');
    });
    mgmtTabErrors.addEventListener('click', () => {
      mgmtTabErrors.classList.add('active');
      mgmtTabOperations.classList.remove('active');
      mgmtContentErrors.classList.remove('hidden');
      mgmtContentOperations.classList.add('hidden');
      loadOperationErrors();
    });
  }

  if (errorsRefreshBtn) {
    errorsRefreshBtn.addEventListener('click', loadOperationErrors);
  }


  if (renameCbzBtn && renameStatusDiv) {
    renameCbzBtn.addEventListener('click', async () => {
      // Show output and start streaming
      renameOutputDiv.classList.remove('hidden');
      renameOutputDiv.innerHTML = '';
      startRenameStream();

      renameCbzBtn.textContent = 'Renaming...';
      renameCbzBtn.disabled = true;
      renameStatusDiv.textContent = 'Starting rename operation...';

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/rename-cbz`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || 'Rename operation failed');
        }

        // Build comprehensive status message
        let message = `✓ Processed: ${data.processed || 0} file${data.processed !== 1 ? 's' : ''}`;

        if (data.renamed > 0) {
          message += ` | Renamed: ${data.renamed}`;
        }

        if (data.errors > 0) {
          message += ` | ⚠ Errors: ${data.errors}`;
        }

        // Show detailed results if available
        if (data.results && data.results.length > 0) {
          const failures = data.results.filter(r => !r.success);
          if (failures.length > 0) {
            message += '\n\nFailed files:';
            failures.slice(0, 5).forEach(f => {
              const errorMsg = f.error || 'Unknown error';
              message += `\n• ${f.file}: ${errorMsg}`;
            });
            if (failures.length > 5) {
              message += `\n... and ${failures.length - 5} more error${failures.length - 5 !== 1 ? 's' : ''}`;
            }
          }
        }

        renameStatusDiv.textContent = message;
        renameStatusDiv.style.whiteSpace = 'pre-wrap';

        // Set color based on results
        if (data.errors > 0) {
          renameStatusDiv.className = 'text-sm mt-2 text-yellow-400';
        } else {
          renameStatusDiv.className = 'text-sm mt-2 text-green-400';
        }

      } catch (error) {
        
        renameStatusDiv.textContent = `✗ Failed: ${error.message || 'Unknown error occurred'}`;
        renameStatusDiv.className = 'text-sm mt-2 text-red-400';
        renameStatusDiv.style.whiteSpace = 'pre-wrap';
      } finally {
        // Re-enable button quickly
        setTimeout(() => {
          renameCbzBtn.textContent = 'Rename';
          renameCbzBtn.disabled = false;
        }, 1000);

        // Clear status message after longer delay
        setTimeout(() => {
          renameStatusDiv.textContent = '';
          renameStatusDiv.className = 'text-sm mt-2';
          renameStatusDiv.style.whiteSpace = '';
        }, 10000);
      }
    });
  }

  if (moveComicsBtn && moveStatusDiv) {
    moveComicsBtn.addEventListener('click', async () => {
      try {
        // First, get available directories
        const dirRes = await fetch(`${API_BASE_URL}/api/v1/comics-directories`);
        const dirData = await dirRes.json();

        if (!dirRes.ok) {
          throw new Error(dirData.message || 'Failed to get comics directories');
        }

        if (dirData.directories.length === 0) {
          throw new Error('No comics directories configured');
        }

        if (dirData.directories.length === 1) {
          // Only one directory, move automatically
          await performMove(dirData.directories[0].fullPath);
        } else {
          // Multiple directories, show selection modal
          showDirectorySelectionModal(dirData.directories);
        }

      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-sm mt-2 text-red-400';
        setTimeout(() => {
          moveStatusDiv.textContent = '';
          moveStatusDiv.className = 'text-sm mt-2';
        }, 5000);
      }
    });

    async function performMove(targetDirectory) {
      // Show output and start streaming
      moveOutputDiv.classList.remove('hidden');
      moveOutputDiv.innerHTML = '';
      startMoveStream();

      moveComicsBtn.textContent = 'Moving...';
      moveComicsBtn.disabled = true;
      moveStatusDiv.textContent = 'Starting move operation...';

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/move-comics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetDirectory })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.message || 'Move operation failed');
        }

        let message = `Move complete! Processed: ${data.processed}, Moved: ${data.moved}`;
        if (data.errors > 0) {
          message += `, Errors: ${data.errors}`;
        }
        if (data.destDirectory) {
          message += ` to ${data.destDirectory}`;
        }

        moveStatusDiv.textContent = message;
        moveStatusDiv.className = 'text-sm mt-2 text-green-400';

      } catch (error) {
        moveStatusDiv.textContent = `Error: ${error.message}`;
        moveStatusDiv.className = 'text-sm mt-2 text-red-400';
      } finally {
        setTimeout(() => {
          moveComicsBtn.textContent = 'Move Comic';
          moveComicsBtn.disabled = false;
          moveStatusDiv.textContent = '';
          moveStatusDiv.className = 'text-sm mt-2';
        }, 5000);
      }
    }

    function showDirectorySelectionModal(directories) {
      const modal = document.getElementById('directory-selection-modal');
      const optionsContainer = document.getElementById('directory-options');
      const confirmBtn = document.getElementById('directory-confirm-btn');
      const cancelBtn = document.getElementById('directory-cancel-btn');
      const closeBtn = document.getElementById('directory-modal-close');

      // Clear previous options
      optionsContainer.innerHTML = '';
      let selectedDirectory = null;

      // Create radio buttons for each directory
      directories.forEach((dir, index) => {
        const option = document.createElement('div');
        option.className = 'flex items-center space-x-3 p-3 rounded-lg border border-gray-600 hover:border-gray-500 hover:bg-gray-750 transition-colors cursor-pointer';
        option.innerHTML = `
          <input type="radio" id="dir-${index}" name="directory" value="${dir.fullPath}" class="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 focus:ring-green-500 focus:ring-2">
          <div class="flex-grow">
            <label for="dir-${index}" class="text-white cursor-pointer font-medium block">${dir.name}</label>
            <span class="text-gray-400 text-sm">${dir.fullPath}</span>
          </div>
        `;
        optionsContainer.appendChild(option);

        // Make the whole option clickable
        option.addEventListener('click', () => {
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          selectedDirectory = dir.fullPath;
          confirmBtn.disabled = false;

          // Remove selection styling from other options
          optionsContainer.querySelectorAll('div').forEach(opt => {
            opt.classList.remove('border-green-500', 'bg-gray-700');
            opt.classList.add('border-gray-600');
          });

          // Add selection styling to this option
          option.classList.remove('border-gray-600');
          option.classList.add('border-green-500', 'bg-gray-700');
        });
      });

      // Show modal
      modal.classList.remove('hidden');

      // Handle confirm
      const handleConfirm = async () => {
        if (selectedDirectory) {
          modal.classList.add('hidden');
          await performMove(selectedDirectory);
        }
        cleanup();
      };

      // Handle cancel/close
      const handleCancel = () => {
        modal.classList.add('hidden');
        cleanup();
      };

      const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        closeBtn.removeEventListener('click', handleCancel);
        confirmBtn.disabled = true;
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      closeBtn.addEventListener('click', handleCancel);
    }
  }
});

// --- COMICS DEFAULTS ---
async function loadComicsDefaults() {
  const toggleCheckbox = document.getElementById('manga-mode-library');
  const allowedFormatsSelect = document.getElementById('allowed-formats-select');
  const metadataStorageSelect = document.getElementById('metadata-storage-select');
  const migrationOptions = document.getElementById('metadata-migration-options');
  const migrateBtn = document.getElementById('migrate-metadata-btn');
  const applyCheckbox = document.getElementById('apply-to-existing-metadata');
  const migrationStatus = document.getElementById('metadata-migration-status');
  
  const labelStandard = document.getElementById('manga-mode-label-standard');
  const labelManga = document.getElementById('manga-mode-label-manga');
  const currentValue = document.getElementById('manga-mode-current-value');
  const loadingIndicator = document.getElementById('manga-mode-loading');
  const statusMessage = document.getElementById('manga-mode-status');

  // Store initial metadata storage value to detect changes
  let initialMetadataStorage = null;

  // Handle Metadata Storage Change
  if (metadataStorageSelect && migrationOptions) {
    // We need the initial value, which is loaded in fetchSettings
    // But since fetchSettings is async, we'll wait a bit or just assume it's what's currently in the select
    setTimeout(() => {
      initialMetadataStorage = metadataStorageSelect.value;
    }, 500);

    metadataStorageSelect.addEventListener('change', () => {
      const newValue = metadataStorageSelect.value;
      if (newValue !== initialMetadataStorage) {
        migrationOptions.classList.remove('hidden');
        if (migrationStatus) migrationStatus.textContent = '';
        if (applyCheckbox) applyCheckbox.checked = false;
      } else {
        migrationOptions.classList.add('hidden');
      }
    });
  }

  // Handle Migration Button
  if (migrateBtn && metadataStorageSelect) {
    migrateBtn.addEventListener('click', async () => {
      if (applyCheckbox && !applyCheckbox.checked) {
        if (migrationStatus) {
          migrationStatus.textContent = 'Please confirm by checking the box above.';
          migrationStatus.className = 'text-xs mt-3 text-center text-yellow-400';
        }
        return;
      }

      const mode = metadataStorageSelect.value;
      migrateBtn.disabled = true;
      migrateBtn.textContent = 'Migrating...';
      if (migrationStatus) {
        migrationStatus.textContent = 'Starting migration process...';
        migrationStatus.className = 'text-xs mt-3 text-center text-blue-400';
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/admin/metadata/migrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, applyToExisting: true })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Migration failed');
        }

        if (migrationStatus) {
          migrationStatus.textContent = `✓ Migration complete! ${data.processed || 0} comics processed.`;
          migrationStatus.className = 'text-xs mt-3 text-center text-green-400';
        }
        initialMetadataStorage = mode; // Update initial value

        // Hide migration options after success
        setTimeout(() => {
          if (migrationOptions) migrationOptions.classList.add('hidden');
        }, 3000);

      } catch (error) {
        console.error('Migration error:', error);
        if (migrationStatus) {
          migrationStatus.textContent = `✗ Error: ${error.message}`;
          migrationStatus.className = 'text-xs mt-3 text-center text-red-400';
        }
      } finally {
        migrateBtn.disabled = false;
        migrateBtn.textContent = 'Migrate Existing Comics Now';
      }
    });
  }

  // Handle Allowed Formats Change
  if (allowedFormatsSelect) {
    allowedFormatsSelect.addEventListener('change', async () => {
      const allowedFormats = allowedFormatsSelect.value;
      const interval = scanIntervalInput ? scanIntervalInput.value : null;
      const apiKey = apiKeyInput ? apiKeyInput.value : null;

      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interval, apiKey, allowedFormats })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred.' }));
          throw new Error(errorData.message);
        }

        console.log(`Allowed formats updated to: ${allowedFormats}`);
        showSettingsMessage('Format preference saved', 'success');
      } catch (error) {
        console.error('Failed to save allowed formats:', error);
        showSettingsMessage(`Error: ${error.message}`, 'error');
      }
    });
  }

  if (!toggleCheckbox) return;

  // Function to update label visual state
  function updateLabels(enabled) {
    if (enabled) {
      // Manga Mode - highlight Manga label
      if (labelStandard) {
        labelStandard.classList.remove('text-white', 'scale-110');
        labelStandard.classList.add('text-gray-500', 'scale-100');
      }
      if (labelManga) {
        labelManga.classList.remove('text-gray-400', 'scale-100');
        labelManga.classList.add('text-purple-300', 'scale-110');
      }
      if (currentValue) {
        currentValue.textContent = 'Manga Reading (Right-to-Left)';
        currentValue.classList.remove('text-gray-300');
        currentValue.classList.add('text-purple-300');
      }
    } else {
      // Standard Mode - highlight Standard label
      if (labelStandard) {
        labelStandard.classList.remove('text-gray-500', 'scale-100');
        labelStandard.classList.add('text-white', 'scale-110');
      }
      if (labelManga) {
        labelManga.classList.remove('text-purple-300', 'scale-110');
        labelManga.classList.add('text-gray-400', 'scale-100');
      }
      if (currentValue) {
        currentValue.textContent = 'Standard Reading (Left-to-Right)';
        currentValue.classList.remove('text-purple-300');
        currentValue.classList.add('text-gray-300');
      }
    }
  }

  try {
    // Load current library-level manga mode preference from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/manga-mode-preference`);
      const data = await response.json();

      if (response.ok && data.ok) {
        // Set toggle based on library-level preference
        const isMangaModeEnabled = data.mangaMode === true;
        toggleCheckbox.checked = isMangaModeEnabled;
        updateLabels(isMangaModeEnabled);
      } else {
        // Fallback to unchecked if we can't load preference
        toggleCheckbox.checked = false;
        updateLabels(false);
      }
    } catch (error) {
      console.error('Failed to load manga mode preference:', error);
      // Fallback to unchecked on error
      toggleCheckbox.checked = false;
      updateLabels(false);
    }

    // Handle checkbox change events
    toggleCheckbox.addEventListener('change', async (e) => {
      const enabled = e.target.checked;

      // Disable toggle during processing
      toggleCheckbox.disabled = true;

      // Show loading indicator
      if (loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
      }

      // Hide any previous status message
      if (statusMessage) {
        statusMessage.classList.add('hidden');
      }

      try {
        // Call API to set manga mode for all libraries
        const response = await fetch(`${API_BASE_URL}/api/v1/comics/set-all-manga-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mangaMode: enabled })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to set manga mode');
        }

        console.log(`Manga mode ${enabled ? 'enabled' : 'disabled'} for all comics. Refreshing library...`);

        // Update label visual state
        updateLabels(enabled);

        // Force refresh from server to get updated manga mode values
        if (typeof fetchLibraryFromServer === 'function') {
          await fetchLibraryFromServer();
        } else if (typeof fetchLibrary === 'function') {
          await fetchLibrary();
        }

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show success message in the tab
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-green-600/20 border-2 border-green-500/50 transition-all duration-300';
          statusMessage.innerHTML = `
            <div class="flex items-center text-green-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium">Success! Manga mode ${enabled ? 'enabled' : 'disabled'} for all comics.</span>
            </div>
            <p class="text-xs text-gray-400 mt-2 ml-7">All manga badges have been updated across your library.</p>
          `;
          statusMessage.classList.remove('hidden');

          // Auto-hide success message after 5 seconds
          setTimeout(() => {
            if (statusMessage) {
              statusMessage.classList.add('hidden');
            }
          }, 5000);
        }

      } catch (error) {
        console.error('Failed to set manga mode:', error);

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show error message in the tab
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-red-600/20 border-2 border-red-500/50 transition-all duration-300';
          statusMessage.innerHTML = `
            <div class="flex items-center text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium">Error: ${error.message}</span>
            </div>
            <p class="text-xs text-gray-400 mt-2 ml-7">Please try again or check your connection.</p>
          `;
          statusMessage.classList.remove('hidden');
        }

        // Revert checkbox on error
        e.target.checked = !enabled;
        updateLabels(!enabled);
      } finally {
        // Re-enable toggle
        toggleCheckbox.disabled = false;
      }
    });

  } catch (error) {
    console.error('Failed to load comics defaults:', error);
  }
}

// --- CONTINUOUS MODE SETTINGS ---
async function loadContinuousModeDefaults() {
  const toggleCheckbox = document.getElementById('continuous-mode-default-toggle');
  const labelPaginated = document.getElementById('continuous-mode-label-paginated');
  const labelContinuous = document.getElementById('continuous-mode-label-continuous');
  const currentValue = document.getElementById('continuous-mode-current-value');
  const loadingIndicator = document.getElementById('continuous-mode-loading');
  const statusMessage = document.getElementById('continuous-mode-status');

  if (!toggleCheckbox) return;

  // Function to update label visual state
  function updateLabels(enabled) {
    if (enabled) {
      // Continuous Mode - highlight Continuous label
      if (labelPaginated) {
        labelPaginated.classList.remove('text-white', 'scale-110');
        labelPaginated.classList.add('text-gray-500', 'scale-100');
      }
      if (labelContinuous) {
        labelContinuous.classList.remove('text-gray-400', 'scale-100');
        labelContinuous.classList.add('text-blue-300', 'scale-110');
      }
      if (currentValue) {
        currentValue.textContent = 'Continuous Scroll View';
        currentValue.classList.remove('text-gray-300');
        currentValue.classList.add('text-blue-300');
      }
    } else {
      // Paginated Mode - highlight Paginated label
      if (labelPaginated) {
        labelPaginated.classList.remove('text-gray-500', 'scale-100');
        labelPaginated.classList.add('text-white', 'scale-110');
      }
      if (labelContinuous) {
        labelContinuous.classList.remove('text-blue-300', 'scale-110');
        labelContinuous.classList.add('text-gray-400', 'scale-100');
      }
      if (currentValue) {
        currentValue.textContent = 'Paginated Reading View';
        currentValue.classList.remove('text-blue-300');
        currentValue.classList.add('text-gray-300');
      }
    }
  }

  try {
    // Load current continuous mode preference from server
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`);
      const data = await response.json();

      if (response.ok) {
        const isContinuousModeEnabled = data.continuousMode === true;
        toggleCheckbox.checked = isContinuousModeEnabled;
        updateLabels(isContinuousModeEnabled);
      } else {
        toggleCheckbox.checked = false;
        updateLabels(false);
      }
    } catch (error) {
      console.error('Failed to load continuous mode preference:', error);
      toggleCheckbox.checked = false;
      updateLabels(false);
    }

    // Handle checkbox change events
    toggleCheckbox.addEventListener('change', async (e) => {
      const enabled = e.target.checked;

      // Disable toggle during processing
      toggleCheckbox.disabled = true;

      // Show loading indicator
      if (loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
      }

      // Hide any previous status message
      if (statusMessage) {
        statusMessage.classList.add('hidden');
      }

      try {
        // Call API to set continuous mode for all comics
        const response = await fetch(`${API_BASE_URL}/api/v1/comics/set-all-continuous-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ continuousMode: enabled })
        });

        if (!response.ok) {
          throw new Error('Failed to set continuous mode');
        }

        console.log(`Continuous mode ${enabled ? 'enabled' : 'disabled'} for all comics. Refreshing library...`);

        // Update label visual state
        updateLabels(enabled);

        // Force refresh from server to get updated values
        if (typeof fetchLibraryFromServer === 'function') {
          await fetchLibraryFromServer();
        } else if (typeof fetchLibrary === 'function') {
          await fetchLibrary();
        }

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show success message in the tab
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-blue-600/20 border-2 border-blue-500/50 transition-all duration-300';
          statusMessage.innerHTML = `
            <div class="flex items-center text-blue-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="font-medium">Success! Continuous mode ${enabled ? 'enabled' : 'disabled'} for all comics.</span>
            </div>
          `;
          statusMessage.classList.remove('hidden');

          // Auto-hide success message after 5 seconds
          setTimeout(() => {
            if (statusMessage) {
              statusMessage.classList.add('hidden');
            }
          }, 5000);
        }

      } catch (error) {
        console.error('Failed to set continuous mode:', error);

        // Hide loading indicator
        if (loadingIndicator) {
          loadingIndicator.classList.add('hidden');
        }

        // Show error message
        if (statusMessage) {
          statusMessage.className = 'mt-4 rounded-lg p-3 bg-red-600/20 border-2 border-red-500/50 transition-all duration-300';
          statusMessage.innerHTML = `<span class="text-red-400">Error: ${error.message}</span>`;
          statusMessage.classList.remove('hidden');
        }

        // Revert checkbox on error
        e.target.checked = !enabled;
        updateLabels(!enabled);
      } finally {
        // Re-enable toggle
        toggleCheckbox.disabled = false;
      }
    });

  } catch (error) {
    console.error('Failed to load continuous mode defaults:', error);
  }
}

// Setup continuous mode toggle event listener
function initContinuousModeSettings() {
  loadContinuousModeDefaults();
}

// Helper function to show settings messages
function showSettingsMessage(message, type) {
  const statusDiv = document.getElementById('settings-status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = type === 'success' ? 'text-green-400' : 'text-red-400';
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 3000);
  }
}


