import { state } from '../../globals.js';
import * as DownloadHistory from '../download-history.js';

export async function pruneExpiredHistoryFromDB(manager, now = Date.now()) {
  const expired = DownloadHistory.selectExpired(manager.persistentQueue, now);
  if (expired.length === 0) return 0;
  const db = state.OfflineDB || window.OfflineDB || {};
  const expiredIds = new Set(expired.map(i => i.id));
  for (const item of expired) {
    try {
      if (db.removeQueueItemFromDB) await db.removeQueueItemFromDB(item.id);
    } catch (_) {}
  }
  manager.persistentQueue = manager.persistentQueue.filter(i => !expiredIds.has(i.id));
  return expired.length;
}

export async function loadQueueFromDB(manager) {
  try {
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.getQueueFromDB) {
      manager.persistentQueue = await db.getQueueFromDB();
    }
    for (const item of manager.persistentQueue) {
      if (item.status === 'downloading') item.status = 'paused';
    }
    await manager.pruneExpiredHistory();
    return manager.persistentQueue;
  } catch (error) {
    console.error('[DOWNLOAD MANAGER] Error loading queue:', error);
    return [];
  }
}

export async function addComicToQueue(manager, comic) {
  const getCurrentUserId = state.getCurrentUserId || window.getCurrentUserId;
  const applyDisplayInfoToComic = state.applyDisplayInfoToComic || window.applyDisplayInfoToComic;

  if (!comic.userId && typeof getCurrentUserId === 'function') {
    comic.userId = getCurrentUserId();
  }

  const displayInfo = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic(comic) : comic;
  const queueItem = {
    id: comic.id,
    comicPath: comic.path,
    comicName: comic.name || 'Comic',
    displayName: displayInfo.displayTitle || comic.name || 'Comic',
    status: 'pending',
    progress: 0,
    priority: manager.persistentQueue.length,
    addedAt: Date.now(),
    comic: comic
  };

  manager.persistentQueue.push(queueItem);
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveQueueItemToDB) {
    await db.saveQueueItemToDB(queueItem);
  }

  manager.updateQueueUI();
  manager.pump();

  return queueItem;
}

export async function cancelComicDownload(manager, comicId) {
  if (manager.currentDownload && manager.currentDownload.id === comicId) {
    if (manager.abortController) manager.abortController.abort();
    manager.currentDownload = null;
  }
  await manager._abortBackgroundFetch(comicId);

  manager.persistentQueue = manager.persistentQueue.filter(item => item.id !== comicId);
  manager.partialData.delete(comicId);
  if (manager.activeDownloadId === comicId) manager.activeDownloadId = null;
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.removeQueueItemFromDB) {
    await db.removeQueueItemFromDB(comicId);
  }

  manager.updateQueueUI();
  manager.pump();
}

export async function stopAllComicDownloads(manager) {
  const total = manager.persistentQueue.length;
  if (total === 0) return;
  const ok = window.confirm(`Stop all downloads and clear the queue (${total} item${total === 1 ? '' : 's'})?`);
  if (!ok) return;

  if (manager.abortController) {
    try { manager.abortController.abort(); } catch (_) {}
    manager.abortController = null;
  }
  manager.currentDownload = null;

  const ids = manager.persistentQueue.map(i => i.id);
  manager.persistentQueue = [];
  const db = state.OfflineDB || window.OfflineDB || {};
  for (const id of ids) {
    try {
      if (db.removeQueueItemFromDB) {
        await db.removeQueueItemFromDB(id);
      }
    } catch (_) {}
  }
  manager.updateQueueUI();
}

export async function restartComicDownload(manager, comicId) {
  const item = manager.persistentQueue.find(i => i.id === comicId);
  if (!item) return false;

  item.status = 'pending';
  item.progress = 0;
  item.error = null;
  item.failedAt = null;
  item.receivedBytes = 0;
  manager.partialData.delete(comicId);

  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveQueueItemToDB) {
    await db.saveQueueItemToDB(item);
  }

  manager.updateQueueUI();
  manager.pump();
  return true;
}

export async function pauseComicDownload(manager, comicId) {
  const item = manager.persistentQueue.find(i => i.id === comicId);
  if (!item || (item.status !== 'downloading' && item.status !== 'pending')) return false;

  if (manager.currentDownload && manager.currentDownload.id === comicId && manager.abortController) {
    manager.abortController.abort();
  }
  await manager._abortBackgroundFetch(comicId);

  item.status = 'paused';
  if (manager.activeDownloadId === comicId) manager.activeDownloadId = null;
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);

  manager.updateQueueUI();
  manager.pump();
  return true;
}

export async function resumeComicDownload(manager, comicId) {
  const item = manager.persistentQueue.find(i => i.id === comicId);
  if (!item || item.status !== 'paused') return false;

  item.status = 'pending';
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);

  manager.updateQueueUI();
  manager.pump();
  return true;
}

