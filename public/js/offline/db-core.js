import { state, debugLog } from '../globals.js';

export const LIBRARY_CACHE_STORE = 'library';
export const LIBRARY_CACHE_KEY = 'library-cache';

// Helper function to get current userId synchronously
export function getCurrentUserId() {
  // Try syncManager first
  const syncManager = state.syncManager || window.syncManager;
  if (syncManager && syncManager.userId) {
    const userId = syncManager.userId;
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
      return cachedUserId;
    }
  } catch (e) {
    // Ignore storage errors
  }

  // Final fallback to default
  return 'default-user';
}

export async function openOfflineDB() {
  const activeDb = state.db || window.db;
  if (activeDb) {
    return activeDb;
  }

  return new Promise((resolve, reject) => {
    debugLog('PROGRESS', 'Opening IndexedDB connection...');
    const request = indexedDB.open('comics-now-offline', 13);

    request.onerror = (event) => {
      reject(new Error(`Error opening IndexedDB: ${event.target.error}`));
    };

    request.onblocked = (event) => {
      console.warn('[IndexedDB] Database upgrade blocked by another connection. Please close other tabs.');
      reject(new Error('IndexedDB blocked by other connections'));
    };

    request.onsuccess = (event) => {
      const database = event.target.result;
      
      // Close database connection if an upgrade is requested by another tab/Service Worker
      database.onversionchange = () => {
        database.close();
        console.log('[IndexedDB] Database connection closed due to version change request.');
        state.db = null;
        window.db = null;
      };

      state.db = database;
      window.db = database;
      debugLog(
        'PROGRESS',
        'IndexedDB opened successfully, object stores:',
        Array.from(database.objectStoreNames)
      );
      resolve(database);
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

      // Create downloadQueue object store for background download queue persistence
      if (!database.objectStoreNames.contains('downloadQueue')) {
        debugLog('PROGRESS', "Creating 'downloadQueue' object store with priority index");
        const queueStore = database.createObjectStore('downloadQueue', { keyPath: 'id' });
        queueStore.createIndex('priority', 'priority', { unique: false });
        queueStore.createIndex('status', 'status', { unique: false });
      }

      // Create settings object store for JWT tokens and app settings
      if (!database.objectStoreNames.contains('settings')) {
        debugLog('PROGRESS', "Creating 'settings' object store");
        database.createObjectStore('settings', { keyPath: 'key' });
      }

      // Create deviceLibraries object store for local file system access handles
      if (!database.objectStoreNames.contains('deviceLibraries')) {
        debugLog('PROGRESS', "Creating 'deviceLibraries' object store");
        database.createObjectStore('deviceLibraries', { keyPath: 'id' });
      }

      // Create deviceComics object store for local comics metadata and handles
      if (!database.objectStoreNames.contains('deviceComics')) {
        debugLog('PROGRESS', "Creating 'deviceComics' object store");
        database.createObjectStore('deviceComics', { keyPath: 'id' });
      }

      debugLog('PROGRESS', 'IndexedDB upgrade completed');
    };
  });
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Expose globals for backward compatibility during transition
state.LIBRARY_CACHE_STORE = LIBRARY_CACHE_STORE;
state.LIBRARY_CACHE_KEY = LIBRARY_CACHE_KEY;
state.getCurrentUserId = getCurrentUserId;
state.openOfflineDB = openOfflineDB;
state.formatBytes = formatBytes;

if (typeof window !== 'undefined') {
  window.LIBRARY_CACHE_STORE = LIBRARY_CACHE_STORE;
  window.LIBRARY_CACHE_KEY = LIBRARY_CACHE_KEY;
  window.getCurrentUserId = getCurrentUserId;
  window.openOfflineDB = openOfflineDB;
  window.formatBytes = formatBytes;
}
