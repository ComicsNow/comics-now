import {
  state,
  latestAddedCountSpan,
  downloadedCountSpan
} from '../../globals.js';
import { LATEST_ADDED_DAYS } from './predicates.js';
import { getDownloadedSmartListComics } from './downloaded.js';
import { updateReadingListFilterButtonCount } from './publisher-match.js';
import { updateStoryArcFilterButtonCount } from './story-arcs.js';

let latestComics = [];
let guidedComics = [];
let mangaComics = [];
let nonMangaComics = [];

function getSpanLatest() {
  if (typeof latestAddedCountSpan !== 'undefined' && latestAddedCountSpan) return latestAddedCountSpan;
  return typeof document !== 'undefined' ? document.getElementById('latest-added-count') : null;
}

function getSpanDownloaded() {
  if (typeof downloadedCountSpan !== 'undefined' && downloadedCountSpan) return downloadedCountSpan;
  return typeof document !== 'undefined' ? document.getElementById('downloaded-count') : null;
}

export function getComicsInCurrentContext() {
  const library = state?.library || (typeof window !== 'undefined' ? window.library : null);
  const currentRootFolder = state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null);
  const currentPublisher = state?.currentPublisher || (typeof window !== 'undefined' ? window.currentPublisher : null);
  const currentSeries = state?.currentSeries || (typeof window !== 'undefined' ? window.currentSeries : null);

  if (!library || typeof library !== 'object') {
    const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
    return comicIdMap && comicIdMap.size > 0 ? Array.from(comicIdMap.values()) : [];
  }

  const normalizedFolder = currentRootFolder ? currentRootFolder.replace(/[\\\/]+$/, '') : '';
  const rootData = currentRootFolder ? (library[currentRootFolder] || library[normalizedFolder] || library[normalizedFolder + '/']) : null;

  if (currentSeries && currentPublisher) {
    if (rootData?.publishers?.[currentPublisher]?.series?.[currentSeries]) {
      const list = rootData.publishers[currentPublisher].series[currentSeries];
      return Array.isArray(list) ? list : [];
    }
    for (const r of Object.values(library)) {
      const list = r?.publishers?.[currentPublisher]?.series?.[currentSeries];
      if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
  }

  const flattenSeries = (sObj) => sObj ? Object.values(sObj).flat().filter(Boolean) : [];

  if (currentPublisher) {
    if (rootData?.publishers?.[currentPublisher]?.series) {
      return flattenSeries(rootData.publishers[currentPublisher].series);
    }
    for (const r of Object.values(library)) {
      const p = r?.publishers?.[currentPublisher];
      if (p?.series) {
        const out = flattenSeries(p.series);
        if (out.length > 0) return out;
      }
    }
    return [];
  }

  function extractComics(pubs) {
    const res = [];
    if (!pubs) return res;
    for (const pub of Object.values(pubs)) {
      if (pub?.series) {
        for (const s of Object.values(pub.series)) {
          if (Array.isArray(s)) res.push(...s);
        }
      }
    }
    return res;
  }

  if (rootData?.publishers) {
    return extractComics(rootData.publishers);
  }

  const out = [];
  for (const r of Object.values(library)) {
    if (r?.publishers) out.push(...extractComics(r.publishers));
  }
  if (out.length > 0) return out;

  const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
  if (comicIdMap && comicIdMap.size > 0) {
    return Array.from(comicIdMap.values());
  }

  return [];
}

export function updateLatestButtonCount() {
  const isInbox = (state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null)) === 'Smart Inbox';
  const latestBtn = typeof document !== 'undefined' ? document.getElementById('latest-added-btn') : null;
  const downloadedBtn = typeof document !== 'undefined' ? document.getElementById('downloaded-btn') : null;
  const spanLatest = getSpanLatest();
  const spanDownloaded = getSpanDownloaded();

  if (isInbox) {
    const library = state?.library || (typeof window !== 'undefined' ? window.library : null);
    const rootData = library?.[state?.currentRootFolder || 'Smart Inbox'];
    let successfulCount = 0;
    let failedCount = 0;
    if (rootData && rootData.publishers) {
      for (const pubName of Object.keys(rootData.publishers)) {
        const pub = rootData.publishers[pubName];
        if (pub && pub.series) {
          for (const seriesName of Object.keys(pub.series)) {
            const seriesComics = pub.series[seriesName];
            if (Array.isArray(seriesComics)) {
              for (const comic of seriesComics) {
                if (comic.tagStatus === 'successful') {
                  successfulCount++;
                } else if (comic.tagStatus === 'failed') {
                  failedCount++;
                }
              }
            }
          }
        }
      }
    }

    if (spanLatest) {
      spanLatest.textContent = successfulCount.toString();
    }
    if (spanDownloaded) {
      spanDownloaded.textContent = failedCount.toString();
    }

    if (latestBtn) {
      const lbl = latestBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Successful';
      latestBtn.classList.remove('hidden');
    }
    if (downloadedBtn) {
      const lbl = downloadedBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Failed';
      downloadedBtn.classList.remove('hidden');
    }

    const guidedBtn = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-btn') : null;
    if (guidedBtn) guidedBtn.classList.add('hidden');

    const mangaBtn = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-btn') : null;
    if (mangaBtn) mangaBtn.classList.add('hidden');
  } else {
    const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
    if (latestBtn) {
      const lbl = latestBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'New';
    }

    const contextComics = getComicsInCurrentContext();
    const totalInView = contextComics.length;

    const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
    const newCount = contextComics.filter(c => {
      const updatedValue = Number(c.updatedAt ?? c.convertedAt ?? 0);
      return Number.isFinite(updatedValue) && updatedValue > 0 && updatedValue >= cutoff;
    }).length;

    if (spanLatest) {
      spanLatest.textContent = newCount.toString();
    }
    const showNew = currentView !== 'root' && newCount > 0 && newCount < totalInView;
    if (latestBtn) latestBtn.classList.toggle('hidden', !showNew);
    if (!showNew && state.activeSmartFilter === 'latest') {
      state.activeSmartFilter = null;
      if (typeof window !== 'undefined') window.activeSmartFilter = null;
    }

    updateDownloadedButtonCount();
    updateGuidedButtonCount();
    updateMangaFilterButtonCount();
    updateReadingListFilterButtonCount();
    if (typeof updateStoryArcFilterButtonCount === 'function') {
      updateStoryArcFilterButtonCount();
    }
  }
}

