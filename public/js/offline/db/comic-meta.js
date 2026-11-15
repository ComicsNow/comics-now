import { state, debugLog } from '../../globals.js';
import { openOfflineDB, getCurrentUserId } from '../db-core.js';

export const COMIC_META_BACKFILL_VERSION = 14;
let backfillPromise = null;

async function ensureActiveDB() {
  const dbToUse = state?.db || (typeof window !== 'undefined' ? window.db : null);
  if (!dbToUse) {
    const openDbFn = typeof openOfflineDB === 'function'
      ? openOfflineDB
      : (state?.openOfflineDB || (typeof window !== 'undefined' ? window.openOfflineDB : null));
    if (typeof openDbFn === 'function') {
      await openDbFn();
    }
  }
  return state?.db || (typeof window !== 'undefined' ? window.db : null);
}

function resolveUserId() {
  const getUserIdFn = typeof getCurrentUserId === 'function'
    ? getCurrentUserId
    : (state?.getCurrentUserId || (typeof window !== 'undefined' ? window.getCurrentUserId : null));
  return typeof getUserIdFn === 'function' ? getUserIdFn() : 'default-user';
}

export function buildComicMetaRecord(record, fallbackUserId = 'default-user') {
  if (!record || record.id == null) return null;
  return {
    id: record.id,
    userId: record.userId || fallbackUserId || 'default-user',
    comicInfo: record.comicInfo || {},
    fileSize: record.fileSize ?? record.fileBlob?.size ?? 0,
    downloadedAt: record.downloadedAt || Date.now()
  };
}

