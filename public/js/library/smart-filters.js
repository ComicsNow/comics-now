import { state } from '../globals.js';
import {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  setReadingListFilterButtonActive,
  clearSmartFilterButtons,
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  hideSmartFilterHost
} from './filters/buttons.js';
import {
  collectDrillInComicIds,
  scopeListByDrillIn,
  buildSmartListBreadcrumb,
  filterComicsByStatus
} from './filters/predicate.js';
import {
  showLatestAddedSmartList,
  showDownloadedSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  showGuidedSmartList,
  renderGuidedSmartList,
  showMangaSmartList,
  renderMangaSmartList
} from './filters/views.js';

export {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  setReadingListFilterButtonActive,
  clearSmartFilterButtons,
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  hideSmartFilterHost,
  collectDrillInComicIds,
  scopeListByDrillIn,
  buildSmartListBreadcrumb,
  filterComicsByStatus,
  showLatestAddedSmartList,
  showDownloadedSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  showGuidedSmartList,
  renderGuidedSmartList,
  showMangaSmartList,
  renderMangaSmartList
};

const LibrarySmartFilters = {
  setLatestButtonActive,
  setDownloadedButtonActive,
  setGuidedButtonActive,
  setMangaFilterButtonActive,
  setReadingListFilterButtonActive,
  clearSmartFilterButtons,
  syncSmartFilterButtons,
  mountSmartFilterHostInto,
  hideSmartFilterHost,
  collectDrillInComicIds,
  scopeListByDrillIn,
  buildSmartListBreadcrumb,
  filterComicsByStatus,
  showLatestAddedSmartList,
  showDownloadedSmartList,
  renderLatestSmartList,
  renderDownloadedSmartList,
  showGuidedSmartList,
  renderGuidedSmartList,
  showMangaSmartList,
  renderMangaSmartList
};

state.LibrarySmartFilters = LibrarySmartFilters;
Object.assign(state, LibrarySmartFilters);

if (typeof window !== 'undefined') {
  window.LibrarySmartFilters = LibrarySmartFilters;
  Object.assign(window, LibrarySmartFilters);
}
