import { state } from '../globals.js';
import {
  getComicStatus,
  getSeriesStatus,
  createEmptyStatusCounts,
  addStatusCounts,
  getComicStatusCounts,
  getPublisherStatusCounts,
  getRootStatusCounts,
  getLibraryStatusCounts,
  statusCountsMatchFilter,
  filterPublishersByActiveFilter,
  filterSeriesByActiveFilter
} from './status/calculator.js';
import {
  updateFilterButtonCounts,
  updateLibraryReadStatus
} from './status/dom-sync.js';

export {
  getComicStatus,
  getSeriesStatus,
  createEmptyStatusCounts,
  addStatusCounts,
  getComicStatusCounts,
  getPublisherStatusCounts,
  getRootStatusCounts,
  getLibraryStatusCounts,
  statusCountsMatchFilter,
  filterPublishersByActiveFilter,
  filterSeriesByActiveFilter,
  updateFilterButtonCounts,
  updateLibraryReadStatus
};

const LibraryStatus = {
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
};

export default LibraryStatus;

state.LibraryStatus = LibraryStatus;
Object.assign(state, LibraryStatus);

state.getComicStatus = getComicStatus;
state.getSeriesStatus = getSeriesStatus;
state.getComicStatusCounts = getComicStatusCounts;
state.updateLibraryReadStatus = updateLibraryReadStatus;

if (typeof window !== 'undefined') {
  window.LibraryStatus = LibraryStatus;
  Object.assign(window, LibraryStatus);

  window.getComicStatus = getComicStatus;
  window.getSeriesStatus = getSeriesStatus;
  window.getComicStatusCounts = getComicStatusCounts;
  window.updateLibraryReadStatus = updateLibraryReadStatus;
}
