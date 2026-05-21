import { state } from '../globals.js';
import {
  LIBRARY_CACHE_STORE,
  LIBRARY_CACHE_KEY,
  openOfflineDB,
  getCurrentUserId,
  formatBytes
} from './db-core.js';
import {
  saveLibraryCacheToDB,
  loadLibraryCacheFromDB,
  clearLibraryCacheFromDB
} from './db-library-cache.js';
import {
  saveComicToDB,
  getComicFromDB,
  getAllDownloadedComics,
  getAllDownloadedComicIds,
  removeStaleDownloads,
  clearOfflineData,
  deleteOfflineComic,
  deleteFromCache,
  getStorageInfo,
  forceStorageCleanup,
  getOfflineComicRecordById,
  updateDownloadedComicInfo
} from './db-comics.js';
import {
  saveQueueItemToDB,
  getQueueFromDB,
  removeQueueItemFromDB,
  updateQueuePriorities,
  clearCompletedQueueItems
} from './db-queue.js';
import {
  saveJWTToken,
  getJWTToken
} from './db-jwt.js';

export const OfflineDB = {
  LIBRARY_CACHE_STORE,
  LIBRARY_CACHE_KEY,
  openOfflineDB,
  getCurrentUserId,
  formatBytes,
  saveLibraryCacheToDB,
  loadLibraryCacheFromDB,
  clearLibraryCacheFromDB,
  saveComicToDB,
  getComicFromDB,
  getAllDownloadedComics,
  getAllDownloadedComicIds,
  removeStaleDownloads,
  clearOfflineData,
  deleteOfflineComic,
  deleteFromCache,
  getStorageInfo,
  forceStorageCleanup,
  getOfflineComicRecordById,
  updateDownloadedComicInfo,
  saveQueueItemToDB,
  getQueueFromDB,
  removeQueueItemFromDB,
  updateQueuePriorities,
  clearCompletedQueueItems,
  saveJWTToken,
  getJWTToken
};

// Export to state and global scope for transition compatibility
state.OfflineDB = OfflineDB;
Object.assign(state, OfflineDB);

if (typeof window !== 'undefined') {
  window.OfflineDB = OfflineDB;
  Object.assign(window, OfflineDB);
}
