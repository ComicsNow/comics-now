import { debugLog } from '../../globals.js';

export async function getStorageInfo() {
  if (typeof navigator === 'undefined' || !('storage' in navigator) || !('estimate' in navigator.storage)) {
    return { supported: false };
  }

  try {
    const estimate = await navigator.storage.estimate();
    return {
      supported: true,
      quota: estimate.quota,
      usage: estimate.usage,
      usagePercent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0,
      usageMB: Math.round(((estimate.usage || 0) / (1024 * 1024)) * 100) / 100,
      quotaMB: Math.round(((estimate.quota || 0) / (1024 * 1024)) * 100) / 100,
    };
  } catch (error) {
    return { supported: false, error: error.message };
  }
}

export async function forceStorageCleanup() {
  if (typeof debugLog === 'function') {
    debugLog('OFFLINE', 'Forcing storage cleanup...');
  }

  const storageBefore = await getStorageInfo();
  if (storageBefore.supported && typeof debugLog === 'function') {
    debugLog(
      'OFFLINE',
      `Storage before cleanup: ${storageBefore.usageMB}MB / ${storageBefore.quotaMB}MB (${storageBefore.usagePercent}%)`
    );
  }

  try {
    const gcFn = (typeof window !== 'undefined' && window.gc) || (typeof globalThis.gc === 'function' ? globalThis.gc : null);
    if (gcFn) {
      gcFn();
    }

    if (typeof navigator !== 'undefined' && 'storage' in navigator && 'persist' in navigator.storage) {
      try {
        await navigator.storage.persist();
      } catch (_) {
        console.warn('[OFFLINE] navigator.storage.persist failed:', _);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const storageAfter = await getStorageInfo();
    if (storageAfter.supported && typeof debugLog === 'function') {
      debugLog(
        'OFFLINE',
        `Storage after cleanup: ${storageAfter.usageMB}MB / ${storageAfter.quotaMB}MB (${storageAfter.usagePercent}%)`
      );

      const savedMB = storageBefore.usageMB - storageAfter.usageMB;
      if (savedMB > 0) {
        debugLog('OFFLINE', `Freed ${savedMB}MB of storage`);
      }
    }

    return storageAfter;
  } catch (error) {
    console.error('[OFFLINE] Error during forceStorageCleanup:', error);
    return storageBefore;
  }
}
