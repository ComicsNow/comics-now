/**
 * Comics Now! - Device Identity & Fingerprinting
 *
 * Device name generation, hardware fingerprinting, and ignored sync point tracking.
 */

import { debugLog } from '../globals.js';

export function loadIgnoredSyncPoints() {
  try {
    const stored = localStorage.getItem('comicsNow_ignoredSyncPoints');
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    return {};
  }
}

export function saveIgnoredSyncPoints(ignoredSyncPoints) {
  try {
    localStorage.setItem('comicsNow_ignoredSyncPoints', JSON.stringify(ignoredSyncPoints));
  } catch (error) {}
}

export function markSyncPointAsIgnored(comicId, timestamp, page, deviceId, ignoredSyncPoints) {
  if (!comicId) return;
  const store = ignoredSyncPoints || loadIgnoredSyncPoints();
  store[comicId] = {
    timestamp: timestamp,
    page: page,
    deviceId: deviceId,
    ignoredAt: Date.now()
  };
  saveIgnoredSyncPoints(store);
  debugLog('SYNC', `Marked sync point as ignored for comic ${comicId}:`, store[comicId]);
}

export function clearIgnoredSyncPoint(comicId, ignoredSyncPoints) {
  if (!comicId) return;
  const store = ignoredSyncPoints || loadIgnoredSyncPoints();
  if (store[comicId]) {
    delete store[comicId];
    saveIgnoredSyncPoints(store);
    debugLog('SYNC', `Cleared ignored sync point for comic ${comicId}`);
  }
}

export function isSyncPointIgnored(comicId, timestamp, page, deviceId, ignoredSyncPoints) {
  const store = ignoredSyncPoints || loadIgnoredSyncPoints();
  const ignored = store[comicId];
  if (!ignored) return false;

  const isSameSync = ignored.timestamp === timestamp &&
                     ignored.page === page &&
                     ignored.deviceId === deviceId;

  if (isSameSync) {
    debugLog('SYNC', `Sync point already ignored for comic ${comicId}`);
    return true;
  }

  clearIgnoredSyncPoint(comicId, store);
  return false;
}

export function generateFingerprint() {
  try {
    let canvasData = '';
    try {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillText('Device fingerprint', 2, 2);
          canvasData = canvas.toDataURL();
        }
      }
    } catch (_) {}

    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const scr = typeof screen !== 'undefined' ? screen : {};

    const fingerprint = [
      nav.userAgent || '',
      nav.language || '',
      (scr.width || 0) + 'x' + (scr.height || 0),
      scr.colorDepth || '',
      new Date().getTimezoneOffset(),
      typeof window !== 'undefined' && !!window.sessionStorage,
      typeof window !== 'undefined' && !!window.localStorage,
      canvasData,
      nav.platform || '',
      nav.maxTouchPoints || 0
    ].join('|');

    const encode = typeof btoa === 'function' ? btoa : (s => Buffer.from(s, 'binary').toString('base64'));
    return encode(fingerprint).substring(0, 32);
  } catch (error) {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const basicFingerprint = [
      nav.userAgent || 'unknown',
      Date.now(),
      Math.random()
    ].join('|');
    const encode = typeof btoa === 'function' ? btoa : (s => Buffer.from(s, 'binary').toString('base64'));
    return encode(basicFingerprint).substring(0, 32);
  }
}

export function getDeviceInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const scr = typeof screen !== 'undefined' ? screen : {};
  const userAgent = nav.userAgent || '';
  const platform = nav.platform || '';

  if (/iPhone/.test(userAgent)) {
    return { name: 'iPhone', os: 'iOS', type: 'mobile' };
  }
  if (/iPad/.test(userAgent)) {
    return { name: 'iPad', os: 'iPadOS', type: 'tablet' };
  }
  if (/Android/.test(userAgent)) {
    const isTablet = /Tablet|tablet/.test(userAgent) || ((scr.width || 0) >= 768 && (scr.height || 0) >= 1024);
    return {
      name: isTablet ? 'Android Tablet' : 'Android Phone',
      os: 'Android',
      type: isTablet ? 'tablet' : 'mobile'
    };
  }

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

export function getBrowserInfo() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const userAgent = nav.userAgent || '';

  if (userAgent.includes('Edg/')) return { name: 'Edge' };
  if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) return { name: 'Chrome' };
  if (userAgent.includes('Firefox/')) return { name: 'Firefox' };
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return { name: 'Safari' };
  if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) return { name: 'Opera' };

  return { name: 'Browser' };
}

export function generateAutoDeviceName() {
  const deviceInfo = getDeviceInfo();
  const browserInfo = getBrowserInfo();

  const deviceName = deviceInfo.name || 'Unknown Device';
  const browser = browserInfo.name;
  const os = deviceInfo.os || 'Unknown OS';

  if (deviceInfo.type === 'mobile' || deviceInfo.type === 'tablet') {
    return `${deviceName} (${os}) - ${browser}`;
  } else {
    return `${os} - ${browser}`;
  }
}
