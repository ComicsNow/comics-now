import { state, debugLog } from './globals.js';
import {
  saveProgressToDB,
  updateOfflineProgressForComic,
  updateOfflineProgressForSeries
} from './progress/db.js';
import {
  updateLibraryProgress,
  updateLazyLoadingCounts
} from './progress/library-sync.js';
import {
  updateCardBanner,
  updateSeriesBanner,
  toggleReadStatus
} from './progress/ui.js';

export function initializeProgressTracking() {
  if (typeof debugLog === 'function') debugLog('PROGRESS', 'Progress tracking initialized');
}

export {
  saveProgressToDB,
  updateLibraryProgress,
  updateOfflineProgressForComic,
  updateOfflineProgressForSeries,
  updateLazyLoadingCounts,
  updateCardBanner,
  updateSeriesBanner,
  toggleReadStatus
};

state.saveProgressToDB = saveProgressToDB;
state.updateLibraryProgress = updateLibraryProgress;
state.updateLazyLoadingCounts = updateLazyLoadingCounts;
state.toggleReadStatus = toggleReadStatus;
state.updateCardBanner = updateCardBanner;
state.updateSeriesBanner = updateSeriesBanner;

if (typeof window !== 'undefined') {
  window.saveProgressToDB = saveProgressToDB;
  window.updateLibraryProgress = updateLibraryProgress;
  window.updateLazyLoadingCounts = updateLazyLoadingCounts;
  window.toggleReadStatus = toggleReadStatus;
  window.updateCardBanner = updateCardBanner;
  window.updateSeriesBanner = updateSeriesBanner;
}