export function updateDownloadedButtonCount() {
  const isInbox = (state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null)) === 'Smart Inbox';
  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  const downloadedBtn = typeof document !== 'undefined' ? document.getElementById('downloaded-btn') : null;
  const spanDownloaded = getSpanDownloaded();
  if (downloadedBtn) {
    const lbl = downloadedBtn.querySelector('.pill-label');
    if (lbl) lbl.textContent = 'Down';
  }

  const contextComics = getComicsInCurrentContext();
  const totalInView = contextComics.length;

  const downloadedList = getDownloadedSmartListComics() || [];
  const downloadedIds = new Set(downloadedList.map(c => String(c.id)));
  const downloadedCount = contextComics.filter(c => downloadedIds.has(String(c.id))).length;

  if (spanDownloaded) {
    spanDownloaded.textContent = downloadedCount.toString();
  }
  const showDownloaded = !isInbox && currentView !== 'root' && downloadedCount > 0 && downloadedCount < totalInView;
  if (downloadedBtn) downloadedBtn.classList.toggle('hidden', !showDownloaded);
  if (!showDownloaded && state.activeSmartFilter === 'downloaded') {
    state.activeSmartFilter = null;
    if (typeof window !== 'undefined') window.activeSmartFilter = null;
  }
}

export function updateGuidedButtonCount() {
  const isInbox = (state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null)) === 'Smart Inbox';
  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);
  const btn = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-btn') : null;
  const span = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-count') : null;

  const contextComics = getComicsInCurrentContext();
  const totalInView = contextComics.length;
  const guidedCount = contextComics.filter(c => c && c.guidedViewStatus === 'completed').length;

  if (span) span.textContent = guidedCount.toString();
  const showGuided = !isInbox && currentView !== 'root' && guidedCount > 0 && guidedCount < totalInView;
  if (btn) btn.classList.toggle('hidden', !showGuided);
  if (!showGuided && state.activeSmartFilter === 'guided') {
    state.activeSmartFilter = null;
    if (typeof window !== 'undefined') window.activeSmartFilter = null;
  }
}

export function updateMangaFilterButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-count') : null;
  const label = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-label') : null;
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-btn') : null;
  if (!btn) return;

  const isInbox = (state?.currentRootFolder || (typeof window !== 'undefined' ? window.currentRootFolder : null)) === 'Smart Inbox';
  const currentView = state?.currentView || (typeof window !== 'undefined' ? window.currentView : null);

  const isMangaDefault = state?.mangaModePreference === true || (typeof window !== 'undefined' ? window.mangaModePreference === true : false);
  const contextComics = getComicsInCurrentContext();
  const totalInView = contextComics.length;

  let matchCount = 0;
  if (isMangaDefault) {
    if (label) label.textContent = 'Non-Manga';
    matchCount = contextComics.filter(c => c && c.mangaMode !== true).length;
  } else {
    if (label) label.textContent = 'Manga';
    matchCount = contextComics.filter(c => c && c.mangaMode === true).length;
  }

  if (span) span.textContent = matchCount.toString();
  const showManga = !isInbox && currentView !== 'root' && matchCount > 0 && matchCount < totalInView;
  btn.classList.toggle('hidden', !showManga);
  if (!showManga && (state.activeSmartFilter === 'manga' || state.activeSmartFilter === 'non-manga')) {
    state.activeSmartFilter = null;
    if (typeof window !== 'undefined') window.activeSmartFilter = null;
  }
}

export function rebuildMangaSmartLists() {
  const manga = [];
  const nonManga = [];
  
  const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
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
  const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
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

  const comicIdMap = state?.comicIdMap || (typeof window !== 'undefined' ? window.comicIdMap : null);
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

export function getLatestComics() {
  return latestComics;
}