function readBackfillVersion(db) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames?.contains('settings')) {
      resolve(0);
      return;
    }
    try {
      const tx = db.transaction(['settings'], 'readonly');
      const req = tx.objectStore('settings').get('comicMetaBackfillVersion');
      req.onsuccess = (e) => resolve(e.target.result?.value || 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

function writeBackfillVersion(db, version) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames?.contains('settings')) {
      resolve();
      return;
    }
    try {
      const tx = db.transaction(['settings'], 'readwrite');
      tx.objectStore('settings').put({ key: 'comicMetaBackfillVersion', value: version });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function streamComicsIntoMeta(db) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['comics', 'comicMeta'], 'readwrite');
      const comicsStore = tx.objectStore('comics');
      const metaStore = tx.objectStore('comicMeta');

      if (typeof comicsStore.openCursor !== 'function') {
        resolve();
        return;
      }

      const cursorReq = comicsStore.openCursor();
      cursorReq.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const meta = buildComicMetaRecord(cursor.value, 'default-user');
        if (meta) {
          metaStore.put(meta);
        }
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target?.error || new Error('comicMeta backfill failed'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function ensureComicMetaBackfilled(db) {
  const activeDb = db || await ensureActiveDB();
  if (!activeDb || !activeDb.objectStoreNames?.contains('comicMeta')) {
    return false;
  }

  const version = await readBackfillVersion(activeDb);
  if (version >= COMIC_META_BACKFILL_VERSION) {
    return true;
  }

  if (backfillPromise) {
    return backfillPromise;
  }

  backfillPromise = (async () => {
    try {
      await streamComicsIntoMeta(activeDb);
      await writeBackfillVersion(activeDb, COMIC_META_BACKFILL_VERSION);
      if (typeof debugLog === 'function') {
        debugLog('OFFLINE', 'Completed zero-blob comicMeta v14 backfill');
      }
      return true;
    } catch (err) {
      if (typeof debugLog === 'function') {
        debugLog('OFFLINE', 'comicMeta backfill skipped/failed:', err.message);
      }
      return false;
    } finally {
      backfillPromise = null;
    }
  })();

  return backfillPromise;
}

export async function getAllDownloadedComicIdsFromMeta() {
  const activeDb = await ensureActiveDB();
  if (!activeDb) return new Set();

  const hasMeta = activeDb.objectStoreNames?.contains('comicMeta');
  if (!hasMeta) return null;

  await ensureComicMetaBackfilled(activeDb);
  const currentUserId = resolveUserId();

  return new Promise((resolve) => {
    try {
      const tx = activeDb.transaction(['comicMeta'], 'readonly');
      const store = tx.objectStore('comicMeta');
      if (typeof store.index === 'function') {
        const idx = store.index('userId');
        if (idx && typeof idx.getAllKeys === 'function') {
          const req = idx.getAllKeys(currentUserId);
          req.onsuccess = (e) => resolve(new Set(e.target.result || []));
          req.onerror = () => resolve(new Set());
          return;
        }
      }
      if (typeof store.getAll === 'function') {
        const req = store.getAll();
        req.onsuccess = (e) => {
          const rows = e.target.result || [];
          resolve(new Set(rows.filter(r => !r.userId || r.userId === currentUserId).map(r => r.id)));
        };
        req.onerror = () => resolve(new Set());
        return;
      }
      resolve(new Set());
    } catch {
      resolve(new Set());
    }
  });
}

function mergeProgressWithMeta(meta, progressMap) {
  const baseInfo = meta.comicInfo || {};
  const savedProgress = progressMap.get(meta.id);
  const lastReadPage = savedProgress?.lastReadPage ?? baseInfo.progress?.lastReadPage ?? 0;
  const totalPages = savedProgress?.totalPages ?? baseInfo.progress?.totalPages ?? baseInfo.totalPages ?? 0;

  return {
    id: meta.id,
    userId: meta.userId || 'default-user',
    fileSize: meta.fileSize ?? 0,
    downloadedAt: meta.downloadedAt,
    comicInfo: {
      ...baseInfo,
      id: baseInfo.id ?? meta.id,
      progress: {
        lastReadPage,
        totalPages
      }
    },
    progress: {
      lastReadPage,
      totalPages
    }
  };
}

export async function getAllDownloadedComicMetadata() {
  const activeDb = await ensureActiveDB();
  if (!activeDb) return [];

  if (!activeDb.objectStoreNames?.contains('comicMeta')) {
    return null;
  }

  await ensureComicMetaBackfilled(activeDb);
  const currentUserId = resolveUserId();

  return new Promise((resolve, reject) => {
    try {
      const storeNames = activeDb.objectStoreNames.contains('progress')
        ? ['comicMeta', 'progress']
        : ['comicMeta'];
      const tx = activeDb.transaction(storeNames, 'readonly');
      const metaReq = tx.objectStore('comicMeta').getAll();
      const progressReq = storeNames.includes('progress')
        ? tx.objectStore('progress').getAll()
        : null;

      let metaRows = [];
      let progressRows = [];

      metaReq.onsuccess = (e) => {
        metaRows = e.target.result || [];
      };
      if (progressReq) {
        progressReq.onsuccess = (e) => {
          progressRows = e.target.result || [];
        };
      }

      tx.oncomplete = () => {
        const progressMap = new Map();
        for (const p of progressRows) {
          if (p && p.id != null) progressMap.set(p.id, p);
        }
        const results = metaRows
          .filter((row) => row && (!row.userId || row.userId === currentUserId))
          .map((row) => mergeProgressWithMeta(row, progressMap));
        resolve(results);
      };
      tx.onerror = (e) => reject(e.target?.error || new Error('Failed to load comic metadata'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function getOfflineComicMetaById(comicId) {
  if (comicId == null) return null;
  const activeDb = await ensureActiveDB();
  if (!activeDb) return null;

  if (activeDb.objectStoreNames?.contains('comicMeta')) {
    await ensureComicMetaBackfilled(activeDb);
    const currentUserId = resolveUserId();
    const idStr = String(comicId);
    const idNum = /^\d+$/.test(idStr) ? Number(comicId) : null;
    const keysToTry = [comicId];
    if (idNum !== null && idNum !== comicId) keysToTry.push(idNum);
    if (idStr !== comicId) keysToTry.push(idStr);

    const meta = await new Promise((resolve) => {
      try {
        const storeNames = activeDb.objectStoreNames.contains('progress')
          ? ['comicMeta', 'progress']
          : ['comicMeta'];
        const tx = activeDb.transaction(storeNames, 'readonly');
        const metaStore = tx.objectStore('comicMeta');
        const progressStore = storeNames.includes('progress') ? tx.objectStore('progress') : null;

        let idx = 0;
        const tryNext = () => {
          if (idx >= keysToTry.length) {
            resolve(null);
            return;
          }
          const key = keysToTry[idx++];
          const req = metaStore.get(key);
          req.onsuccess = (e) => {
            const found = e.target.result;
            if (!found) {
              tryNext();
              return;
            }
            if (found.userId && found.userId !== currentUserId) {
              resolve(null);
              return;
            }
            if (!progressStore) {
              resolve(mergeProgressWithMeta(found, new Map()));
              return;
            }
            const pReq = progressStore.get(found.id);
            pReq.onsuccess = (pe) => {
              const pMap = new Map();
              if (pe.target.result) pMap.set(found.id, pe.target.result);
              resolve(mergeProgressWithMeta(found, pMap));
            };
            pReq.onerror = () => resolve(mergeProgressWithMeta(found, new Map()));
          };
          req.onerror = () => tryNext();
        };
        tryNext();
      } catch {
        resolve(null);
      }
    });

    if (meta) return meta;
  }

  return null;
}
