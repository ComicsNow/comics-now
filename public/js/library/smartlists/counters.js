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
    }
    if (downloadedBtn) {
      const lbl = downloadedBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Failed';
    }

    const guidedBtn = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-btn') : null;
    if (guidedBtn) guidedBtn.classList.add('hidden');

    const mangaBtn = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-btn') : null;
    if (mangaBtn) mangaBtn.classList.add('hidden');
  } else {
    if (latestBtn) {
      const lbl = latestBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'New';
    }
    if (downloadedBtn) {
      const lbl = downloadedBtn.querySelector('.pill-label');
      if (lbl) lbl.textContent = 'Down';
    }

    const guidedBtn = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-btn') : null;
    if (guidedBtn) guidedBtn.classList.remove('hidden');

    updateMangaFilterButtonCount();
    updateReadingListFilterButtonCount();
    if (typeof updateStoryArcFilterButtonCount === 'function') {
      updateStoryArcFilterButtonCount();
    }

    if (spanLatest) {
      spanLatest.textContent = latestComics.length.toString();
    }
    if (spanDownloaded) {
      const downloadedList = getDownloadedSmartListComics();
      spanDownloaded.textContent = (Array.isArray(downloadedList)
        ? downloadedList.length
        : 0).toString();
    }
  }
}

export function updateDownloadedButtonCount() {
  updateLatestButtonCount();
}

export function updateGuidedButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('guided-smart-list-count') : null;
  if (span) span.textContent = (Array.isArray(guidedComics) ? guidedComics.length : 0).toString();
}

export function updateMangaFilterButtonCount() {
  const span = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-count') : null;
  const label = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-label') : null;
  const btn = typeof document !== 'undefined' ? document.getElementById('dynamic-manga-filter-btn') : null;
  if (!span || !label || !btn) return;

  const isMangaDefault = state?.mangaModePreference === true || (typeof window !== 'undefined' ? window.mangaModePreference === true : false);
  
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
