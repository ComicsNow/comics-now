/**
 * Comics Now! - Sync Modals & Notification Banners
 *
 * Visual prompt dialogs for conflicting progress resolution and device selection.
 */

import { escapeHtml } from '../globals.js';

export function createSyncModal(syncData, resolve, onAccept) {
  const { serverProgress, clientProgress } = syncData;
  const serverDate = new Date(serverProgress.lastSyncTimestamp).toLocaleString();

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-gray-900/75 flex items-center justify-center';
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
          <div class="text-white font-medium">${escapeHtml(serverProgress.lastSyncDeviceName || 'Unknown Device')}</div>
          <div class="text-gray-400 text-sm">${escapeHtml(serverDate)}</div>
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

  modal.querySelector('#sync-accept').addEventListener('click', async () => {
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    if (typeof onAccept === 'function') {
      await onAccept(serverProgress);
    }
    resolve({
      shouldSync: true,
      syncToPage: serverProgress.lastReadPage,
      timestamp: serverProgress.lastSyncTimestamp
    });
  });

  modal.querySelector('#sync-keep-current').addEventListener('click', () => {
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    resolve({ shouldSync: false });
  });

  return modal;
}

export function createDeviceSelectionModal(data, currentPage, syncData, resolve, onSelect, onIgnore) {
  const { comic, devices } = data;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-gray-900/75 flex items-center justify-center';
  modal.style.zIndex = '10000';

  const deviceListHtml = devices.map(device => {
    const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never';
    const progress = device.lastReadPage !== null ? device.lastReadPage : 'No progress';
    const isOtherDevice = !device.isCurrentDevice;

    return `
      <div class="bg-gray-700 p-4 rounded-lg mb-3 ${isOtherDevice ? 'cursor-pointer hover:bg-gray-600 transition-colors' : 'opacity-75'}"
           data-device-id="${escapeHtml(device.deviceId)}"
           data-page="${device.lastReadPage || 0}"
           data-timestamp="${device.lastSyncTimestamp || 0}"
           ${isOtherDevice ? 'data-selectable="true"' : ''}>
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="text-white font-medium">${escapeHtml(device.deviceName || 'Unnamed Device')}</div>
            <div class="text-gray-400 text-sm">Last seen: ${escapeHtml(lastSeen)}</div>
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

  const otherDevicesWithProgress = devices.filter(d => !d.isCurrentDevice && d.lastReadPage !== null);

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
        ${otherDevicesWithProgress.length === 0 ? '<p class="text-gray-400 text-center py-4">No other devices have read this comic.</p>' : ''}
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

  modal.querySelectorAll('[data-selectable="true"]').forEach(deviceElement => {
    deviceElement.addEventListener('click', async () => {
      const deviceId = deviceElement.getAttribute('data-device-id');
      const syncToPage = parseInt(deviceElement.getAttribute('data-page'), 10);

      if (modal.parentNode) modal.parentNode.removeChild(modal);
      if (typeof onSelect === 'function') {
        await onSelect(comic, syncToPage, deviceId);
      }

      resolve({
        shouldSync: true,
        syncToPage: syncToPage,
        deviceId: deviceId
      });
    });
  });

  const ignoreBtn = modal.querySelector('#sync-ignore');
  if (ignoreBtn) {
    ignoreBtn.addEventListener('click', () => {
      if (typeof onIgnore === 'function') {
        onIgnore(comic.id, syncData);
      }
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      resolve({ shouldSync: false, ignored: true });
    });
  }

  modal.querySelector('#sync-cancel').addEventListener('click', () => {
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    resolve({ shouldSync: false });
  });

  return modal;
}

export function showSyncNotification(syncData, onAccept) {
  const existing = document.getElementById('sync-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.id = 'sync-notification';
  notification.className = 'fixed top-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-sm';
  notification.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <div class="font-medium">Sync Available</div>
        <div class="text-sm opacity-90">Updated on ${escapeHtml(syncData.serverProgress?.lastSyncDeviceName || 'Another Device')}</div>
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

  setTimeout(() => {
    if (document.getElementById('sync-notification')) {
      notification.remove();
    }
  }, 10000);

  notification.querySelector('#sync-notification-close').addEventListener('click', () => {
    notification.remove();
  });

  notification.querySelector('#sync-notification-dismiss').addEventListener('click', () => {
    notification.remove();
  });

  notification.querySelector('#sync-notification-accept').addEventListener('click', () => {
    notification.remove();
    if (typeof onAccept === 'function') {
      onAccept(syncData);
    }
  });
}
