import { state } from '../../globals.js';

export const LATEST_ADDED_DAYS = 14;

export function isComicLatest(comic) {
  if (!comic) return false;
  const cutoff = Date.now() - (LATEST_ADDED_DAYS * 24 * 60 * 60 * 1000);
  const updatedValue = Number(comic.updatedAt ?? comic.convertedAt ?? 0);
  return Number.isFinite(updatedValue) && updatedValue >= cutoff;
}

export function isComicDownloaded(comic) {
  if (!comic) return false;
  const downloadedComicIds = state?.downloadedComicIds || (typeof window !== 'undefined' ? window.downloadedComicIds : null);
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
  const scope = state?.activeSmartFilter || (typeof window !== 'undefined' ? window.activeSmartFilter : null);
  if (!scope) return true;
  if (scope === 'successful') return comic.tagStatus === 'successful';
  if (scope === 'failed') return comic.tagStatus === 'failed';
  if (scope === 'latest') return isComicLatest(comic);
  if (scope === 'downloaded') return isComicDownloaded(comic);
  if (scope === 'guided') return isComicGuided(comic);
  if (scope === 'manga') return isComicManga(comic);
  if (scope === 'non-manga') return !isComicManga(comic);
  return true;
}
