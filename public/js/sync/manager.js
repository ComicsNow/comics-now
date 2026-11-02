/**
 * Comics Now! - Core SyncManager Class
 *
 * Coordinates device state, periodic polling, server sync checks, and progress updating.
 */

import { state, debugLog } from '../globals.js';
import {
  loadIgnoredSyncPoints,
  saveIgnoredSyncPoints,
  markSyncPointAsIgnored,
  clearIgnoredSyncPoint,
  isSyncPointIgnored,
  generateFingerprint,
  getDeviceInfo,
  getBrowserInfo,
  generateAutoDeviceName
} from './device.js';
import { updateLocalProgressAndCounts } from './library-counts.js';
import { createSyncModal, createDeviceSelectionModal, showSyncNotification } from './modals.js';

export class SyncManager {
  constructor() {
    this.deviceId = null;
    this.deviceName = null;
    this.pollInterval = null;
    this.currentComicId = null;
    this.lastKnownPage = 0;
    this.lastKnownTimestamp = 0;
    this.isPolling = false;
    this.ignoredSyncPoints = loadIgnoredSyncPoints();
    this.userId = null;
    this.userEmail = null;
    this.userRole = null;
    this.authEnabled = false;
  }

  loadIgnoredSyncPoints() {
    return loadIgnoredSyncPoints();
  }

  saveIgnoredSyncPoints() {
    saveIgnoredSyncPoints(this.ignoredSyncPoints);
  }

  markSyncPointAsIgnored(comicId, timestamp, page, deviceId) {
    markSyncPointAsIgnored(comicId, timestamp, page, deviceId, this.ignoredSyncPoints);
  }

  clearIgnoredSyncPoint(comicId) {
    clearIgnoredSyncPoint(comicId, this.ignoredSyncPoints);
  }

  isSyncPointIgnored(comicId, timestamp, page, deviceId) {
    return isSyncPointIgnored(comicId, timestamp, page, deviceId, this.ignoredSyncPoints);
  }

  generateFingerprint() {
    return generateFingerprint();
  }

  getDeviceInfo() {
    return getDeviceInfo();
  }

  getBrowserInfo() {
    return getBrowserInfo();
  }

  generateAutoDeviceName() {
    return generateAutoDeviceName();
  }

  generateDefaultDeviceName() {
    return generateAutoDeviceName();
  }

  async initialize() {
    const apiBaseUrl = (state && state.API_BASE_URL) || '';
    try {
      const userResponse = await fetch(`${apiBaseUrl}/api/v1/user/me`);
      if (userResponse.ok) {
        const userData = await userResponse.json();
        this.userId = userData.userId;
        this.userEmail = userData.email;
        this.userRole = userData.role;
        this.authEnabled = userData.authEnabled;
        debugLog('SYNC', 'User context loaded:', { userId: this.userId, email: this.userEmail, role: this.userRole, authEnabled: this.authEnabled });
      }
    } catch (_) {}

    await this.initializeDevice();
  }

