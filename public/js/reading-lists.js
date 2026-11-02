/**
 * Reading Lists - Frontend functionality for managing reading lists
 */
import { state } from './globals.js';
import {
  isOffline,
  getBaseUrl,
  fetchReadingLists,
  createReadingList,
  addComicsToList,
  getReadingListDetails,
  fetchReadingListDAG,
  markListAsRead,
  removeComicsFromList,
  reorderComics
} from './reading-lists/api.js';
import {
  exportAllLists,
  exportSingleList,
  importLists
} from './reading-lists/transfer.js';
import {
  openAddToListModal,
  closeAddToListModal
} from './reading-lists/modal.js';

const ReadingLists = {
  fetchReadingLists,
  getReadingLists: fetchReadingLists,
  createReadingList,
  addComicsToList,
  getReadingListDetails,
  markListAsRead,
  removeComicsFromList,
  reorderComics,
  exportAllLists,
  exportSingleList,
  importLists,
  openAddToListModal,
  closeAddToListModal,
  fetchReadingListDAG,
  isOffline,
  getBaseUrl
};

export {
  fetchReadingLists,
  createReadingList,
  addComicsToList,
  getReadingListDetails,
  markListAsRead,
  removeComicsFromList,
  reorderComics,
  exportAllLists,
  exportSingleList,
  importLists,
  openAddToListModal,
  closeAddToListModal,
  fetchReadingListDAG,
  isOffline,
  getBaseUrl,
  ReadingLists
};

// Aliases for compatibility
ReadingLists.getReadingLists = fetchReadingLists;

state.ReadingLists = ReadingLists;

if (typeof window !== 'undefined') {
  window.ReadingLists = ReadingLists;
}
