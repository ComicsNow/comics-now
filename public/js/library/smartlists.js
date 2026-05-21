import {
  state,
  latestAddedCountSpan,
  downloadedCountSpan,
  applyDisplayInfoToComic
} from '../globals.js';

export const LATEST_ADDED_DAYS = 14;

let latestComics = [];
let downloadedSmartListComics = [];
let downloadedSmartListError = null;
let guidedComics = [];
let mangaComics = [];
let nonMangaComics = [];

export function updateLatestButtonCount() {
  if (latestAddedCountSpan) {
    latestAddedCountSpan.textContent = latestComics.length.toString();
  }
}

export function updateDownloadedButtonCount() {
  if (downloadedCountSpan) {
    downloadedCountSpan.textContent = (Array.isArray(downloadedSmartListComics)
      ? downloadedSmartListComics.length
      : 0).toString();
  }
}

export function updateGuidedButtonCount() {
  const span = document.getElementById('guided-smart-list-count');
  if (span) span.textContent = (Array.isArray(guidedComics) ? guidedComics.length : 0).toString();
}

export function updateMangaFilterButtonCount() {
  const span = document.getElementById('dynamic-manga-filter-count');
  const label = document.getElementById('dynamic-manga-filter-label');
  const btn = document.getElementById('dynamic-manga-filter-btn');
  if (!span || !label || !btn) return;

  const isMangaDefault = state.mangaModePreference === true || window.mangaModePreference === true;
  
  if (isMangaDefault) {
    label.textContent = 'Non-Manga';
    span.textContent = nonMangaComics.length.toString();
    btn.classList.toggle('hidden', nonMangaComics.length === 0);
  } else {
    label.textContent = 'Manga';
    span.textContent = mangaComics.length.toString();
    btn.classList.toggle('hidden', mangaComics.length === 0);
  }
}

