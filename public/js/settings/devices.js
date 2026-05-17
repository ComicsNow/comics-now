// --- DEVICE MANAGEMENT ---
let devicesStatusTimeout = null;



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

  if (refreshDevicesBtn && refreshDevicesBtn.disabled) return;

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