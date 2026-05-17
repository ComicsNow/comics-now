(function (global) {
  'use strict';

  const OfflineDB = {
    LIBRARY_CACHE_STORE: global.LIBRARY_CACHE_STORE,
    LIBRARY_CACHE_KEY: global.LIBRARY_CACHE_KEY,
    openOfflineDB: global.openOfflineDB,
    getCurrentUserId: global.getCurrentUserId,
    formatBytes: global.formatBytes,
    
    // Library Cache
    saveLibraryCacheToDB: global.saveLibraryCacheToDB,
    loadLibraryCacheFromDB: global.loadLibraryCacheFromDB,
    clearLibraryCacheFromDB: global.clearLibraryCacheFromDB,
    
    // Comics Store
    saveComicToDB: global.saveComicToDB,
    getComicFromDB: global.getComicFromDB,
    getAllDownloadedComics: global.getAllDownloadedComics,
    getAllDownloadedComicIds: global.getAllDownloadedComicIds,
    removeStaleDownloads: global.removeStaleDownloads,
    clearOfflineData: global.clearOfflineData,
    deleteOfflineComic: global.deleteOfflineComic,
    deleteFromCache: global.deleteFromCache,
    getStorageInfo: global.getStorageInfo,
    forceStorageCleanup: global.forceStorageCleanup,
    getOfflineComicRecordById: global.getOfflineComicRecordById,
    updateDownloadedComicInfo: global.updateDownloadedComicInfo,
    
    // Download Queue
    saveQueueItemToDB: global.saveQueueItemToDB,
    getQueueFromDB: global.getQueueFromDB,
    removeQueueItemFromDB: global.removeQueueItemFromDB,
    updateQueuePriorities: global.updateQueuePriorities,
    clearCompletedQueueItems: global.clearCompletedQueueItems,
    
    // JWT Token
    saveJWTToken: global.saveJWTToken,
    getJWTToken: global.getJWTToken,
  };

  global.OfflineDB = OfflineDB;
  Object.assign(global, OfflineDB);

})(typeof window !== 'undefined' ? window : globalThis);
