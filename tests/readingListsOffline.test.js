/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox(initialOnline = true) {
  let onLineStatus = initialOnline;

  const mockIndexedDBData = {};
  const mockObjectStore = {
    put: jest.fn(record => {
      mockIndexedDBData[record.key] = record;
      const req = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess(), 0);
      return req;
    }),
    get: jest.fn(key => {
      const req = { result: mockIndexedDBData[key] || null, onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
      return req;
    }),
    delete: jest.fn(key => {
      delete mockIndexedDBData[key];
      const req = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess(), 0);
      return req;
    })
  };

  const mockDb = {
    objectStoreNames: {
      contains: jest.fn(name => name === 'library' || name === 'comics')
    },
    transaction: jest.fn(() => ({
      objectStore: jest.fn(() => mockObjectStore)
    }))
  };

  const state = {
    db: mockDb,
    library: {
      '/comics': {
        publishers: {
          'DC': {
            series: {
              'Batman': [
                { id: 'comic-1', name: 'Batman #1', totalPages: 24, lastReadPage: 10 },
                { id: 'comic-2', name: 'Batman #2', totalPages: 24, lastReadPage: 0 }
              ]
            }
          }
        }
      }
    },
    downloadedComicIds: new Set(['comic-1', 'comic-2']),
    getComicById: jest.fn(id => {
      if (id === 'comic-1') return { id: 'comic-1', name: 'Batman #1' };
      if (id === 'comic-2') return { id: 'comic-2', name: 'Batman #2' };
      return null;
    }),
    getOfflineComicRecordById: jest.fn(async id => {
      if (id === 'comic-1') return { id: 'comic-1', comicInfo: { id: 'comic-1', name: 'Batman #1' } };
      if (id === 'comic-2') return { id: 'comic-2', comicInfo: { id: 'comic-2', name: 'Batman #2' } };
      return null;
    })
  };

  const alertMock = jest.fn();

  const sandbox = {
    window: {
      location: { href: 'http://localhost:3000' },
      dispatchEvent: jest.fn(),
      CustomEvent: function (event, params) { return { event, params }; },
      alert: alertMock,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    },
    document: {
      querySelector: jest.fn(() => null),
      getElementById: jest.fn(() => null),
      addEventListener: jest.fn()
    },
    navigator: {
      get onLine() {
        return onLineStatus;
      }
    },
    localStorage: (function () {
      let store = {};
      return {
        getItem: jest.fn(k => store[k] || null),
        setItem: jest.fn((k, v) => { store[k] = String(v); }),
        removeItem: jest.fn(k => { delete store[k]; }),
        clear: jest.fn(() => { store = {}; })
      };
    })(),
    state,
    console,
    alert: alertMock,
    fetch: jest.fn(),
    openOfflineDB: jest.fn().mockResolvedValue(mockDb),
    debugLog: jest.fn(),
    escapeHtml: jest.fn(s => s),
    LIBRARY_CACHE_STORE: 'library',
    LIBRARY_CACHE_KEY: 'library-cache'
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    const script = new vm.Script(cleanContent);
    script.runInContext(sandbox);
  }

  return {
    sandbox,
    loadFile,
    state,
    mockIndexedDBData,
    setOnline: status => { onLineStatus = status; },
    alertMock
  };
}

