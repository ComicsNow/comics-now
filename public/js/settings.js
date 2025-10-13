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
      <div class="border border-gray-700 rounded-lg p-4 bg-gray-900">
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
        </div>
      </div>
    `).join('');

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


