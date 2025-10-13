// --- SYNC FUNCTIONALITY ---

class SyncManager {
  constructor() {
    this.deviceId = null;
    this.deviceName = null;
    this.pollInterval = null;
    this.currentComicId = null;
    this.lastKnownPage = 0;
    this.lastKnownTimestamp = 0;
    this.isPolling = false;
    this.ignoredSyncPoints = this.loadIgnoredSyncPoints();
    // User context
    this.userId = null;
    this.userEmail = null;
    this.userRole = null;
    this.authEnabled = false;
  }

  // Load ignored sync points from localStorage
  loadIgnoredSyncPoints() {
    try {
      const stored = localStorage.getItem('comicsNow_ignoredSyncPoints');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      return {};
    }
  }

  // Save ignored sync points to localStorage
  saveIgnoredSyncPoints() {
    try {
      localStorage.setItem('comicsNow_ignoredSyncPoints', JSON.stringify(this.ignoredSyncPoints));
    } catch (error) {
      // Failed to save ignored sync points
    }
  }

  // Mark a sync point as ignored for a specific comic
  markSyncPointAsIgnored(comicId, timestamp, page, deviceId) {
    if (!comicId) return;

    this.ignoredSyncPoints[comicId] = {
      timestamp: timestamp,
      page: page,
      deviceId: deviceId,
      ignoredAt: Date.now()
    };
    this.saveIgnoredSyncPoints();
    debugLog('SYNC', `Marked sync point as ignored for comic ${comicId}:`, this.ignoredSyncPoints[comicId]);
  }

  // Clear ignored sync point for a comic (when user creates new progress)
  clearIgnoredSyncPoint(comicId) {
    if (!comicId) return;

    if (this.ignoredSyncPoints[comicId]) {
      delete this.ignoredSyncPoints[comicId];
      this.saveIgnoredSyncPoints();
      debugLog('SYNC', `Cleared ignored sync point for comic ${comicId}`);
    }
  }

  // Check if a sync point has already been ignored
  isSyncPointIgnored(comicId, timestamp, page, deviceId) {
    const ignored = this.ignoredSyncPoints[comicId];
    if (!ignored) return false;

    // Check if this is the same sync point that was ignored
    const isSameSync = ignored.timestamp === timestamp &&
                       ignored.page === page &&
                       ignored.deviceId === deviceId;

    if (isSameSync) {
      debugLog('SYNC', `Sync point already ignored for comic ${comicId}`);
      return true;
    }

    // If it's a different sync point, clear the old ignored state
    this.clearIgnoredSyncPoint(comicId);
    return false;
  }

  // Initialize sync manager with user context
  async initialize() {
    try {
      // Fetch current user info
      const userResponse = await fetch(`${API_BASE_URL}/api/v1/user/me`);
      if (userResponse.ok) {
        const userData = await userResponse.json();
        this.userId = userData.userId;
        this.userEmail = userData.email;
        this.userRole = userData.role;
        this.authEnabled = userData.authEnabled;
        debugLog('SYNC', 'User context loaded:', { userId: this.userId, email: this.userEmail, role: this.userRole, authEnabled: this.authEnabled });
      }
    } catch (error) {
      // Continue with defaults - auth is likely disabled
    }

    // Initialize device after user context is loaded
    await this.initializeDevice();
  }

  // Generate device fingerprint
  generateFingerprint() {
    try {
      let canvasData = '';
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillText('Device fingerprint', 2, 2);
          canvasData = canvas.toDataURL();
        }
      } catch (canvasError) {
        // Canvas may be blocked on some mobile browsers
      }

      const fingerprint = [
        navigator.userAgent || '',
        navigator.language || '',
        screen.width + 'x' + screen.height,
        screen.colorDepth || '',
        new Date().getTimezoneOffset(),
        !!window.sessionStorage,
        !!window.localStorage,
        canvasData,
        // Add additional mobile-friendly identifiers
        navigator.platform || '',
        navigator.maxTouchPoints || 0
      ].join('|');

