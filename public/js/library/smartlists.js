(function (global) {
  'use strict';

  const LATEST_ADDED_DAYS = 14;

  let latestComics = [];
  let downloadedSmartListComics = [];
  let downloadedSmartListError = null;
  let guidedComics = [];
  let mangaComics = [];
  let nonMangaComics = [];

  function updateLatestButtonCount() {
    if (latestAddedCountSpan) {
      latestAddedCountSpan.textContent = latestComics.length.toString();
    }
  }

  function updateDownloadedButtonCount() {
    if (downloadedCountSpan) {
      downloadedCountSpan.textContent = (Array.isArray(downloadedSmartListComics)
        ? downloadedSmartListComics.length
        : 0).toString();
    }
  }

  function updateGuidedButtonCount() {
    const span = document.getElementById('guided-smart-list-count');
    if (span) span.textContent = (Array.isArray(guidedComics) ? guidedComics.length : 0).toString();
  }

  function updateMangaFilterButtonCount() {
    const span = document.getElementById('dynamic-manga-filter-count');
    const label = document.getElementById('dynamic-manga-filter-label');
    const btn = document.getElementById('dynamic-manga-filter-btn');
    if (!span || !label || !btn) return;

    // Use loose truthy check for the preference
    const isMangaDefault = !!(global.mangaModePreference === true || global.mangaModePreference == 1);
    
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

  function rebuildMangaSmartLists() {
    const manga = [];
    const nonManga = [];
    if (library && typeof library === 'object') {
      for (const rootFolder of Object.keys(library)) {
        const publishers = library[rootFolder]?.publishers || {};
        for (const publisherName of Object.keys(publishers)) {
          const seriesEntries = publishers[publisherName]?.series || {};
          for (const seriesName of Object.keys(seriesEntries)) {
            const comics = seriesEntries[seriesName];
            if (!Array.isArray(comics)) continue;
            for (const comic of comics) {
              // Loose check for mangaMode (0/1 or true/false)
              if (comic.mangaMode === true || comic.mangaMode == 1) {
                manga.push(comic);
              } else {
                nonManga.push(comic);
              }
            }
          }
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

  function getMangaComics() { return mangaComics; }
  function getNonMangaComics() { return nonMangaComics; }

  function rebuildGuidedComics() {
    const out = [];
    if (library && typeof library === 'object') {
      for (const rootFolder of Object.keys(library)) {
        const publishers = library[rootFolder]?.publishers || {};
        for (const publisherName of Object.keys(publishers)) {
          const seriesEntries = publishers[publisherName]?.series || {};
          for (const seriesName of Object.keys(seriesEntries)) {
            const comics = seriesEntries[seriesName];
            if (!Array.isArray(comics)) continue;
            for (const comic of comics) {
              if (comic.guidedViewStatus === 'completed') out.push(comic);
            }
          }
        }
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

  function getGuidedComics() { return guidedComics; }

  function rebuildLatestComics() {
    const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
    const recentComics = [];

    if (library && typeof library === 'object') {
      for (const rootFolder of Object.keys(library)) {
        const publishers = library[rootFolder]?.publishers || {};
        for (const publisherName of Object.keys(publishers)) {
          const seriesEntries = publishers[publisherName]?.series || {};
          for (const seriesName of Object.keys(seriesEntries)) {
            const comics = seriesEntries[seriesName];
            if (!Array.isArray(comics)) continue;
            for (const comic of comics) {
              const updatedValue = Number(comic.updatedAt ?? comic.convertedAt ?? 0);
              if (!Number.isFinite(updatedValue) || updatedValue <= 0) continue;
              if (updatedValue >= cutoff) {
                recentComics.push(comic);
              }
            }
          }
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


  function parseDownloadedTimestamp(value) {
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

  function findDownloadedComicById(comicId) {
    if (!Array.isArray(downloadedSmartListComics) || downloadedSmartListComics.length === 0) {
      return null;
    }
    const idStr = comicId == null ? null : String(comicId);
    if (!idStr) {
      return null;
    }
    return downloadedSmartListComics.find(entry => String(entry.id) === idStr) || null;
  }

  function updateDownloadedComicProgressData(comicId, progress = {}) {
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

  function resolveTotalPagesForComic(comic) {
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

  function syncDownloadedComicStatusFromLibrary(comic, normalizedStatus) {
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

  async function rebuildDownloadedComics(options = {}) {
    const { skipRender = false, forceRender = false } = options || {};

    if (typeof getAllDownloadedComics !== 'function') {
      downloadedSmartListComics = [];
      downloadedSmartListError = new Error('Offline downloads unavailable');
      updateDownloadedButtonCount();
      if (forceRender || (!skipRender && currentView === 'downloaded')) {
        global.LibraryRender?.renderDownloadedSmartList?.();
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

          // Sync manga mode from library if available (similar to read status sync)
          if (typeof global !== 'undefined' && typeof global.library !== 'undefined') {
            let libraryComic = null;
            for (const rootFolder of Object.keys(global.library)) {
              const publishers = global.library[rootFolder]?.publishers || {};
              for (const publisherName of Object.keys(publishers)) {
                const seriesEntries = publishers[publisherName]?.series || {};
                for (const seriesName of Object.keys(seriesEntries)) {
                  const comics = seriesEntries[seriesName];
                  if (Array.isArray(comics)) {
                    libraryComic = comics.find(c => c.id === baseComic.id);
                    if (libraryComic) break;
                  }
                }
                if (libraryComic) break;
              }
              if (libraryComic) break;
            }

            // Sync manga mode from library if found
            if (libraryComic && libraryComic.mangaMode !== undefined) {
              baseComic.mangaMode = libraryComic.mangaMode;
            }

            // Sync continuous mode from library if found
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

    if (forceRender || (!skipRender && currentView === 'downloaded')) {
      global.LibraryRender?.renderDownloadedSmartList?.();
    }

    return downloadedSmartListComics;
  }

  function getLatestComics() {
    return latestComics;
  }


  function getDownloadedSmartListComics() {
    return downloadedSmartListComics;
  }

  function getDownloadedSmartListError() {
    return downloadedSmartListError;
  }

  function updateDownloadedSmartListComic(comicId, updates) {
    if (!comicId || !updates) return false;

    const target = findDownloadedComicById(comicId);
    if (!target) return false;

    Object.assign(target, updates);
    return true;
  }

  function isComicLatest(comic) {
    if (!comic) return false;
    const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
    const updatedValue = Number(comic.updatedAt ?? comic.convertedAt ?? 0);
    return Number.isFinite(updatedValue) && updatedValue >= cutoff;
  }

  function isComicDownloaded(comic) {
    if (!comic) return false;
    return !!(global.downloadedComicIds && global.downloadedComicIds.has(comic.id));
  }

  function isComicGuided(comic) {
    if (!comic) return false;
    return comic.guidedViewStatus === 'completed';
  }

  function isComicManga(comic) {
    if (!comic) return false;
    return comic.mangaMode === true || comic.mangaMode == 1;
  }

  // Predicate: does this comic belong to the currently-active smart filter scope?
  // Returns true when no scope is active (whole library).
  function comicMatchesActiveSmartScope(comic) {
    const scope = global.activeSmartFilter;
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

  global.LibrarySmartLists = LibrarySmartLists;
  Object.assign(global, {
    LATEST_ADDED_DAYS,
    updateLatestButtonCount,
    updateDownloadedButtonCount,
    updateGuidedButtonCount,
    rebuildLatestComics,
    rebuildGuidedComics,
    rebuildMangaSmartLists,
    updateDownloadedComicProgressData,
    syncDownloadedComicStatusFromLibrary,
    rebuildDownloadedComics,
    updateDownloadedSmartListComic,
  });

  global.rebuildMangaSmartLists = rebuildMangaSmartLists;
  global.getMangaComics = getMangaComics;
  global.getNonMangaComics = getNonMangaComics;
  global.comicMatchesActiveSmartScope = comicMatchesActiveSmartScope;
  global.updateDownloadedComicProgressData = updateDownloadedComicProgressData;
  global.rebuildDownloadedComics = rebuildDownloadedComics;
  global.updateDownloadedSmartListComic = updateDownloadedSmartListComic;
})(typeof window !== 'undefined' ? window : globalThis);