export function rebuildMangaSmartLists() {
  const manga = [];
  const nonManga = [];
  
  const comicIdMap = state.comicIdMap || window.comicIdMap;
  if (comicIdMap && comicIdMap.size > 0) {
    for (const comic of comicIdMap.values()) {
      if (comic.mangaMode === true) {
        manga.push(comic);
      } else {
        nonManga.push(comic);
      }
    }
  }
  
  const sortFn = (a, b) => {
    const an = (a.displayName || a.name || '').toLowerCase();
    const bn = (b.displayName || b.name || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };
  
  manga.sort(sortFn);
  nonManga.sort(sortFn);
  
  mangaComics = manga;
  nonMangaComics = nonManga;
  updateMangaFilterButtonCount();
}

export function getMangaComics() { return mangaComics; }
export function getNonMangaComics() { return nonMangaComics; }

export function rebuildGuidedComics() {
  const out = [];
  const comicIdMap = state.comicIdMap || window.comicIdMap;
  if (comicIdMap && comicIdMap.size > 0) {
    for (const comic of comicIdMap.values()) {
      if (comic.guidedViewStatus === 'completed') out.push(comic);
    }
  }
  out.sort((a, b) => {
    const an = (a.displayName || a.name || '').toLowerCase();
    const bn = (b.displayName || b.name || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  guidedComics = out;
  updateGuidedButtonCount();
}

export function getGuidedComics() { return guidedComics; }

export function rebuildLatestComics() {
  const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
  const recentComics = [];

  const comicIdMap = state.comicIdMap || window.comicIdMap;
  if (comicIdMap && comicIdMap.size > 0) {
    for (const comic of comicIdMap.values()) {
      const updatedValue = Number(comic.updatedAt ?? comic.convertedAt ?? 0);
      if (!Number.isFinite(updatedValue) || updatedValue <= 0) continue;
      if (updatedValue >= cutoff) {
        recentComics.push(comic);
      }
    }
  }

  recentComics.sort((a, b) => {
    const bTime = Number(b.updatedAt ?? b.convertedAt ?? 0);
    const aTime = Number(a.updatedAt ?? a.convertedAt ?? 0);
    return bTime - aTime;
  });

  latestComics = recentComics;
  updateLatestButtonCount();
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

  const getAllDownloadedComics = state.getAllDownloadedComics || window.getAllDownloadedComics || (state.OfflineDB?.getAllDownloadedComics) || (window.OfflineDB?.getAllDownloadedComics);

  if (typeof getAllDownloadedComics !== 'function') {
    downloadedSmartListComics = [];
    downloadedSmartListError = new Error('Offline downloads unavailable');
    updateDownloadedButtonCount();
    const LibraryRender = state.LibraryRender || window.LibraryRender;
    const currentView = state.currentView || window.currentView;
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

        const comicIdMap = state.comicIdMap || window.comicIdMap;
        if (comicIdMap) {
          const libraryComic = comicIdMap.get(baseComic.id);

          if (libraryComic && libraryComic.mangaMode !== undefined) {
            baseComic.mangaMode = libraryComic.mangaMode;
          }

          if (libraryComic && libraryComic.continuousMode !== undefined) {
            baseComic.continuousMode = libraryComic.continuousMode;
          }
        }

        applyDisplayInfoToComic(baseComic);

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

  updateDownloadedButtonCount();

  const LibraryRender = state.LibraryRender || window.LibraryRender;
  const currentView = state.currentView || window.currentView;
  if (forceRender || (!skipRender && currentView === 'downloaded')) {
    LibraryRender?.renderDownloadedSmartList?.();
  }

  return downloadedSmartListComics;
}

export function getLatestComics() {
  return latestComics;
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

export function isComicLatest(comic) {
  if (!comic) return false;
  const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
  const updatedValue = Number(comic.updatedAt ?? comic.convertedAt ?? 0);
  return Number.isFinite(updatedValue) && updatedValue >= cutoff;
}

export function isComicDownloaded(comic) {
  if (!comic) return false;
  const downloadedComicIds = state.downloadedComicIds || window.downloadedComicIds;
  return !!(downloadedComicIds && downloadedComicIds.has(comic.id));
}

export function isComicGuided(comic) {
  if (!comic) return false;
  return comic.guidedViewStatus === 'completed';
}

export function isComicManga(comic) {
  if (!comic) return false;
  return comic.mangaMode === true || comic.mangaMode == 1;
}

export function comicMatchesActiveSmartScope(comic) {
  const scope = state.activeSmartFilter || window.activeSmartFilter;
  if (!scope) return true;
  if (scope === 'latest') return isComicLatest(comic);
  if (scope === 'downloaded') return isComicDownloaded(comic);
  if (scope === 'guided') return isComicGuided(comic);
  if (scope === 'manga') return isComicManga(comic);
  if (scope === 'non-manga') return !isComicManga(comic);
  return true;
}

const LibrarySmartLists = {
  LATEST_ADDED_DAYS,
  isComicLatest,
  isComicDownloaded,
  isComicGuided,
  isComicManga,
  comicMatchesActiveSmartScope,
  updateLatestButtonCount,
  updateDownloadedButtonCount,
  updateGuidedButtonCount,
  rebuildLatestComics,
  rebuildGuidedComics,
  rebuildMangaSmartLists,
  updateDownloadedComicProgressData,
  resolveTotalPagesForComic,
  syncDownloadedComicStatusFromLibrary,
  rebuildDownloadedComics,
  getLatestComics,
  getGuidedComics,
  getMangaComics,
  getNonMangaComics,
  getDownloadedSmartListComics,
  getDownloadedSmartListError,
  updateDownloadedSmartListComic,
};

state.LibrarySmartLists = LibrarySmartLists;
Object.assign(state, LibrarySmartLists);

state.rebuildMangaSmartLists = rebuildMangaSmartLists;
state.getMangaComics = getMangaComics;
state.getNonMangaComics = getNonMangaComics;
state.comicMatchesActiveSmartScope = comicMatchesActiveSmartScope;
state.updateDownloadedComicProgressData = updateDownloadedComicProgressData;
state.rebuildDownloadedComics = rebuildDownloadedComics;
state.updateDownloadedSmartListComic = updateDownloadedSmartListComic;

if (typeof window !== 'undefined') {
  window.LibrarySmartLists = LibrarySmartLists;
  Object.assign(window, LibrarySmartLists);
  
  window.rebuildMangaSmartLists = rebuildMangaSmartLists;
  window.getMangaComics = getMangaComics;
  window.getNonMangaComics = getNonMangaComics;
  window.comicMatchesActiveSmartScope = comicMatchesActiveSmartScope;
  window.updateDownloadedComicProgressData = updateDownloadedComicProgressData;
  window.rebuildDownloadedComics = rebuildDownloadedComics;
  window.updateDownloadedSmartListComic = updateDownloadedSmartListComic;
}
