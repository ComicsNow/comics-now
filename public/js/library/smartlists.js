import { state } from '../globals.js';
import {
  LATEST_ADDED_DAYS,
  isComicLatest,
  isComicDownloaded,
  isComicGuided,
  isComicManga,
  comicMatchesActiveSmartScope
} from './smartlists/predicates.js';
import {
  PUB_SUFFIX_REGEX,
  normalizePub,
  stemPublisher,
  isPubMatch,
  matchesPublisher,
  maybeFetchReadingLists,
  fetchAndCacheReadingLists,
  getCachedReadingLists,
  setCachedReadingLists,
  getReadingListsForPublisher,
  updateReadingListFilterButtonCount
} from './smartlists/publisher-match.js';
import {
  parseDownloadedTimestamp,
  findDownloadedComicById,
  updateDownloadedComicProgressData,
  resolveTotalPagesForComic,
  syncDownloadedComicStatusFromLibrary,
  rebuildDownloadedComics,
  getDownloadedSmartListComics,
  getDownloadedSmartListError,
  updateDownloadedSmartListComic
} from './smartlists/downloaded.js';
import {
  updateLatestButtonCount,
  updateDownloadedButtonCount,
  updateGuidedButtonCount,
  updateMangaFilterButtonCount,
  rebuildMangaSmartLists,
  getMangaComics,
  getNonMangaComics,
  rebuildGuidedComics,
  getGuidedComics,
  rebuildLatestComics,
  getLatestComics
} from './smartlists/counters.js';
import {
  fetchStoryArcsForPublisher,
  getStoryArcsForPublisher,
  fetchAllStoryArcs,
  getAllStoryArcs,
  updateStoryArcFilterButtonCount
} from './smartlists/story-arcs.js';

export {
  LATEST_ADDED_DAYS,
  isComicLatest,
  isComicDownloaded,
  isComicGuided,
  isComicManga,
  comicMatchesActiveSmartScope,
  PUB_SUFFIX_REGEX,
  normalizePub,
  stemPublisher,
  isPubMatch,
  matchesPublisher,
  maybeFetchReadingLists,
  fetchAndCacheReadingLists,
  getCachedReadingLists,
  setCachedReadingLists,
  getReadingListsForPublisher,
  updateReadingListFilterButtonCount,
  fetchStoryArcsForPublisher,
  getStoryArcsForPublisher,
  fetchAllStoryArcs,
  getAllStoryArcs,
  updateStoryArcFilterButtonCount,
  parseDownloadedTimestamp,
  findDownloadedComicById,
  updateDownloadedComicProgressData,
  resolveTotalPagesForComic,
  syncDownloadedComicStatusFromLibrary,
  rebuildDownloadedComics,
  getDownloadedSmartListComics,
  getDownloadedSmartListError,
  updateDownloadedSmartListComic,
  updateLatestButtonCount,
  updateDownloadedButtonCount,
  updateGuidedButtonCount,
  updateMangaFilterButtonCount,
  rebuildMangaSmartLists,
  getMangaComics,
  getNonMangaComics,
  rebuildGuidedComics,
  getGuidedComics,
  rebuildLatestComics,
  getLatestComics
};

const _fetchStoryArcs = typeof fetchStoryArcsForPublisher !== 'undefined' ? fetchStoryArcsForPublisher : () => Promise.resolve([]);
const _getStoryArcs = typeof getStoryArcsForPublisher !== 'undefined' ? getStoryArcsForPublisher : () => [];
const _fetchAllStoryArcs = typeof fetchAllStoryArcs !== 'undefined' ? fetchAllStoryArcs : () => Promise.resolve([]);
const _getAllStoryArcs = typeof getAllStoryArcs !== 'undefined' ? getAllStoryArcs : () => [];
const _updateStoryArcBtn = typeof updateStoryArcFilterButtonCount !== 'undefined' ? updateStoryArcFilterButtonCount : () => {};

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
  updateReadingListFilterButtonCount,
  fetchStoryArcsForPublisher: _fetchStoryArcs,
  getStoryArcsForPublisher: _getStoryArcs,
  fetchAllStoryArcs: _fetchAllStoryArcs,
  getAllStoryArcs: _getAllStoryArcs,
  updateStoryArcFilterButtonCount: _updateStoryArcBtn,
  getReadingListsForPublisher,
  fetchAndCacheReadingLists,
  getCachedReadingLists,
  setCachedReadingLists
};

export default LibrarySmartLists;

state.LibrarySmartLists = LibrarySmartLists;
Object.assign(state, LibrarySmartLists);

state.rebuildMangaSmartLists = rebuildMangaSmartLists;
state.getMangaComics = getMangaComics;
state.getNonMangaComics = getNonMangaComics;
state.comicMatchesActiveSmartScope = comicMatchesActiveSmartScope;
state.updateDownloadedComicProgressData = updateDownloadedComicProgressData;
state.rebuildDownloadedComics = rebuildDownloadedComics;
state.updateDownloadedSmartListComic = updateDownloadedSmartListComic;
state.updateReadingListFilterButtonCount = updateReadingListFilterButtonCount;
state.getReadingListsForPublisher = getReadingListsForPublisher;

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
  window.updateReadingListFilterButtonCount = updateReadingListFilterButtonCount;
  window.getReadingListsForPublisher = getReadingListsForPublisher;
}