      return btoa(fingerprint).substring(0, 32);
    } catch (error) {
      // Fallback to a basic fingerprint
      const basicFingerprint = [
        navigator.userAgent || 'unknown',
        Date.now(),
        Math.random()
      ].join('|');
      return btoa(basicFingerprint).substring(0, 32);
    }
  }

  // Initialize device and get/create device ID
  async initializeDevice() {
    try {
      // Check if device is already registered in localStorage
      const savedDeviceId = localStorage.getItem('comicsNow_deviceId');
      const savedDeviceName = localStorage.getItem('comicsNow_deviceName');

      if (savedDeviceId && savedDeviceName) {
        // Verify the device still exists on the server
        try {
          const verifyResponse = await fetch(`${API_BASE_URL}/api/v1/devices`);
          if (verifyResponse.ok) {
            const devicesData = await verifyResponse.json();
            const deviceExists = devicesData.devices?.some(d => d.deviceId === savedDeviceId);

            if (deviceExists) {
              // Device still exists on server, use cached ID
              this.deviceId = savedDeviceId;
              this.deviceName = savedDeviceName;
              return { deviceId: this.deviceId, deviceName: this.deviceName };
            } else {
              // Device was deleted from server, clear cache and re-register
              localStorage.removeItem('comicsNow_deviceId');
              localStorage.removeItem('comicsNow_deviceName');
            }
          }
        } catch (verifyError) {
          // If verification fails, assume cached device is valid (offline scenario)
          this.deviceId = savedDeviceId;
          this.deviceName = savedDeviceName;
          return { deviceId: this.deviceId, deviceName: this.deviceName };
        }
      }

      // Generate automatic device name
      const deviceName = this.generateAutoDeviceName();

      // Register new device
      const fingerprint = this.generateFingerprint();
      const response = await fetch(`${API_BASE_URL}/api/v1/device/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName: deviceName,
          fingerprint,
          userAgent: navigator.userAgent
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to register device');
      }

      // Save device info
      this.deviceId = data.deviceId;
      this.deviceName = data.deviceName;
      localStorage.setItem('comicsNow_deviceId', this.deviceId);
      localStorage.setItem('comicsNow_deviceName', this.deviceName);

      debugLog('SYNC', `Device auto-registered: ${this.deviceName} (${this.deviceId})`);
      return data;

    } catch (error) {
      throw error;
    }
  }

  generateAutoDeviceName() {
    const deviceInfo = this.getDeviceInfo();
    const browserInfo = this.getBrowserInfo();

    // Create a more descriptive device name
    const deviceName = deviceInfo.name || 'Unknown Device';
    const browser = browserInfo.name;
    const os = deviceInfo.os || 'Unknown OS';

    // Format: "Device OS - Browser" or just "OS - Browser" for desktops
    if (deviceInfo.type === 'mobile' || deviceInfo.type === 'tablet') {
      return `${deviceName} (${os}) - ${browser}`;
    } else {
      return `${os} - ${browser}`;
    }
  }

  getDeviceInfo() {
    const userAgent = navigator.userAgent;
    const platform = navigator.platform || '';

    // Mobile devices
    if (/iPhone/.test(userAgent)) {
      return { name: 'iPhone', os: 'iOS', type: 'mobile' };
    }
    if (/iPad/.test(userAgent)) {
      return { name: 'iPad', os: 'iPadOS', type: 'tablet' };
    }
    if (/Android/.test(userAgent)) {
      const isTablet = /Tablet|tablet/.test(userAgent) || (screen.width >= 768 && screen.height >= 1024);
      return {
        name: isTablet ? 'Android Tablet' : 'Android Phone',
        os: 'Android',
        type: isTablet ? 'tablet' : 'mobile'
      };
    }

    // Desktop OS detection
    if (platform.includes('Win') || userAgent.includes('Windows')) {
      return { name: 'PC', os: 'Windows', type: 'desktop' };
    }
    if (platform.includes('Mac') || userAgent.includes('Macintosh')) {
      return { name: 'Mac', os: 'macOS', type: 'desktop' };
    }
    if (platform.includes('Linux') || userAgent.includes('Linux')) {
      return { name: 'PC', os: 'Linux', type: 'desktop' };
    }

    return { name: platform || 'Unknown Device', os: 'Unknown OS', type: 'unknown' };
  }

  getBrowserInfo() {
    const userAgent = navigator.userAgent;

    // More specific browser detection
    if (userAgent.includes('Edg/')) return { name: 'Edge' };
    if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) return { name: 'Chrome' };
    if (userAgent.includes('Firefox/')) return { name: 'Firefox' };
    if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return { name: 'Safari' };
    if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) return { name: 'Opera' };

    return { name: 'Browser' };
  }

  generateDefaultDeviceName() {
    // Keep this for backward compatibility
    return this.generateAutoDeviceName();
  }

  // Check for sync conflicts when opening a comic
  async checkSyncStatus(comicId, currentPage = 0) {
    if (!this.deviceId) {
      await this.initializeDevice();
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/sync/check/${comicId}?deviceId=${this.deviceId}&lastKnownPage=${currentPage}&lastKnownTimestamp=${this.lastKnownTimestamp}`
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Sync check failed');
      }

      this.currentComicId = comicId;
      this.lastKnownPage = currentPage;
      this.lastKnownTimestamp = data.lastSyncTimestamp || 0;

      if (data.hasNewerSync && data.isFromDifferentDevice) {
        // Check if this sync point has already been ignored
        const isIgnored = this.isSyncPointIgnored(
          comicId,
          data.lastSyncTimestamp,
          data.lastReadPage,
          data.lastSyncDeviceId
        );

        if (isIgnored) {
          debugLog('SYNC', `Skipping sync prompt - sync point already ignored for comic ${comicId}`);
          return { shouldSync: false, data };
        }

        // Show device selection dialog
        return this.showDeviceSelectionDialog(comicId, currentPage, data);
      }

      return { shouldSync: false, data };

    } catch (error) {
      return { shouldSync: false, error: error.message };
    }
  }

  // Show device selection dialog to user
  async showDeviceSelectionDialog(comicId, currentPage, syncData) {
    try {
      // Fetch all devices that have read this comic
      const response = await fetch(
        `${API_BASE_URL}/api/v1/sync/devices/${comicId}?currentDeviceId=${this.deviceId}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch device sync data');
      }

      const data = await response.json();

      return new Promise((resolve) => {
        const modal = this.createDeviceSelectionModal(data, currentPage, syncData, resolve);
        document.body.appendChild(modal);
      });
    } catch (error) {
      return { shouldSync: false, error: error.message };
    }
  }

  // Show sync dialog to user (kept for backward compatibility)
  async showSyncDialog(syncData) {
    return new Promise((resolve) => {
      const modal = this.createSyncModal(syncData, resolve);
      document.body.appendChild(modal);
    });
  }

  createSyncModal(syncData, resolve) {
    const { serverProgress, clientProgress } = syncData;
    const serverDate = new Date(serverProgress.lastSyncTimestamp).toLocaleString();

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center';
    modal.style.zIndex = '10000';

    modal.innerHTML = `
      <div class="bg-gray-800 rounded-lg p-6 w-96 max-w-lg mx-4 shadow-2xl border border-gray-700">
        <div class="flex items-center mb-4">
          <svg class="w-6 h-6 text-blue-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
          </svg>
          <h3 class="text-xl font-bold text-white">Sync Available</h3>
        </div>

        <div class="mb-6">
          <p class="text-gray-300 mb-4">This comic was read on another device:</p>
          <div class="bg-gray-700 p-4 rounded-lg mb-4">
            <div class="text-sm text-gray-400 mb-2">Last read on:</div>
            <div class="text-white font-medium">${serverProgress.lastSyncDeviceName || 'Unknown Device'}</div>
            <div class="text-gray-400 text-sm">${serverDate}</div>
          </div>

          <div class="grid grid-cols-2 gap-4 text-sm">
            <div class="bg-gray-700 p-3 rounded">
              <div class="text-gray-400 mb-1">Other Device</div>
              <div class="text-white font-medium">Page ${serverProgress.lastReadPage} of ${serverProgress.totalPages}</div>
            </div>
            <div class="bg-gray-700 p-3 rounded">
              <div class="text-gray-400 mb-1">This Device</div>
              <div class="text-white font-medium">Page ${clientProgress.lastReadPage} of ${serverProgress.totalPages}</div>
            </div>
          </div>
        </div>

        <div class="flex justify-end space-x-3">
          <button id="sync-keep-current" class="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-full transition-colors">
            Keep Current
          </button>
          <button id="sync-accept" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full transition-colors">
            Sync to Page ${serverProgress.lastReadPage}
          </button>
        </div>
      </div>
    `;

    // Handle button clicks
    modal.querySelector('#sync-accept').addEventListener('click', async () => {
      document.body.removeChild(modal);

      // Navigate to the synced page and update local state
      if (typeof window.currentComic !== 'undefined' && window.currentComic) {
        window.currentPageIndex = serverProgress.lastReadPage;

        // Update the current comic's progress
        if (!window.currentComic.progress) {
          window.currentComic.progress = {};
        }
        window.currentComic.progress.lastReadPage = serverProgress.lastReadPage;

        // Re-render the page to show the synced position
        if (typeof window.renderPage === 'function') {
          await window.renderPage();
        }

        // Update local library data
        if (typeof window.updateLibraryProgress === 'function') {
          window.updateLibraryProgress(
            window.currentComic.id,
            serverProgress.lastReadPage,
            serverProgress.totalPages
          );
        }
      }

      resolve({
        shouldSync: true,
        syncToPage: serverProgress.lastReadPage,
        timestamp: serverProgress.lastSyncTimestamp
      });
    });

    modal.querySelector('#sync-keep-current').addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve({ shouldSync: false });
    });

    return modal;
  }

  createDeviceSelectionModal(data, currentPage, syncData, resolve) {
    const { comic, devices } = data;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center';
    modal.style.zIndex = '10000';

    // Create device list HTML
    const deviceListHtml = devices.map(device => {
      const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never';
      const progress = device.lastReadPage !== null ? device.lastReadPage : 'No progress';
      const isOtherDevice = !device.isCurrentDevice;

      return `
        <div class="bg-gray-700 p-4 rounded-lg mb-3 ${isOtherDevice ? 'cursor-pointer hover:bg-gray-600 transition-colors' : 'opacity-75'}"
             data-device-id="${device.deviceId}"
             data-page="${device.lastReadPage || 0}"
             data-timestamp="${device.lastSyncTimestamp || 0}"
             ${isOtherDevice ? 'data-selectable="true"' : ''}>
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <div class="text-white font-medium">${device.deviceName || 'Unnamed Device'}</div>
              <div class="text-gray-400 text-sm">Last seen: ${lastSeen}</div>
              ${device.isCurrentDevice ? '<div class="text-blue-400 text-sm font-medium">This Device</div>' : ''}
            </div>
            <div class="text-right">
              <div class="text-white font-medium">Page ${progress}</div>
              <div class="text-gray-400 text-sm">of ${comic.totalPages}</div>
            </div>
          </div>
          ${isOtherDevice && device.lastReadPage !== null ?
            `<div class="mt-2 text-center">
              <span class="text-blue-400 text-sm">Click to sync to this progress</span>
            </div>` :
            ''}
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="bg-gray-800 rounded-lg p-6 w-[500px] max-w-[90vw] mx-4 shadow-2xl border border-gray-700">
        <div class="flex items-center mb-4">
          <svg class="w-6 h-6 text-blue-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path>
          </svg>
          <h3 class="text-xl font-bold text-white">Sync Reading Progress</h3>
        </div>

        <div class="mb-6">
          <p class="text-gray-300 mb-4">This comic has been read on another device. Choose a device to sync with or continue with your current progress:</p>
          <div class="max-h-64 overflow-y-auto">
            ${deviceListHtml}
          </div>
          ${devices.filter(d => !d.isCurrentDevice && d.lastReadPage !== null).length === 0 ?
            '<p class="text-gray-400 text-center py-4">No other devices have read this comic.</p>' :
            ''}
        </div>

        <div class="flex justify-between items-center">
          <button id="sync-ignore" class="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-full transition-colors">
            Keep Current Progress
          </button>
          <button id="sync-cancel" class="bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 px-4 rounded-full transition-colors">
            Cancel
          </button>
        </div>
      </div>
    `;

    // Handle device selection clicks
    modal.querySelectorAll('[data-selectable="true"]').forEach(deviceElement => {
      deviceElement.addEventListener('click', async () => {
        const deviceId = deviceElement.getAttribute('data-device-id');
        const syncToPage = parseInt(deviceElement.getAttribute('data-page'), 10);
        const timestamp = parseInt(deviceElement.getAttribute('data-timestamp'), 10);

        document.body.removeChild(modal);

        // Clear any ignored sync point since user is actively syncing
        this.clearIgnoredSyncPoint(comic.id);

        // Navigate to the synced page and update local state
        if (typeof window.currentComic !== 'undefined' && window.currentComic) {
          window.currentPageIndex = syncToPage;

          // Update the current comic's progress
          if (!window.currentComic.progress) {
            window.currentComic.progress = {};
          }
          window.currentComic.progress.lastReadPage = syncToPage;

          // Re-render the page to show the synced position
          if (typeof window.renderPage === 'function') {
            await window.renderPage();
          }

          // Update local library data
          if (typeof window.updateLibraryProgress === 'function') {
            window.updateLibraryProgress(
              window.currentComic.id,
              syncToPage,
              comic.totalPages
            );
          }

          // Update sync timestamp on server
          try {
            await this.updateProgress(window.currentComic.id, syncToPage);
          } catch (error) {
            // Failed to update sync progress
          }
        }

        resolve({
          shouldSync: true,
          syncToPage: syncToPage,
          deviceId: deviceId
        });
      });
    });

    // Handle "Keep Current Progress" (ignore) button
    const ignoreBtn = modal.querySelector('#sync-ignore');
    if (ignoreBtn) {
      ignoreBtn.addEventListener('click', () => {
        // Mark this sync point as ignored so we don't show the prompt again
        // until a new sync point is created on another device
        if (syncData) {
          this.markSyncPointAsIgnored(
            comic.id,
            syncData.lastSyncTimestamp,
            syncData.lastReadPage,
            syncData.lastSyncDeviceId
          );
        }

        document.body.removeChild(modal);
        resolve({ shouldSync: false, ignored: true });
      });
    }

    // Handle cancel button
    modal.querySelector('#sync-cancel').addEventListener('click', () => {
      document.body.removeChild(modal);
      resolve({ shouldSync: false });
    });

    return modal;
  }

  // Update reading progress for this device
  async updateProgress(comicId, page) {
    if (!this.deviceId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sync/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comicId,
          lastReadPage: page,
          deviceId: this.deviceId,
          deviceName: this.deviceName
        })
      });

      const data = await response.json();
      if (response.ok) {
        this.lastKnownPage = page;
        this.lastKnownTimestamp = data.lastSyncTimestamp;

        // Clear any ignored sync point since user is making progress on this device
        // This ensures they'll see the prompt if another device creates new progress
        this.clearIgnoredSyncPoint(comicId);

        // Update local library data and lazy loading counts
        if (typeof updateLocalProgressAndCounts === 'function') {
          updateLocalProgressAndCounts(comicId, page);
        }

        // Update library object in memory if it exists
        if (typeof library !== 'undefined' && typeof updateLibraryProgress === 'function') {
          updateLibraryProgress(comicId, page);
        }

        // Update library cache in IndexedDB so refresh shows correct progress immediately
        if (typeof saveLibraryCacheToDB === 'function' && typeof library !== 'undefined') {
          saveLibraryCacheToDB(library).catch(() => {
            // Failed to update library cache
          });
        }
      }

    } catch (error) {
      // Failed to update progress
    }
  }

  // Start polling for changes while reading
  startPolling(comic) {
    if (this.isPolling || !this.deviceId) return;

    const comicId = typeof comic === 'object' ? comic.id : comic;
    if (!comicId) return;

    this.isPolling = true;
    this.currentComicId = comicId;

    this.pollInterval = setInterval(async () => {
      try {
        const result = await this.checkSyncStatus(comicId, this.lastKnownPage);
        if (result.shouldSync) {
          // Show non-intrusive notification
          this.showSyncNotification(result.data);
        }
      } catch (error) {
        // Polling error
      }
    }, 5 * 60 * 1000); // Poll every 5 minutes
  }

  // Stop polling
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    this.currentComicId = null;
  }

  clearStoredDevice() {
    try {
      localStorage.removeItem('comicsNow_deviceId');
      localStorage.removeItem('comicsNow_deviceName');
    } catch (error) {
      // Failed to clear stored device info
    }

    this.stopPolling();
    this.deviceId = null;
    this.deviceName = null;
    this.lastKnownPage = 0;
    this.lastKnownTimestamp = 0;
  }

  // Show non-intrusive sync notification
  showSyncNotification(syncData) {
    // Remove any existing notification
    const existing = document.getElementById('sync-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'sync-notification';
    notification.className = 'fixed top-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-sm';
    notification.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Sync Available</div>
          <div class="text-sm opacity-90">Updated on ${syncData.serverProgress?.lastSyncDeviceName || 'Another Device'}</div>
        </div>
        <button id="sync-notification-close" class="ml-4 text-white hover:text-gray-200">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="mt-2 flex space-x-2">
        <button id="sync-notification-accept" class="bg-blue-700 hover:bg-blue-800 px-3 py-1 rounded text-sm">
          Sync Now
        </button>
        <button id="sync-notification-dismiss" class="bg-gray-500 hover:bg-gray-600 px-3 py-1 rounded text-sm">
          Dismiss
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (document.getElementById('sync-notification')) {
        notification.remove();
      }
    }, 10000);

    // Handle button clicks
    notification.querySelector('#sync-notification-close').addEventListener('click', () => {
      notification.remove();
    });

    notification.querySelector('#sync-notification-dismiss').addEventListener('click', () => {
      notification.remove();
    });

    notification.querySelector('#sync-notification-accept').addEventListener('click', () => {
      notification.remove();
      this.showSyncDialog(syncData);
    });
  }
}

// Global sync manager instance
window.syncManager = new SyncManager();

// Update local library data and lazy loading counts when progress changes
function updateLocalProgressAndCounts(comicId, page) {
  if (!library) return;

  // Find the comic in the library and update its progress
  let comic = null;
  let rootFolder = null;
  let publisher = null;
  let seriesName = null;
  let oldStatus = null;
  let newStatus = null;

  // Find the comic in the library structure
  for (const rootFolderKey of Object.keys(library)) {
    for (const publisherKey of Object.keys(library[rootFolderKey].publishers || {})) {
      for (const seriesKey of Object.keys(library[rootFolderKey].publishers[publisherKey].series || {})) {
        const seriesData = library[rootFolderKey].publishers[publisherKey].series[seriesKey];

        if (Array.isArray(seriesData)) {
          // Full data format
          const foundComic = seriesData.find(c => c.id === comicId);
          if (foundComic) {
            comic = foundComic;
            rootFolder = rootFolderKey;
            publisher = publisherKey;
            seriesName = seriesKey;
            break;
          }
        }
      }
      if (comic) break;
    }
    if (comic) break;
  }

  if (comic && comic.progress) {
    // Calculate old and new status
    oldStatus = getComicStatus(comic);

    // Update the comic's progress
    comic.progress.lastReadPage = page;

    // Calculate new status
    newStatus = getComicStatus(comic);

    // Update lazy loading counts if status changed
    if (oldStatus !== newStatus && library._isLazyLoaded && rootFolder && publisher && seriesName) {
      const seriesData = library[rootFolder]?.publishers?.[publisher]?.series?.[seriesName];
      const publisherData = library[rootFolder]?.publishers?.[publisher];

      if (seriesData && seriesData._counts) {
        // Update series counts
        if (oldStatus && seriesData._counts[oldStatus] > 0) {
          seriesData._counts[oldStatus]--;
        }
        if (newStatus) {
          seriesData._counts[newStatus]++;
        }

        // Update publisher counts
        if (publisherData && publisherData._counts) {
          if (oldStatus && publisherData._counts[oldStatus] > 0) {
            publisherData._counts[oldStatus]--;
          }
          if (newStatus) {
            publisherData._counts[newStatus]++;
          }
        }

        debugLog('SYNC', `Updated counts: ${oldStatus} -> ${newStatus} for ${seriesName}`);
      }
    }
  }
}

// Initialize sync manager on page load (non-blocking)
document.addEventListener('DOMContentLoaded', () => {
  // Use setTimeout to defer initialization until after UI is rendered
  setTimeout(async () => {
    try {
      await window.syncManager.initialize();
      debugLog('SYNC', 'Sync manager initialization completed in background');

      // Show user badge if auth is enabled
      if (typeof showUserBadge === 'function') {
        showUserBadge();
      }

      // Hide admin UI for non-admin users
      if (typeof hideAdminUI === 'function') {
        hideAdminUI();
      }
    } catch (error) {
      // Don't throw - allow app to continue working without sync
    }
  }, 100); // Small delay to allow UI to render first
});