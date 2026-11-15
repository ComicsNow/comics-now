import { state } from '../globals.js';
import {
  isIdInLibrary,
  getComicFromDB,
  getAllDownloadedComics,
  getAllDownloadedComicIds,
  getOfflineComicRecordById
} from './db/comic-reader.js';
import {
  getAllDownloadedComicMetadata,
  getOfflineComicMetaById
} from './db/comic-meta.js';
import {
  saveComicToDB,
  updateDownloadedComicInfo
} from './db/comic-writer.js';
import {
  deleteFromCache,
  deleteOfflineComic,
  clearOfflineData,
  removeStaleDownloads,
  getStorageInfo,
  forceStorageCleanup
} from './db/comic-cleanup.js';

export {
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
  getAllDownloadedComicMetadata,
  getOfflineComicMetaById,
  updateDownloadedComicInfo,
  isIdInLibrary
};

if (typeof state !== 'undefined') {
  state.saveComicToDB = saveComicToDB;
  state.getComicFromDB = getComicFromDB;
  state.getAllDownloadedComics = getAllDownloadedComics;
  state.getAllDownloadedComicIds = getAllDownloadedComicIds;
  state.removeStaleDownloads = removeStaleDownloads;
  state.clearOfflineData = clearOfflineData;
  state.deleteOfflineComic = deleteOfflineComic;
  state.deleteFromCache = deleteFromCache;
  state.getStorageInfo = getStorageInfo;
  state.forceStorageCleanup = forceStorageCleanup;
  state.getOfflineComicRecordById = getOfflineComicRecordById;
  state.getAllDownloadedComicMetadata = getAllDownloadedComicMetadata;
  state.getOfflineComicMetaById = getOfflineComicMetaById;
  state.updateDownloadedComicInfo = updateDownloadedComicInfo;
  state.isIdInLibrary = isIdInLibrary;
}

if (typeof window !== 'undefined') {
  window.saveComicToDB = saveComicToDB;
  window.getComicFromDB = getComicFromDB;
  window.getAllDownloadedComics = getAllDownloadedComics;
  window.getAllDownloadedComicIds = getAllDownloadedComicIds;
  window.removeStaleDownloads = removeStaleDownloads;
  window.clearOfflineData = clearOfflineData;
  window.deleteOfflineComic = deleteOfflineComic;
  window.deleteFromCache = deleteFromCache;
  window.getStorageInfo = getStorageInfo;
  window.forceStorageCleanup = forceStorageCleanup;
  window.getOfflineComicRecordById = getOfflineComicRecordById;
  window.getAllDownloadedComicMetadata = getAllDownloadedComicMetadata;
  window.getOfflineComicMetaById = getOfflineComicMetaById;
  window.updateDownloadedComicInfo = updateDownloadedComicInfo;
  window.isIdInLibrary = isIdInLibrary;
}