describe('Reading Lists Offline Support & Editing Restrictions', () => {
  let env;

  beforeEach(() => {
    env = createSandbox(true);
    // Load cache module
    env.loadFile('../public/js/offline/db-library-cache.js');
    // Load reading-lists module
    env.loadFile('../public/js/reading-lists.js');
  });

  describe('Offline Caching & Retrieval', () => {
    test('saveReadingListsCacheToDB caches lists in IndexedDB and localStorage', async () => {
      const lists = [{ id: 'list-1', name: 'Batman Event', totalComics: 2 }];
      await env.sandbox.saveReadingListsCacheToDB(lists);

      // Verify localStorage
      expect(env.sandbox.localStorage.setItem).toHaveBeenCalledWith(
        'comics-reading-lists-cache',
        JSON.stringify(lists)
      );

      // Verify loadReadingListsCacheFromDB returns cached lists
      const loaded = await env.sandbox.loadReadingListsCacheFromDB();
      expect(loaded).toEqual(lists);
    });

    test('saveReadingListDetailCacheToDB caches list details', async () => {
      const detail = {
        ok: true,
        list: { id: 'list-1', name: 'Batman Event' },
        items: [{ comicId: 'comic-1', sortOrder: 0 }]
      };
      await env.sandbox.saveReadingListDetailCacheToDB('list-1', detail);

      const loaded = await env.sandbox.loadReadingListDetailCacheFromDB('list-1');
      expect(loaded).toEqual(detail);
    });

    test('fetchReadingLists returns cached lists when offline', async () => {
      const sampleLists = [{ id: 'list-1', name: 'Crisis Saga', totalComics: 5 }];
      await env.sandbox.saveReadingListsCacheToDB(sampleLists);

      // Go offline
      env.setOnline(false);

      const result = await env.sandbox.fetchReadingLists();
      expect(result).toEqual(sampleLists);
      // Fetch should not be called when offline
      expect(env.sandbox.fetch).not.toHaveBeenCalled();
    });

    test('getReadingListDetails returns cached details when offline', async () => {
      const detail = {
        ok: true,
        list: { id: 'list-1', name: 'Crisis Saga' },
        items: [
          { comicId: 'comic-1', sortOrder: 0, lastReadPage: 10, totalPages: 24 },
          { comicId: 'comic-2', sortOrder: 1, lastReadPage: 0, totalPages: 24 }
        ]
      };
      await env.sandbox.saveReadingListDetailCacheToDB('list-1', detail);

      // Go offline
      env.setOnline(false);

      const result = await env.sandbox.getReadingListDetails('list-1');
      expect(result).toEqual(detail);
      expect(env.sandbox.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Offline Editing Restrictions', () => {
    beforeEach(() => {
      // Set to offline
      env.setOnline(false);
    });

    test('createReadingList is blocked and alerts when offline', async () => {
      await expect(env.sandbox.createReadingList('New List')).rejects.toThrow(
        'Reading list editing is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Reading list editing is not available while offline.');
    });

    test('addComicsToList is blocked and alerts when offline', async () => {
      await expect(env.sandbox.addComicsToList('list-1', ['comic-1'])).rejects.toThrow(
        'Reading list editing is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Reading list editing is not available while offline.');
    });

    test('removeComicsFromList is blocked and alerts when offline', async () => {
      await expect(env.sandbox.removeComicsFromList('list-1', ['comic-1'])).rejects.toThrow(
        'Reading list editing is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Reading list editing is not available while offline.');
    });

    test('reorderComics is blocked and alerts when offline', async () => {
      await expect(env.sandbox.reorderComics('list-1', ['comic-2', 'comic-1'])).rejects.toThrow(
        'Reading list editing is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Reading list editing is not available while offline.');
    });

    test('markListAsRead is blocked and alerts when offline', async () => {
      await expect(env.sandbox.markListAsRead('list-1', true)).rejects.toThrow(
        'Marking reading lists as read is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Marking reading lists as read is not available while offline.');
    });

    test('importLists is blocked and alerts when offline', async () => {
      await expect(env.sandbox.importLists([])).rejects.toThrow(
        'Importing reading lists is not available while offline.'
      );
      expect(env.alertMock).toHaveBeenCalledWith('Importing reading lists is not available while offline.');
    });

    test('openAddToListModal alerts and aborts when offline', async () => {
      await env.sandbox.openAddToListModal(['comic-1']);
      expect(env.alertMock).toHaveBeenCalledWith('Reading list editing is not available while offline.');
    });
  });

  describe('End of Comic Navigation with Offline Reading Lists', () => {
    test('getNextComicInReadingList resolves next comic offline using cached list details', async () => {
      const detail = {
        ok: true,
        list: { id: 'list-1', name: 'Offline Reading List' },
        items: [
          { comicId: 'comic-1', sortOrder: 0 },
          { comicId: 'comic-2', sortOrder: 1 }
        ]
      };
      await env.sandbox.saveReadingListDetailCacheToDB('list-1', detail);

      env.setOnline(false);

      // Load end-navigation
      env.state.currentComic = { id: 'comic-1', name: 'Batman #1' };
      env.state.viewerReturnContext = { readingListId: 'list-1', readingListName: 'Offline Reading List' };

      env.loadFile('../public/js/viewer/end-navigation.js');

      const next = await env.sandbox.getNextComicInReadingList();
      expect(next).not.toBeNull();
      expect(next.id).toBe('comic-2');
      expect(next._readingListContext.readingListId).toBe('list-1');
    });
  });
});