export async function pauseAllDownloads(manager) {
  const affected = DownloadHistory.planBatch(manager.persistentQueue, 'pause-all');
  if (manager.abortController) {
    try { manager.abortController.abort(); } catch (_) {}
    manager.abortController = null;
  }
  manager.currentDownload = null;
  const db = state.OfflineDB || window.OfflineDB || {};
  for (const item of affected) {
    await manager._abortBackgroundFetch(item.id);
    item.status = 'paused';
    if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
  }
  manager.activeDownloadId = null;
  manager.updateQueueUI();
  return affected.length;
}

export async function startAllDownloads(manager) {
  const affected = DownloadHistory.planBatch(manager.persistentQueue, 'start-all');
  const db = state.OfflineDB || window.OfflineDB || {};
  for (const item of affected) {
    item.status = 'pending';
    if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
  }
  manager.updateQueueUI();
  manager.pump();
  return affected.length;
}

export async function cancelAllDownloads(manager) {
  const affected = DownloadHistory.planBatch(manager.persistentQueue, 'cancel-all');
  if (affected.length === 0) return 0;
  const ok = typeof window === 'undefined' || window.confirm(
    `Cancel all downloads (${affected.length})?`
  );
  if (!ok) return 0;

  if (manager.abortController) {
    try { manager.abortController.abort(); } catch (_) {}
    manager.abortController = null;
  }
  manager.currentDownload = null;
  manager.activeDownloadId = null;

  const db = state.OfflineDB || window.OfflineDB || {};
  const ids = new Set(affected.map(i => i.id));
  for (const id of ids) {
    await manager._abortBackgroundFetch(id);
    manager.partialData.delete(id);
    try {
      if (db.removeQueueItemFromDB) await db.removeQueueItemFromDB(id);
    } catch (_) {}
  }
  manager.persistentQueue = manager.persistentQueue.filter(i => !ids.has(i.id));
  manager.updateQueueUI();
  return ids.size;
}

export async function retryAllFailedDownloads(manager) {
  const affected = DownloadHistory.planBatch(manager.persistentQueue, 'retry-failed');
  const db = state.OfflineDB || window.OfflineDB || {};
  for (const item of affected) {
    item.status = 'pending';
    item.progress = 0;
    item.error = null;
    item.failedAt = null;
    item.receivedBytes = 0;
    manager.partialData.delete(item.id);
    if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
  }
  manager.updateQueueUI();
  manager.pump();
  return affected.length;
}

export async function changeQueuePriority(manager, comicId, newPriority) {
  const item = manager.persistentQueue.find(i => i.id === comicId);
  if (!item) return false;

  const oldIndex = manager.persistentQueue.indexOf(item);
  manager.persistentQueue.splice(oldIndex, 1);
  manager.persistentQueue.splice(newPriority, 0, item);

  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.updateQueuePriorities) {
    await db.updateQueuePriorities(manager.persistentQueue);
  }

  manager.updateQueueUI();
  return true;
}

export async function clearCompletedItems(manager) {
  const beforeCount = manager.persistentQueue.length;
  manager.persistentQueue = manager.persistentQueue.filter(
    item => item.status !== 'completed' && item.status !== 'error'
  );
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.clearCompletedQueueItems) {
    await db.clearCompletedQueueItems();
  }
  const cleared = beforeCount - manager.persistentQueue.length;

  manager.updateQueueUI();
  return cleared;
}

export async function processDownloadQueue(manager) {
  if (manager.isProcessing) {
    return;
  }

  manager.isProcessing = true;

  while (manager.persistentQueue.length > 0) {
    const nextItem = manager.persistentQueue.find(item => item.status === 'pending');
    if (!nextItem) break;

    manager.currentDownload = nextItem;
    nextItem.status = 'downloading';
    const db = state.OfflineDB || window.OfflineDB || {};
    if (db.saveQueueItemToDB) {
      await db.saveQueueItemToDB(nextItem);
    }
    manager.updateQueueUI();

    try {
      await manager.downloadComic(nextItem);
      nextItem.status = 'completed';
      nextItem.progress = 1;
      nextItem.completedAt = Date.now();
      nextItem.error = null;
      if (db.saveQueueItemToDB) await db.saveQueueItemToDB(nextItem);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[DOWNLOAD MANAGER] Download failed:', nextItem.displayName, error);
        nextItem.status = 'error';
        nextItem.error = error.message || 'Download failed';
        nextItem.failedAt = Date.now();
        manager.partialData.delete(nextItem.id);
        if (db.saveQueueItemToDB) await db.saveQueueItemToDB(nextItem);
      }
    }

    manager.currentDownload = null;
    manager.updateQueueUI();
  }

  manager.isProcessing = false;
}