  async initializeDevice() {
    const apiBaseUrl = (state && state.API_BASE_URL) || '';
    const savedDeviceId = localStorage.getItem('comicsNow_deviceId');
    const savedDeviceName = localStorage.getItem('comicsNow_deviceName');

    if (savedDeviceId && savedDeviceName) {
      try {
        const verifyResponse = await fetch(`${apiBaseUrl}/api/v1/devices`);
        if (verifyResponse.ok) {
          const devicesData = await verifyResponse.json();
          const deviceExists = devicesData.devices?.some(d => d.deviceId === savedDeviceId);
          if (deviceExists) {
            this.deviceId = savedDeviceId;
            this.deviceName = savedDeviceName;
            return { deviceId: this.deviceId, deviceName: this.deviceName };
          } else {
            localStorage.removeItem('comicsNow_deviceId');
            localStorage.removeItem('comicsNow_deviceName');
          }
        }
      } catch (_) {
        this.deviceId = savedDeviceId;
        this.deviceName = savedDeviceName;
        return { deviceId: this.deviceId, deviceName: this.deviceName };
      }
    }

    const deviceName = generateAutoDeviceName();
    const fingerprint = generateFingerprint();
    const nav = typeof navigator !== 'undefined' ? navigator : {};

    const response = await fetch(`${apiBaseUrl}/api/v1/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceName,
        fingerprint,
        userAgent: nav.userAgent || ''
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Failed to register device');
    }

    this.deviceId = data.deviceId;
    this.deviceName = data.deviceName;
    localStorage.setItem('comicsNow_deviceId', this.deviceId);
    localStorage.setItem('comicsNow_deviceName', this.deviceName);

    debugLog('SYNC', `Device auto-registered: ${this.deviceName} (${this.deviceId})`);
    return data;
  }

  async checkSyncStatus(comicId, currentPage = 0) {
    if (!this.deviceId) {
      await this.initializeDevice();
    }
    const apiBaseUrl = (state && state.API_BASE_URL) || '';

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/v1/sync/check/${comicId}?deviceId=${this.deviceId}&lastKnownPage=${currentPage}&lastKnownTimestamp=${this.lastKnownTimestamp}`
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Sync check failed');
      }

      this.currentComicId = comicId;
      this.lastKnownPage = currentPage;
      this.lastKnownTimestamp = data.lastSyncTimestamp || 0;

      if (data.hasNewerSync && data.isFromDifferentDevice) {
        const isIgnored = isSyncPointIgnored(
          comicId,
          data.lastSyncTimestamp,
          data.lastReadPage,
          data.lastSyncDeviceId,
          this.ignoredSyncPoints
        );

        if (isIgnored) {
          debugLog('SYNC', `Skipping sync prompt - sync point already ignored for comic ${comicId}`);
          return { shouldSync: false, data };
        }

        return this.showDeviceSelectionDialog(comicId, currentPage, data);
      }

      return { shouldSync: false, data };
    } catch (error) {
      return { shouldSync: false, error: error.message };
    }
  }

  async showDeviceSelectionDialog(comicId, currentPage, syncData) {
    const apiBaseUrl = (state && state.API_BASE_URL) || '';
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/v1/sync/devices/${comicId}?currentDeviceId=${this.deviceId}`
      );
      if (!response.ok) throw new Error('Failed to fetch device sync data');
      const data = await response.json();

      return new Promise((resolve) => {
        const modal = createDeviceSelectionModal(
          data,
          currentPage,
          syncData,
          resolve,
          async (comic, syncToPage) => {
            this.clearIgnoredSyncPoint(comic.id);
            if (typeof state !== 'undefined' && state.currentComic) {
              state.currentPageIndex = syncToPage;
              if (!state.currentComic.progress) state.currentComic.progress = {};
              state.currentComic.progress.lastReadPage = syncToPage;
              if (typeof state.renderPage === 'function') await state.renderPage();
              const updateLib = state.updateLibraryProgress || (typeof window !== 'undefined' ? window.updateLibraryProgress : null);
              if (typeof updateLib === 'function') updateLib(state.currentComic.id, syncToPage, comic.totalPages);
              try { await this.updateProgress(state.currentComic.id, syncToPage); } catch (_) {}
            }
          },
          (cId, sData) => {
            if (sData) this.markSyncPointAsIgnored(cId, sData.lastSyncTimestamp, sData.lastReadPage, sData.lastSyncDeviceId);
          }
        );
        document.body.appendChild(modal);
      });
    } catch (error) {
      return { shouldSync: false, error: error.message };
    }
  }

  async showSyncDialog(syncData) {
    return new Promise((resolve) => {
      const modal = createSyncModal(syncData, resolve, async (serverProgress) => {
        if (typeof state !== 'undefined' && state.currentComic) {
          state.currentPageIndex = serverProgress.lastReadPage;
          if (!state.currentComic.progress) state.currentComic.progress = {};
          state.currentComic.progress.lastReadPage = serverProgress.lastReadPage;
          if (typeof state.renderPage === 'function') await state.renderPage();
          const updateLib = state.updateLibraryProgress || (typeof window !== 'undefined' ? window.updateLibraryProgress : null);
          if (typeof updateLib === 'function') updateLib(state.currentComic.id, serverProgress.lastReadPage, serverProgress.totalPages);
        }
      });
      document.body.appendChild(modal);
    });
  }

  async updateProgress(comicId, page) {
    if (!this.deviceId) return;
    const apiBaseUrl = (state && state.API_BASE_URL) || '';

    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/sync/update`, {
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
        this.clearIgnoredSyncPoint(comicId);
        updateLocalProgressAndCounts(comicId, page);

        const updateLib = state.updateLibraryProgress || (typeof window !== 'undefined' ? window.updateLibraryProgress : null);
        if (typeof state.library !== 'undefined' && typeof updateLib === 'function') {
          updateLib(comicId, page);
        }

        const saveLibCache = state.saveLibraryCacheToDB || (typeof window !== 'undefined' ? window.saveLibraryCacheToDB : null);
        if (typeof saveLibCache === 'function' && typeof state.library !== 'undefined') {
          saveLibCache(state.library).catch(() => {});
        }
      }
    } catch (_) {}
  }

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
          this.showSyncNotification(result.data);
        }
      } catch (_) {}
    }, 5 * 60 * 1000);
  }

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
    } catch (_) {}

    this.stopPolling();
    this.deviceId = null;
    this.deviceName = null;
    this.lastKnownPage = 0;
    this.lastKnownTimestamp = 0;
  }

  showSyncNotification(syncData) {
    showSyncNotification(syncData, (data) => this.showSyncDialog(data));
  }
}
