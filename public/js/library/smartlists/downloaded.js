import { state, applyDisplayInfoToComic } from '../../globals.js';

let downloadedSmartListComics = [];
let downloadedSmartListError = null;

const applyDisplay = typeof applyDisplayInfoToComic === 'function' ? applyDisplayInfoToComic : (c) => c;

function triggerDownloadedButtonCount() {
  const fn = state?.updateDownloadedButtonCount || (typeof window !== 'undefined' ? window.updateDownloadedButtonCount : null);
  if (typeof fn === 'function') fn();
}

export function parseDownloadedTimestamp(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export function findDownloadedComicById(comicId) {
  if (!Array.isArray(downloadedSmartListComics) || downloadedSmartListComics.length === 0) {
    return null;
  }
  const idStr = comicId == null ? null : String(comicId);
  if (!idStr) {
    return null;
  }
  return downloadedSmartListComics.find(entry => String(entry.id) === idStr) || null;
}

export function updateDownloadedComicProgressData(comicId, progress = {}) {
  const target = findDownloadedComicById(comicId);
  if (!target) return false;

  if (!target.progress || typeof target.progress !== 'object') {
    target.progress = { totalPages: 0, lastReadPage: 0 };
  }

  const normalized = target.progress;

  if (progress.lastReadPage != null) {
    const lastRead = Number(progress.lastReadPage);
    if (Number.isFinite(lastRead) && lastRead >= 0) {
      normalized.lastReadPage = lastRead;
    }
  }

  if (progress.totalPages != null) {
    const totalPages = Number(progress.totalPages);
    if (Number.isFinite(totalPages) && totalPages >= 0) {
      normalized.totalPages = totalPages;
    }
  }

  return true;
}

export function resolveTotalPagesForComic(comic) {
  if (!comic) return 0;
  const progress = comic.progress || {};
  const candidates = [
    progress.totalPages,
    comic.totalPages,
    comic.pageCount,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

export function syncDownloadedComicStatusFromLibrary(comic, normalizedStatus) {
  if (!comic) return false;
  const totalPages = resolveTotalPagesForComic(comic);

  if (normalizedStatus === 'read') {
    const resolvedTotal = Math.max(totalPages, 1);
    return updateDownloadedComicProgressData(comic.id, {
      totalPages: resolvedTotal,
      lastReadPage: Math.max(resolvedTotal - 1, 0),
    });
  }

  const payload = { lastReadPage: 0 };
  if (totalPages <= 1) {
    payload.totalPages = 0;
  } else if (Number.isFinite(totalPages) && totalPages > 1) {
    payload.totalPages = totalPages;
  }

  return updateDownloadedComicProgressData(comic.id, payload);
}

export async function rebuildDownloadedComics(options = {}) {
  const { skipRender = false, forceRender = false } = options || {};

  const getAllDownloadedComics = state?.getAllDownloadedComics ||
    (typeof window !== 'undefined' ? window.getAllDownloadedComics : null) ||
    state?.OfflineDB?.getAllDownloadedComics ||
    (typeof window !== 'undefined' ? window.OfflineDB?.getAllDownloadedComics : null);

  if (typeof getAllDownloadedComics !== 'function') {
    downloadedSmartListComics = [];
    downloadedSmartListError = new Error('Offline downloads unavailable');
    triggerDownloadedButtonCount();
    const LibraryRender = state?.LibraryRender || (typeof window !== 'undefined' ? window.LibraryRender : null);
    const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
    if (forceRender || (!skipRender && currentView === 'downloaded')) {
      LibraryRender?.renderDownloadedSmartList?.();
    }
    return downloadedSmartListComics;
  }

  try {
    const offlineRecords = await getAllDownloadedComics();
    const normalizedEntries = (Array.isArray(offlineRecords) ? offlineRecords : [])
      .map(record => {
        if (!record) return null;

        const baseComic = {
          ...(record.comicInfo || {}),
        };

        if (baseComic.id == null) {
          baseComic.id = record.id;
        }

        const sourceProgress = record.progress || record.comicInfo?.progress;
        if (!baseComic.progress || typeof baseComic.progress !== 'object') {
          if (sourceProgress && typeof sourceProgress === 'object') {
            baseComic.progress = {
              totalPages: Number(sourceProgress.totalPages) || 0,
              lastReadPage: Number(sourceProgress.lastReadPage) || 0,
            };
          } else {
            baseComic.progress = { totalPages: 0, lastReadPage: 0 };
          }
        } else {
          baseComic.progress = {
            totalPages: Number(baseComic.progress.totalPages) || 0,
            lastReadPage: Number(baseComic.progress.lastReadPage) || 0,
          };
        }

        const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
        if (comicIdMap) {
          const libraryComic = comicIdMap.get(baseComic.id);

          if (libraryComic && libraryComic.mangaMode !== undefined) {
            baseComic.mangaMode = libraryComic.mangaMode;
          }

          if (libraryComic && libraryComic.continuousMode !== undefined) {
            baseComic.continuousMode = libraryComic.continuousMode;
          }
        }

        applyDisplay(baseComic);

        const timestampCandidates = [
          baseComic.downloadedAt,
          record.downloadedAt,
          record.savedAt,
          baseComic.savedAt,
          baseComic.updatedAt,
          baseComic.convertedAt,
        ];

        const sortTimestamp = timestampCandidates
          .map(value => parseDownloadedTimestamp(value))
          .find(value => Number.isFinite(value)) || 0;

        const sortName = (baseComic.displayName || baseComic.title || baseComic.name || '')
          .toLowerCase();

        return {
          comic: baseComic,
          sortTimestamp,
          sortName,
        };
      })
      .filter(Boolean);

    normalizedEntries.sort((a, b) => {
      if (b.sortTimestamp !== a.sortTimestamp) {
        return b.sortTimestamp - a.sortTimestamp;
      }
      if (a.sortName < b.sortName) return -1;
      if (a.sortName > b.sortName) return 1;
      return 0;
    });

    downloadedSmartListComics = normalizedEntries.map(entry => entry.comic);
    downloadedSmartListError = null;
  } catch (error) {
    downloadedSmartListComics = [];
    downloadedSmartListError = error;
  }

  triggerDownloadedButtonCount();

  const LibraryRender = state?.LibraryRender || (typeof window !== 'undefined' ? window.LibraryRender : null);
  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  if (forceRender || (!skipRender && currentView === 'downloaded')) {
    LibraryRender?.renderDownloadedSmartList?.();
  }

  return downloadedSmartListComics;
}

export function getDownloadedSmartListComics() {
  return downloadedSmartListComics;
}

export function getDownloadedSmartListError() {
  return downloadedSmartListError;
}

export function updateDownloadedSmartListComic(comicId, updates) {
  if (!comicId || !updates) return false;

  const target = findDownloadedComicById(comicId);
  if (!target) return false;

  Object.assign(target, updates);
  return true;
}
