import { state } from '../../globals.js';

import {
  isOrderBySeriesDate,
  getComicIssueNumber,
  getComicPublishedDate,
  getFirstComicInSeries,
  getSeriesPublishedInfo,
  initSeriesSortControls,
  setSeriesSortOrder
} from './series-sort.js';

import { showRootFolderList } from './root-folders.js';
import { showPublisherList, renderPublisherCards } from './publishers.js';
import {
  showSeriesList,
  renderPublisherReadingLists,
  renderPublisherStoryArcs,
  renderSeriesCards,
  getSeriesStatusBanner
} from './series.js';
import { showComicList, renderComicCards } from './comics.js';

import {
  getComicStatus,
  getSeriesStatus,
  getComicStatusCounts,
  createEmptyStatusCounts,
  addStatusCounts,
  getPublisherStatusCounts,
  getRootStatusCounts,
  getLibraryStatusCounts,
  statusCountsMatchFilter,
  filterPublishersByActiveFilter,
  filterSeriesByActiveFilter,
  updateFilterButtonCounts,
  updateLibraryReadStatus
} from '../status.js';

import { updateBreadcrumb } from '../breadcrumb.js';
import { renderAllComicsAsList, renderAlphaFilter, applyFilterAndRender } from '../alpha-list.js';
import { showSearchView, rerenderSearchResults, searchLibraryLocally } from '../search.js';
import {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  clearSmartFilterButtons,
  showLatestAddedSmartList,
  showDownloadedSmartList,
  showGuidedSmartList,
  showMangaSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  renderGuidedSmartList,
  renderMangaSmartList,
  syncSmartFilterButtons,
  mountSmartFilterHostInto
} from '../smart-filters.js';

export {
  searchLibraryLocally,
  isOrderBySeriesDate,
  getComicIssueNumber,
  getComicPublishedDate,
  getFirstComicInSeries,
  getSeriesPublishedInfo,
  initSeriesSortControls,
  setSeriesSortOrder,
  showRootFolderList,
  showPublisherList,
  renderPublisherCards,
  showSeriesList,
  renderPublisherReadingLists,
  renderPublisherStoryArcs,
  renderSeriesCards,
  getSeriesStatusBanner,
  showComicList,
  renderComicCards
};

export const LibraryRender = {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  clearSmartFilterButtons,
  showLatestAddedSmartList,
  showDownloadedSmartList,
  showGuidedSmartList,
  showMangaSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  renderGuidedSmartList,
  renderMangaSmartList,
  renderAllComicsAsList,
  applyFilterAndRender,
  renderAlphaFilter,
  getComicStatus,
  getSeriesStatus,
  getComicStatusCounts,
  createEmptyStatusCounts,
  addStatusCounts,
  getPublisherStatusCounts,
  getRootStatusCounts,
  getLibraryStatusCounts,
  statusCountsMatchFilter,
  filterPublishersByActiveFilter,
  filterSeriesByActiveFilter,
  updateFilterButtonCounts,
  showRootFolderList,
  renderPublisherCards,
  showPublisherList,
  renderSeriesCards,
  renderPublisherReadingLists,
  showSeriesList,
  getSeriesStatusBanner,
  renderComicCards,
  showComicList,
  showSearchView,
  rerenderSearchResults,
  updateLibraryReadStatus,
  updateBreadcrumb,
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  searchLibraryLocally,
  isOrderBySeriesDate,
  getComicIssueNumber,
  getComicPublishedDate,
  getFirstComicInSeries,
  getSeriesPublishedInfo,
  initSeriesSortControls,
  setSeriesSortOrder
};

// Register on state & window for backward compatibility
if (state) {
  state.LibraryRender = LibraryRender;
  Object.assign(state, LibraryRender);
}
if (typeof window !== 'undefined') {
  window.LibraryRender = LibraryRender;
  Object.assign(window, LibraryRender);
}

export default LibraryRender;
