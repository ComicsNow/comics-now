// --- SETTINGS & LOGS ---
function openSettingsModal() {
  settingsModal.classList.remove('hidden');
  fetchSettings();
  if (settingsTabDevices && settingsTabDevices.classList.contains('active')) {
    refreshDeviceList();
  }
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
  if (logInterval) clearInterval(logInterval);
}

async function fetchSettings() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/settings`);
    const data = await response.json();
    scanIntervalInput.value = data.scanInterval || 5;

    // Handle API key display
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
  } catch (error) {
    settingsStatusDiv.textContent = 'Failed to load settings.';
  }
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingsStatusDiv.textContent = 'Saving...';

  const interval = scanIntervalInput.value;
  const apiKey = apiKeyInput.value;

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval, apiKey })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: 'An unknown error occurred.' }));
      throw new Error(errorData.message);
    }

    settingsStatusDiv.textContent = 'Settings saved!';
    setTimeout(() => {
      settingsStatusDiv.textContent = '';
      closeSettingsModal();
      fetchLibrary(); // Refresh library after saving settings
    }, 1500);
  } catch (error) {
    settingsStatusDiv.textContent = `Error: ${error.message}`;
  }
});

scanButton.addEventListener('click', async () => {
  scanButton.textContent = 'Scanning...';
  scanButton.disabled = true;
  try {
    await triggerScan();
    settingsStatusDiv.textContent = 'Scan initiated successfully.';
  } catch (e) {
    settingsStatusDiv.textContent = 'Failed to start scan.';
  } finally {
    setTimeout(async () => {
      scanButton.textContent = 'Scan Now';
      scanButton.disabled = false;
      settingsStatusDiv.textContent = '';
      await fetchLibrary();
    }, 3000);
  }
});

fullScanButton.addEventListener('click', async () => {
  fullScanButton.textContent = 'Scanning...';
  fullScanButton.disabled = true;
  try {
    await triggerScan(null, true);
    settingsStatusDiv.textContent = 'Full scan initiated successfully.';
  } catch (e) {
    settingsStatusDiv.textContent = 'Failed to start full scan.';
  } finally {
    setTimeout(async () => {
      fullScanButton.textContent = 'Full Scan';
      fullScanButton.disabled = false;
      settingsStatusDiv.textContent = '';
      await fetchLibrary();
    }, 3000);
  }
});

async function fetchLogs() {
  const level = document.getElementById('log-level-filter').value;
  const category = document.getElementById('log-category-filter').value;
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
      <div class="bg-gray-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="space-y-1 text-sm">
          <div class="text-white font-semibold text-base flex flex-wrap items-center gap-2">
            <span>${displayName}</span>
            ${currentBadge}
          </div>
          <div class="text-gray-300 break-all">ID: ${deviceId}</div>
          <div class="text-gray-400">Last seen: ${lastSeen}</div>
          <div class="text-gray-400">Registered: ${created}</div>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto">
          <button
            class="device-remove-btn bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-full transition-colors"
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
      <div class="border border-gray-700 rounded-lg p-4 bg-gray-900 hover:bg-gray-800 cursor-pointer transition-colors user-card" data-user-id="${escapeHtml(user.userId)}" data-user-email="${escapeHtml(user.email)}" data-user-role="${escapeHtml(user.role)}">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-white font-semibold">${escapeHtml(user.email)}</span>
              <span class="px-2 py-0.5 text-xs rounded-full ${user.role === 'admin' ? 'bg-purple-600' : 'bg-gray-600'} text-white">
                ${escapeHtml(user.role)}
              </span>
            </div>
            <div class="text-sm text-gray-400 space-y-1">
              <div>
                <span class="text-gray-500">Registered:</span>
                <span>${formatTimestamp(user.created)}</span>
              </div>
              <div>
                <span class="text-gray-500">Last seen:</span>
                <span>${formatTimestamp(user.lastSeen)}</span>
              </div>
              <div class="text-xs text-gray-600">
                User ID: ${escapeHtml(user.userId)}
              </div>
            </div>
          </div>
          ${user.role !== 'admin' ? '<div class="text-gray-500 text-sm">Click to manage library access →</div>' : '<div class="text-gray-500 text-sm">Full access (Admin)</div>'}
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
  accessView.className = 'space-y-4';
  accessView.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <div>
        <button id="back-to-users-btn" class="text-gray-400 hover:text-white transition-colors mb-2">
          ← Back to Users
        </button>
        <h3 class="text-lg font-semibold text-white">Library Access for ${escapeHtml(userEmail)}</h3>
        <p class="text-sm text-gray-400 mb-3">Select which libraries, publishers, series, and comics this user can access</p>

        <!-- Collapsible Guide -->
        <button id="access-guide-toggle" class="comic-summary-toggle" aria-expanded="false">
          How to Use Library Access
        </button>
        <div id="access-guide-content" class="comic-summary-content hidden">
          <h5 class="font-semibold text-white mb-2">Understanding Library Access Control</h5>
          <p class="mb-3">This hierarchical access system allows you to control what content users can see:</p>

          <div class="space-y-3">
            <div>
              <h6 class="font-semibold text-purple-400 text-sm mb-1">📚 Library Level (Root Folders)</h6>
              <p class="text-sm">Grant or deny access to entire root library folders. All content within that folder will be affected.</p>
            </div>

            <div>
              <h6 class="font-semibold text-green-400 text-sm mb-1">🏢 Publisher Level</h6>
              <p class="text-sm">Control access to all comics from a specific publisher within an accessible library.</p>
            </div>

            <div>
              <h6 class="font-semibold text-blue-400 text-sm mb-1">📖 Series Level</h6>
              <p class="text-sm">Fine-tune access to specific series within accessible publishers.</p>
            </div>

            <div>
              <h6 class="font-semibold text-yellow-400 text-sm mb-1">📕 Comic Level</h6>
              <p class="text-sm">Grant or revoke access to individual comic books.</p>
            </div>
          </div>

          <div class="mt-4 p-3 bg-purple-900/20 border border-purple-700/50 rounded-lg">
            <h6 class="font-semibold text-white text-sm mb-2">💡 How the Checkboxes Work:</h6>
            <ul class="text-sm space-y-1 list-disc list-inside">
              <li><strong>D (Direct):</strong> User has access to <em>this specific item only</em>, not its children</li>
              <li><strong>R (Recursive):</strong> UI helper to select/deselect <em>all siblings</em> at this level (not saved)</li>
              <li><strong>C (Child):</strong> User has access to <em>all descendants</em> of this item</li>
            </ul>
          </div>

          <div class="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
            <h6 class="font-semibold text-white text-sm mb-2">🔍 Tips:</h6>
            <ul class="text-sm space-y-1 list-disc list-inside">
              <li>Use <strong>D</strong> for specific folder/publisher/series access without giving access to children</li>
              <li>Use <strong>C</strong> to give access to all items within a folder/publisher/series</li>
              <li>Use <strong>R</strong> as a shortcut to check/uncheck all <strong>D</strong> checkboxes at the same level</li>
              <li>Checking <strong>C</strong> automatically checks <strong>D</strong> for that item</li>
              <li>Use "Select All" / "Deselect All" buttons for bulk changes</li>
              <li>Click "Save Access" when done to apply changes</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div id="access-status" class="text-sm text-gray-400"></div>

    <div class="bg-gray-800 rounded-lg p-4">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-semibold text-white">Library Access</h4>
        <div class="flex gap-2">
          <button id="select-all-btn" class="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors">
            Select All
          </button>
          <button id="deselect-all-btn" class="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors">
            Deselect All
          </button>
        </div>
      </div>

      <div id="access-tree-container" class="space-y-2 max-h-96 overflow-y-auto">
        <div class="text-center text-gray-400 py-4">Loading library structure...</div>
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <button id="cancel-access-btn" class="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-full transition-colors">
        Cancel
      </button>
      <button id="save-access-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-full transition-colors">
        Save Access
      </button>
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
  function startRenameStream() {
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
  }

  // Setup move output streaming
  function startMoveStream() {
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
  }

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

  // Start streams when management tab is opened
  const settingsTabManagement = document.getElementById('settings-tab-comics-management');
  if (settingsTabManagement) {
    settingsTabManagement.addEventListener('click', () => {
      startRenameStream();
      startMoveStream();
    });
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
  const labelStandard = document.getElementById('manga-mode-label-standard');
  const labelManga = document.getElementById('manga-mode-label-manga');
  const currentValue = document.getElementById('manga-mode-current-value');
  const loadingIndicator = document.getElementById('manga-mode-loading');
  const statusMessage = document.getElementById('manga-mode-status');

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
// Load user's default continuous mode preference
async function loadContinuousModeDefault() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`);
    const data = await response.json();
    const toggle = document.getElementById('continuous-mode-default-toggle');
    if (toggle) {
      toggle.checked = data.continuousMode || false;
    }
  } catch (error) {
    console.error('Failed to load continuous mode default:', error);
  }
}

// Save user's default continuous mode preference
async function saveContinuousModeDefault(enabled) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/continuous-mode-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continuousMode: enabled })
    });

    if (!response.ok) {
      throw new Error('Failed to save preference');
    }

    showSettingsMessage('Continuous mode default updated', 'success');
  } catch (error) {
    console.error('Failed to save continuous mode default:', error);
    showSettingsMessage('Failed to update continuous mode default', 'error');
  }
}

// Setup continuous mode toggle event listener
function initContinuousModeSettings() {
  const continuousModeToggle = document.getElementById('continuous-mode-default-toggle');
  if (continuousModeToggle) {
    continuousModeToggle.addEventListener('change', (e) => {
      saveContinuousModeDefault(e.target.checked);
    });

    // Load current setting
    loadContinuousModeDefault();
  }
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


