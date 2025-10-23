(function (global) {
  'use strict';

  const LIBRARY_CACHE_STORE = 'library';
  const LIBRARY_CACHE_KEY = 'library-cache';

  // Helper function to get current userId synchronously
  function getCurrentUserId() {
    // Try syncManager first
    if (window.syncManager && window.syncManager.userId) {
      const userId = window.syncManager.userId;
      // Cache it in localStorage for offline access
      try {
        localStorage.setItem('comics-now-cached-user-id', userId);
      } catch (e) {
        // Ignore storage errors
      }
      return userId;
    }

    // When offline, try to get cached userId from localStorage
    try {
      const cachedUserId = localStorage.getItem('comics-now-cached-user-id');
      if (cachedUserId) {
        console.log('[OFFLINE] Using cached userId from localStorage:', cachedUserId);
        return cachedUserId;
      }
    } catch (e) {
      // Ignore storage errors
    }

    // Final fallback to default
    console.log('[OFFLINE] No cached userId found, using default-user');
    return 'default-user';
  }

  async function openOfflineDB() {
    if (db) {
      return db;
    }

    return new Promise((resolve, reject) => {
      debugLog('PROGRESS', 'Opening IndexedDB connection...');
      const request = indexedDB.open('comics-now-offline', 10);

      request.onerror = (event) => {
        
        reject(new Error(`Error opening IndexedDB: ${event.target.error}`));
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        debugLog(
          'PROGRESS',
          'IndexedDB opened successfully, object stores:',
          Array.from(db.objectStoreNames)
        );
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        debugLog(
          'PROGRESS',
          `IndexedDB upgrade needed from version ${event.oldVersion} to ${event.newVersion}`
        );
        const database = event.target.result;
        const tx = event.target.transaction;

        if (!database.objectStoreNames.contains('comics')) {
          debugLog('PROGRESS', "Creating 'comics' object store with userId index");
          const comicsStore = database.createObjectStore('comics', { keyPath: 'id' });
          comicsStore.createIndex('userId', 'userId', { unique: false });
        } else if (event.oldVersion < 7) {
          // Migration: Add userId index to existing comics store
          debugLog('PROGRESS', "Adding userId index to existing 'comics' object store");
          const comicsStore = tx.objectStore('comics');
          if (!comicsStore.indexNames.contains('userId')) {
            comicsStore.createIndex('userId', 'userId', { unique: false });
          }

          // Migrate existing comics to have userId field
          const currentUserId = getCurrentUserId();
          const getAllRequest = comicsStore.getAll();
          getAllRequest.onsuccess = () => {
            const comics = getAllRequest.result || [];
            debugLog('PROGRESS', `Migrating ${comics.length} existing comics to have userId=${currentUserId}`);
            comics.forEach(comic => {
              if (!comic.userId) {
                comic.userId = currentUserId;
                comicsStore.put(comic);
              }
            });
          };
        }

        if (!database.objectStoreNames.contains('progress')) {
          debugLog('PROGRESS', "Creating 'progress' object store");
          database.createObjectStore('progress', { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains('statuses')) {
          debugLog('PROGRESS', "Creating 'statuses' object store");
          database.createObjectStore('statuses', { keyPath: 'key' });
        }

        if (!database.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
          debugLog('PROGRESS', `Creating '${LIBRARY_CACHE_STORE}' object store`);
          database.createObjectStore(LIBRARY_CACHE_STORE, { keyPath: 'key' });
        }

        debugLog('PROGRESS', 'IndexedDB upgrade completed');
      };
    });
  }

  async function saveLibraryCacheToDB(libraryData) {
    const startTime = performance.now();
    

    if (!libraryData) return null;
    if (!db) await openOfflineDB();

    if (!db.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
      debugLog('PROGRESS', `Object store '${LIBRARY_CACHE_STORE}' missing, skipping cache save.`);
      return null;
    }

    const record = {
      key: LIBRARY_CACHE_KEY,
      data: libraryData,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([LIBRARY_CACHE_STORE], 'readwrite');
        const store = tx.objectStore(LIBRARY_CACHE_STORE);
        const request = store.put(record);

        request.onsuccess = () => {
          resolve(record);
        };
        request.onerror = (event) => {
          
          reject(event.target.error);
        };
      } catch (error) {
        
        reject(error);
      }
    });
  }

  async function loadLibraryCacheFromDB() {
    if (!db) await openOfflineDB();

    if (!db.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
      debugLog('PROGRESS', `Object store '${LIBRARY_CACHE_STORE}' missing, no cached library available.`);
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([LIBRARY_CACHE_STORE], 'readonly');
        const store = tx.objectStore(LIBRARY_CACHE_STORE);
        const request = store.get(LIBRARY_CACHE_KEY);

        request.onsuccess = (event) => {
          resolve(event.target.result || null);
        };

        request.onerror = (event) => {
          
          reject(event.target.error);
        };
      } catch (error) {
        
        reject(error);
      }
    });
  }

  async function clearLibraryCacheFromDB() {
    if (!db) await openOfflineDB();

    if (!db.objectStoreNames.contains(LIBRARY_CACHE_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([LIBRARY_CACHE_STORE], 'readwrite');
        const store = tx.objectStore(LIBRARY_CACHE_STORE);
        const request = store.delete(LIBRARY_CACHE_KEY);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
          
          reject(event.target.error);
        };
      } catch (error) {
        
        reject(error);
      }
    });
  }

  async function saveComicToDB(comic, blob) {
    if (!db) await openOfflineDB();

    // Get current userId
    const userId = getCurrentUserId();

    const comicData = {
      id: comic.id,
      userId: userId,
      comicInfo: comic,
      fileBlob: blob
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['comics'], 'readwrite');
      const store = tx.objectStore('comics');
      const request = store.put(comicData);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(new Error(`Failed to save comic: ${event.target.errorCode}`));
    });
  }

  async function getComicFromDB(comicId) {
    debugLog('PROGRESS', `getComicFromDB called for ID: ${comicId}`);
    if (!db) {
      debugLog('PROGRESS', 'DB not initialized in getComicFromDB, opening...');
      await openOfflineDB();
    }

    // Get current userId
    const currentUserId = getCurrentUserId();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['comics'], 'readonly');
        const store = tx.objectStore('comics');
        const request = store.get(comicId);

        request.onsuccess = (event) => {
          const result = event.target.result;

          // Verify userId matches (or comic has no userId for legacy support)
          if (result && result.userId && result.userId !== currentUserId) {
            debugLog('PROGRESS', `getComicFromDB - comic ${comicId} belongs to different user, denying access`);
            resolve(null);
            return;
          }

          debugLog('PROGRESS', `getComicFromDB success - found comic: ${!!result} for ID: ${comicId}`);
          resolve(result || null);
        };

        request.onerror = (event) => {
          
          reject(new Error(`Failed to get comic: ${event.target.errorCode}`));
        };
      } catch (error) {
        
        reject(error);
      }
    });
  }

  async function getAllDownloadedComics() {
    if (!db) await openOfflineDB();

    // Get current userId from syncManager or default
    const currentUserId = getCurrentUserId();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['comics', 'progress'], 'readonly');
      const comicsStore = tx.objectStore('comics');
      const progressStore = tx.objectStore('progress');

      const comicsRequest = comicsStore.getAll();
      const progressRequest = progressStore.getAll();

      let comics = [];
      const progressMap = new Map();
      let requestsCompleted = 0;

      comicsRequest.onsuccess = (event) => {
        // Filter comics by current userId
        const allComics = event.target.result || [];
        comics = allComics.filter(comic => {
          // Support both new userId field and legacy comics without userId
          return !comic.userId || comic.userId === currentUserId;
        });
        requestsCompleted++;
        if (requestsCompleted === 2) mergeAndResolve();
      };

      progressRequest.onsuccess = (event) => {
        const progressData = event.target.result || [];
        progressData.forEach(p => progressMap.set(p.id, p));
        requestsCompleted++;
        if (requestsCompleted === 2) mergeAndResolve();
      };

      function mergeAndResolve() {
        const mergedComics = comics.map((comic, index) => {
          const savedProgress = progressMap.get(comic.id);
          const fallbackProgress = comic.comicInfo?.progress || { totalPages: 0, lastReadPage: 0 };

          const progress = savedProgress ? {
            totalPages: savedProgress.totalPages || fallbackProgress.totalPages || 0,
            lastReadPage: savedProgress.lastReadPage || fallbackProgress.lastReadPage || 0,
          } : fallbackProgress;

          if (index < 2) {
            const comicInfo = comic.comicInfo || {};
            const info = applyDisplayInfoToComic(comicInfo);
            const displayName = info.displayTitle || comicInfo.name || 'Unknown Comic';
            debugLog('OFFLINE', `getAllDownloadedComics - Comic ${index} (${displayName}):`, {
              savedProgress,
              fallbackProgress,
              finalProgress: progress,
              isInProgress:
                progress.totalPages > 0 &&
                progress.lastReadPage > 0 &&
                progress.lastReadPage < progress.totalPages - 1,
            });
          }

          return {
            ...comic,
            comicInfo: {
              ...comic.comicInfo,
              progress,
            },
          };
        });

        resolve(mergedComics);
      }

      comicsRequest.onerror = () => reject(new Error('Failed to get comics from DB'));
      progressRequest.onerror = () => reject(new Error('Failed to get progress from DB'));
    });
  }

  async function getAllDownloadedComicIds() {
    console.log('[OFFLINE] getAllDownloadedComicIds called');

    if (!db) {
      console.log('[OFFLINE] DB not initialized, opening...');
      await openOfflineDB();
    }

    // Get current userId from syncManager or default
    const currentUserId = getCurrentUserId();
    console.log('[OFFLINE] Current user ID:', currentUserId);

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['comics'], 'readonly');
        const store = tx.objectStore('comics');
        const request = store.getAll();
        request.onsuccess = (event) => {
          const allComics = event.target.result || [];
          console.log('[OFFLINE] Total comics in DB:', allComics.length);

          // Filter by userId and extract IDs
          const userComicIds = allComics
            .filter(comic => !comic.userId || comic.userId === currentUserId)
            .map(comic => comic.id);

          console.log('[OFFLINE] User comics after filtering:', userComicIds.length);
          console.log('[OFFLINE] Comic IDs:', userComicIds);

          downloadedComicIds = new Set(userComicIds);

          // Also set it globally to ensure it's accessible
          if (typeof window !== 'undefined') {
            window.downloadedComicIds = downloadedComicIds;
          }

          console.log('[OFFLINE] downloadedComicIds Set updated, size:', downloadedComicIds.size);
          resolve(downloadedComicIds);
        };
        request.onerror = (event) => {
          console.error('[OFFLINE] Error getting comics from DB:', event.target.error);
          reject(new Error(`Failed to get comics: ${event.target.errorCode}`));
        };
      } catch (error) {
        console.error('[OFFLINE] Exception in getAllDownloadedComicIds:', error);
        reject(error);
      }
    });
  }

  async function removeStaleDownloads() {
    const libraryIds = new Set();

    if (library && library._isLazyLoaded) {
      debugLog('CLEANUP', 'Skipping stale download removal due to lazy loading');
      return;
    }

    for (const root of Object.values(library || {})) {
      for (const publisher of Object.values(root.publishers || {})) {
        for (const series of Object.values(publisher.series || {})) {
          if (Array.isArray(series)) {
            for (const comic of series) {
              libraryIds.add(comic.id);
            }
          }
        }
      }
    }

    let deletedCount = 0;
    for (const id of [...downloadedComicIds]) {
      if (!libraryIds.has(id)) {
        await deleteOfflineComic(id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await forceStorageCleanup();
    }
  }

  async function clearOfflineData() {
    if (!db) await openOfflineDB();

    // Get current userId from syncManager or default
    const currentUserId = getCurrentUserId();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['comics', 'progress', 'statuses'], 'readwrite');
      const comicsStore = tx.objectStore('comics');
      const progressStore = tx.objectStore('progress');
      const statusStore = tx.objectStore('statuses');

      // Get all comics and only delete those belonging to current user
      const getAllRequest = comicsStore.getAll();
      getAllRequest.onsuccess = () => {
        const allComics = getAllRequest.result || [];
        const userComics = allComics.filter(comic => !comic.userId || comic.userId === currentUserId);

        debugLog('OFFLINE', `Clearing ${userComics.length} comics for user ${currentUserId}`);

        // Delete each user comic
        userComics.forEach(comic => {
          comicsStore.delete(comic.id);
        });

        // Clear all progress and statuses (these are already user-specific via sync system)
        progressStore.clear();
        statusStore.clear();

        tx.oncomplete = () => {
          downloadedComicIds.clear();
          resolve();
        };

        tx.onerror = (event) => reject(new Error(`Failed to clear data: ${event.target.errorCode}`));
      };

      getAllRequest.onerror = (event) => {
        reject(new Error(`Failed to get comics: ${event.target.errorCode}`));
      };
    });
  }

  async function deleteOfflineComic(comicId) {
    if (!db) await openOfflineDB();

    // Get current userId from syncManager or default
    const currentUserId = getCurrentUserId();

    const originalId = comicId;
    const idStr = String(comicId);
    let idNum = null;
    if (/^\d+$/.test(idStr)) {
      idNum = Number(comicId);
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['comics', 'progress', 'statuses'], 'readwrite');
      const comicsStore = tx.objectStore('comics');
      const progressStore = tx.objectStore('progress');
      const statusStore = tx.objectStore('statuses');

      let comicDataFound = null;
      let retrievalAttempts = 0;
      const maxRetrievalAttempts = 2;

      function attemptRetrieval() {
        if (retrievalAttempts >= maxRetrievalAttempts) {
          proceedWithDeletion();
          return;
        }

        let keyToTry;
        if (retrievalAttempts === 0) {
          keyToTry = originalId;
        } else if (retrievalAttempts === 1 && idNum !== null) {
          keyToTry = idNum;
        } else {
          keyToTry = idStr;
        }

        const getRequest = comicsStore.get(keyToTry);
        getRequest.onsuccess = (event) => {
          const result = event.target.result;
          if (result) {
            // Verify userId matches (or comic has no userId for legacy support)
            if (result.userId && result.userId !== currentUserId) {
              debugLog('OFFLINE', `deleteOfflineComic - comic ${comicId} belongs to different user, denying deletion`);
              reject(new Error('Cannot delete comic belonging to different user'));
              return;
            }
            comicDataFound = result;
            proceedWithDeletion();
          } else {
            retrievalAttempts++;
            attemptRetrieval();
          }
        };
        getRequest.onerror = () => {
          retrievalAttempts++;
          attemptRetrieval();
        };
      }

      function markProgressUnsynced(key) {
        if (key === undefined || key === null) return;
        let request;
        try {
          request = progressStore.get(key);
        } catch (_) {
          return;
        }
        if (!request) return;
        request.onsuccess = (event) => {
          const record = event.target.result;
          if (!record) return;
          record.synced = false;
          record.updatedAt = new Date().toISOString();
          try {
            progressStore.put(record);
          } catch (_) {
            // ignore failures, original data remains
          }
        };
      }

      function proceedWithDeletion() {
        try { comicsStore.delete(originalId); } catch (_) {}
        if (idNum !== null) {
          try { comicsStore.delete(idNum); } catch (_) {}
        }
        try { comicsStore.delete(idStr); } catch (_) {}

        try { markProgressUnsynced(originalId); } catch (_) {}
        try { markProgressUnsynced(idStr); } catch (_) {}
        if (idNum !== null) {
          try { markProgressUnsynced(idNum); } catch (_) {}
        }

        try { statusStore.delete(`comic:${originalId}`); } catch (_) {}
        try { statusStore.delete(`comic:${idStr}`); } catch (_) {}

        tx.oncomplete = () => {
          downloadedComicIds.delete(originalId);
          downloadedComicIds.delete(idStr);
          if (idNum !== null) {
            downloadedComicIds.delete(idNum);
          }

          if (global.downloadedComicIds) {
            global.downloadedComicIds.delete(originalId);
            global.downloadedComicIds.delete(idStr);
            if (idNum !== null) {
              global.downloadedComicIds.delete(idNum);
            }
          }

          if (comicDataFound && comicDataFound.fileBlob) {
            try {
              debugLog(
                'OFFLINE',
                `Cleaning up comic blob for ID ${comicId}, size: ${comicDataFound.fileBlob.size} bytes`
              );
              comicDataFound.fileBlob = null;
            } catch (error) {
              
            }
          }

          if (typeof global.gc === 'function') {
            try {
              setTimeout(() => global.gc(), 100);
            } catch (_) {}
          }

          debugLog('OFFLINE', `Successfully deleted offline comic ${comicId} from local storage`);
          if (typeof global.scheduleOfflineProgressSync === 'function') {
            global.scheduleOfflineProgressSync(true);
          }
          resolve();
        };

        tx.onerror = (event) => {
          
          reject(new Error(`Failed to delete comic: ${event.target.errorCode}`));
        };
      }

      attemptRetrieval();
    });
  }

  async function getStorageInfo() {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      
      return { supported: false };
    }

    try {
      const estimate = await navigator.storage.estimate();
      return {
        supported: true,
        quota: estimate.quota,
        usage: estimate.usage,
        usagePercent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0,
        usageMB: Math.round(((estimate.usage || 0) / (1024 * 1024)) * 100) / 100,
        quotaMB: Math.round(((estimate.quota || 0) / (1024 * 1024)) * 100) / 100,
      };
    } catch (error) {
      
      return { supported: false, error: error.message };
    }
  }

  async function forceStorageCleanup() {
    debugLog('OFFLINE', 'Forcing storage cleanup...');

    const storageBefore = await getStorageInfo();
    if (storageBefore.supported) {
      debugLog(
        'OFFLINE',
        `Storage before cleanup: ${storageBefore.usageMB}MB / ${storageBefore.quotaMB}MB (${storageBefore.usagePercent}%)`
      );
    }

    try {
      if (global.gc && typeof global.gc === 'function') {
        global.gc();
      }

      if ('storage' in navigator && 'persist' in navigator.storage) {
        try {
          await navigator.storage.persist();
        } catch (_) {
          // ignore
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const storageAfter = await getStorageInfo();
      if (storageAfter.supported) {
        debugLog(
          'OFFLINE',
          `Storage after cleanup: ${storageAfter.usageMB}MB / ${storageAfter.quotaMB}MB (${storageAfter.usagePercent}%)`
        );

        const savedMB = storageBefore.usageMB - storageAfter.usageMB;
        if (savedMB > 0) {
          debugLog('OFFLINE', `Freed ${savedMB}MB of storage`);
        }
      }

      return storageAfter;
    } catch (error) {
      
      return storageBefore;
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  async function getOfflineComicRecordById(targetId) {
    if (targetId == null) return null;

    if (!db) {
      try {
        await openOfflineDB();
      } catch (error) {

        return null;
      }
    }

    // Get current userId from syncManager or default
    const currentUserId = getCurrentUserId();

    const keysToTry = [];
    keysToTry.push(targetId);
    const stringId = String(targetId);
    if (!keysToTry.includes(stringId)) {
      keysToTry.push(stringId);
    }
    const numericId = Number(stringId);
    if (!Number.isNaN(numericId) && !keysToTry.includes(numericId)) {
      keysToTry.push(numericId);
    }

    for (const key of keysToTry) {
      try {
        const record = await new Promise(resolve => {
          try {
            const tx = db.transaction(['comics'], 'readonly');
            const store = tx.objectStore('comics');
            const req = store.get(key);
            req.onsuccess = () => {
              const result = req.result || null;
              // Verify userId matches (or comic has no userId for legacy support)
              if (result && result.userId && result.userId !== currentUserId) {
                debugLog('PROGRESS', `getOfflineComicRecordById - comic ${key} belongs to different user, denying access`);
                resolve(null);
                return;
              }
              resolve(result);
            };
            req.onerror = () => resolve(null);
          } catch (error) {

            resolve(null);
          }
        });
        if (record) return record;
      } catch (error) {

      }
    }

    return null;
  }

  async function updateDownloadedComicInfo(comicId, updates) {
    if (!comicId || !updates) return false;

    if (!db) await openOfflineDB();

    // Get current userId
    const currentUserId = getCurrentUserId();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(['comics'], 'readwrite');
        const store = tx.objectStore('comics');
        const getRequest = store.get(comicId);

        getRequest.onsuccess = (event) => {
          const comic = event.target.result;

          if (!comic) {
            resolve(false);
            return;
          }

          // Verify userId matches (or comic has no userId for legacy support)
          if (comic.userId && comic.userId !== currentUserId) {
            debugLog('PROGRESS', `updateDownloadedComicInfo - comic ${comicId} belongs to different user, denying update`);
            resolve(false);
            return;
          }

          // Update comicInfo with the new data
          if (!comic.comicInfo) {
            comic.comicInfo = {};
          }

          Object.assign(comic.comicInfo, updates);

          // Save back to DB
          const putRequest = store.put(comic);

          putRequest.onsuccess = () => {
            debugLog('PROGRESS', `updateDownloadedComicInfo - successfully updated comic ${comicId}`, updates);
            resolve(true);
          };

          putRequest.onerror = (event) => {
            reject(new Error(`Failed to update comic: ${event.target.errorCode}`));
          };
        };

        getRequest.onerror = (event) => {
          reject(new Error(`Failed to get comic: ${event.target.errorCode}`));
        };
      } catch (error) {

        reject(error);
      }
    });
  }

  const OfflineDB = {
    LIBRARY_CACHE_STORE,
    LIBRARY_CACHE_KEY,
    openOfflineDB,
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
    getStorageInfo,
    forceStorageCleanup,
    formatBytes,
    getOfflineComicRecordById,
    updateDownloadedComicInfo,
  };

  global.OfflineDB = OfflineDB;
  Object.assign(global, OfflineDB);
})(typeof window !== 'undefined' ? window : globalThis);
