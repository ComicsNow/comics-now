import { state, encodePath } from '../../globals.js';
import * as DownloadCore from '../download-core.js';
import * as DownloadHistory from '../download-history.js';

const MAX_DOWNLOAD_RETRIES = 3;

export async function startBackgroundFetch(manager, queueItem) {
  const comic = queueItem.comic;
  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
  const url = `${apiBaseUrl}/api/v1/comics/download?path=${encodeURIComponent(encodePath(comic.path))}`;
  const registration = await navigator.serviceWorker.ready;
  if (!registration || !registration.backgroundFetch) {
    throw new Error('Background Fetch unavailable');
  }

  let downloadTotal = 0;
  try {
    const head = await fetch(url, { method: 'HEAD', credentials: 'include' });
    downloadTotal = Number(head.headers.get('Content-Length')) || 0;
  } catch (_) {}

  const options = { title: queueItem.displayName || comic.name || 'Comic', downloads: 1 };
  if (downloadTotal > 0) options.downloadTotal = downloadTotal;

  const bgFetch = await registration.backgroundFetch.fetch(`comic-${comic.id}`, [url], options);

  queueItem.status = 'downloading';
  queueItem.backgroundFetchId = bgFetch.id;
  queueItem.totalBytes = downloadTotal || queueItem.totalBytes || 0;
  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveQueueItemToDB) await db.saveQueueItemToDB(queueItem);
  manager.updateQueueUI();
  return bgFetch;
}

export async function reconnectBackgroundFetches(manager) {
  if (!manager.useBackgroundFetch || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.backgroundFetch || !reg.backgroundFetch.getIds) return;
    const ids = await reg.backgroundFetch.getIds();
    for (const id of ids) {
      try {
        const bg = await reg.backgroundFetch.get(id);
        if (!bg || bg.result) continue;
        const comicId = id.startsWith('comic-') ? id.slice('comic-'.length) : id;
        manager.activeDownloadId = comicId;
        const item = manager.persistentQueue.find(i => i.id === comicId);
        if (item && item.status !== 'downloading') {
          item.status = 'downloading';
          const db = state.OfflineDB || window.OfflineDB || {};
          if (db.saveQueueItemToDB) db.saveQueueItemToDB(item);
        }
      } catch (_) {}
    }
    manager.updateQueueUI();
  } catch (_) {}
}

export async function handleServiceWorkerMessage(manager, data) {
  if (!data || !data.comicId) return;
  const item = manager.persistentQueue.find(i => i.id === data.comicId);
  const db = state.OfflineDB || window.OfflineDB || {};

  if (data.type === 'download-complete') {
    if (item) {
      item.status = 'completed';
      item.progress = 1;
      item.completedAt = Date.now();
      item.error = null;
      if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
    }
    const ids = state.downloadedComicIds || window.downloadedComicIds;
    if (ids && ids.add) ids.add(data.comicId);
    const fetchLibrary = state.fetchLibrary || window.fetchLibrary;
    if (typeof fetchLibrary === 'function') {
      try { await fetchLibrary(); } catch (_) {}
    }
  } else if (data.type === 'download-error') {
    if (item) {
      item.status = 'error';
      item.error = data.error || 'Background download failed';
      item.failedAt = Date.now();
      if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
    }
  } else if (data.type === 'download-aborted') {
    if (item) {
      item.status = 'paused';
      if (db.saveQueueItemToDB) await db.saveQueueItemToDB(item);
    }
  }

  if (manager.activeDownloadId === data.comicId) {
    manager.activeDownloadId = null;
  }
  manager.updateQueueUI();
  manager.pump();
}

export async function abortBackgroundFetch(manager, comicId) {
  if (!manager.useBackgroundFetch || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.backgroundFetch && reg.backgroundFetch.get) {
      const bg = await reg.backgroundFetch.get(`comic-${comicId}`);
      if (bg && bg.abort) await bg.abort();
    }
  } catch (_) {}
}

export async function saveDownloadedComic(comic, blob) {
  const comicRecord = {
    ...comic,
    progress: { ...(comic.progress || {}) },
    downloadedAt: Date.now(),
  };

  const db = state.OfflineDB || window.OfflineDB || {};
  if (db.saveComicToDB) {
    await db.saveComicToDB(comicRecord, blob);
  }

  const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds || new Set();
  downloadedComicIds.add(comic.id);
  state.downloadedComicIds = downloadedComicIds;
  if (typeof window !== 'undefined') {
    window.downloadedComicIds = downloadedComicIds;
  }

  const fetchLibrary = state.fetchLibrary || window.fetchLibrary;
  if (typeof fetchLibrary === 'function') {
    await fetchLibrary();
  }

  const refreshDownloadsInfo = state.refreshDownloadsInfo || window.refreshDownloadsInfo;
  if (typeof refreshDownloadsInfo === 'function') {
    await refreshDownloadsInfo();
  }
}

export async function downloadComicItem(manager, queueItem) {
  const comic = queueItem.comic;
  if (!comic) {
    throw new Error('Comic data not found in queue item');
  }

  manager.abortController = new AbortController();

  const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
  const url = `${apiBaseUrl}/api/v1/comics/download?path=${encodeURIComponent(encodePath(comic.path))}`;
  const db = state.OfflineDB || window.OfflineDB || {};

  const partial = manager.partialData.get(comic.id) || { chunks: [], receivedBytes: 0 };
  let lastSavedProgress = queueItem.progress || 0;
  let lastUIUpdate = 0;

  const onProgress = (received, total) => {
    partial.receivedBytes = received;
    manager.partialData.set(comic.id, partial);
    if (!total) return;
    const progress = received / total;
    queueItem.progress = progress;
    queueItem.receivedBytes = received;
    queueItem.totalBytes = total;
    const now = Date.now();
    if (progress - lastSavedProgress >= 0.05 || now - lastUIUpdate >= 800) {
      if (db.saveQueueItemToDB) db.saveQueueItemToDB(queueItem);
      manager.updateQueueUI();
      lastSavedProgress = progress;
      lastUIUpdate = now;
    }
  };

  const result = await DownloadCore.runWithRetry(
    () => DownloadCore.downloadWithResume({
      url,
      fetchImpl: (u, opts) => fetch(u, opts),
      signal: manager.abortController.signal,
      existingChunks: partial.chunks,
      receivedBytes: partial.receivedBytes,
      onProgress
    }),
    {
      maxRetries: MAX_DOWNLOAD_RETRIES,
      sleep: (ms) => new Promise(r => setTimeout(r, ms)),
      backoff: (n) => DownloadHistory.computeBackoffMs(n),
      shouldRetry: (err) => err && err.name !== 'AbortError'
    }
  );

  const blob = result.blob;
  queueItem.progress = 1;

  try {
    const guidedViewUrl = `${apiBaseUrl}/api/v1/comics/${encodeURIComponent(comic.id)}/guided-view`;
    const gvRes = await fetch(guidedViewUrl, { credentials: 'include' });
    if (gvRes.ok && 'caches' in window) {
      const cache = await caches.open('comics-now-downloads');
      await cache.put(guidedViewUrl, gvRes);
    }
  } catch (gvErr) {
    console.error('[DOWNLOAD MANAGER] Guided view fetch failed:', gvErr);
  }

  await manager.saveComic(comic, blob);
  manager.partialData.delete(comic.id);
  manager.abortController = null;
}
