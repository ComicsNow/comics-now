/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Offline DB Comics Module', () => {
  let sandbox;
  let mockStores;

  beforeEach(() => {
    mockStores = {
      comics: new Map(),
      comicMeta: new Map(),
      progress: new Map(),
      statuses: new Map(),
      settings: new Map()
    };

    const createMockStore = (storeName) => {
      const storeObj = {
        put: jest.fn((record) => {
          const id = record.id || record.key;
          mockStores[storeName].set(id, record);
          const req = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: { result: id } }), 0);
          return req;
        }),
        get: jest.fn((key) => {
          const result = mockStores[storeName].get(key) || null;
          const req = { result, onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }),
        getAll: jest.fn(() => {
          const result = Array.from(mockStores[storeName].values());
          const req = { result, onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }),
        getAllKeys: jest.fn(() => {
          const result = Array.from(mockStores[storeName].keys());
          const req = { result, onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }),
        openCursor: jest.fn(() => {
          const entries = Array.from(mockStores[storeName].entries());
          let idx = 0;
          const req = { result: null, onsuccess: null, onerror: null };
          const advance = () => {
            if (idx < entries.length) {
              const [key, value] = entries[idx++];
              req.result = {
                key,
                value,
                continue: () => setTimeout(advance, 0)
              };
            } else {
              req.result = null;
            }
            req.onsuccess && req.onsuccess({ target: req });
          };
          setTimeout(advance, 0);
          return req;
        }),
        index: jest.fn((indexName) => ({
          getAllKeys: jest.fn((filterVal) => {
            const keys = [];
            for (const [k, v] of mockStores[storeName].entries()) {
              if (filterVal === undefined || v[indexName] === filterVal) {
                keys.push(k);
              }
            }
            const req = { result: keys, onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
            return req;
          })
        })),
        delete: jest.fn((key) => {
          mockStores[storeName].delete(key);
          const req = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }),
        clear: jest.fn(() => {
          mockStores[storeName].clear();
          const req = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        })
      };
      return storeObj;
    };

    const storeSpies = {
      comics: [],
      comicMeta: [],
      progress: [],
      statuses: [],
      settings: []
    };

    const mockDb = {
      objectStoreNames: {
        contains: (name) => Object.prototype.hasOwnProperty.call(mockStores, name)
      },
      transaction: jest.fn((storeNames) => {
        const tx = {
          objectStore: jest.fn((name) => {
            const s = createMockStore(name);
            if (storeSpies[name]) storeSpies[name].push(s);
            return s;
          }),
          oncomplete: null,
          onerror: null
        };
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 10);
        return tx;
      })
    };
    mockStores._spies = storeSpies;

    const state = {
      db: mockDb,
      downloadedComicIds: new Set(),
      library: {
        '/comics': {
          publishers: {
            'DC': {
              series: {
                'Batman': [
                  { id: 'batman-1', name: 'Batman #1' },
                  { id: 'batman-2', name: 'Batman #2' }
                ]
              }
            }
          }
        }
      }
    };

    sandbox = {
      window: window,
      document: document,
      state: state,
      console: console,
      getCurrentUserId: () => 'default-user',
      debugLog: () => {},
      applyDisplayInfoToComic: (c) => c,
      openOfflineDB: jest.fn().mockResolvedValue(),
      navigator: {
        storage: {
          estimate: jest.fn().mockResolvedValue({ quota: 1000000, usage: 500000 })
        }
      },
      caches: {
        open: jest.fn().mockResolvedValue({
          keys: jest.fn().mockResolvedValue([]),
          delete: jest.fn().mockResolvedValue(true)
        }),
        delete: jest.fn().mockResolvedValue(true)
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    function loadFile(relPath) {
      const fullPath = path.resolve(__dirname, '../../../../', relPath);
      const code = fs.readFileSync(fullPath, 'utf8');
      const clean = code
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+let\s+/g, 'let ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[^;]+;?/g, '');
      vm.runInContext(clean, sandbox);
    }

    const submodules = [
      'public/js/offline/db/comic-meta.js',
      'public/js/offline/db/comic-storage.js',
      'public/js/offline/db/comic-reader.js',
      'public/js/offline/db/comic-writer.js',
      'public/js/offline/db/comic-cleanup.js'
    ];
    submodules.forEach((sub) => {
      const fullPath = path.resolve(__dirname, '../../../../', sub);
      if (fs.existsSync(fullPath)) {
        loadFile(sub);
      }
    });

    loadFile('public/js/offline/db-comics.js');
  });

  test('isIdInLibrary correctly finds comic id in library tree', () => {
    const fn = sandbox.isIdInLibrary || sandbox.state.isIdInLibrary;
    expect(fn('batman-1')).toBe(true);
    expect(fn('superman-1')).toBe(false);
  });

  test('saveComicToDB saves comic blob and info into store', async () => {
    const fn = sandbox.saveComicToDB || sandbox.state.saveComicToDB;
    const comic = { id: 'comic-99', name: 'Flash #1' };
    const blob = new Blob(['comic-binary']);

    await fn(comic, blob);
    expect(mockStores.comics.has('comic-99')).toBe(true);
  });

  test('getComicFromDB retrieves comic from store', async () => {
    mockStores.comics.set('comic-99', { id: 'comic-99', userId: 'default-user', comicInfo: { id: 'comic-99' } });
    const fn = sandbox.getComicFromDB || sandbox.state.getComicFromDB;

    const result = await fn('comic-99');
    expect(result).not.toBeNull();
    expect(result.id).toBe('comic-99');
  });

  test('getAllDownloadedComicIds returns set of stored comic ids', async () => {
    mockStores.comics.set('c1', { id: 'c1', userId: 'default-user' });
    mockStores.comics.set('c2', { id: 'c2', userId: 'default-user' });
    const fn = sandbox.getAllDownloadedComicIds || sandbox.state.getAllDownloadedComicIds;

    const ids = await fn();
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
  });

  test('getStorageInfo returns formatted storage numbers', async () => {
    const fn = sandbox.getStorageInfo || sandbox.state.getStorageInfo;
    const info = await fn();
    expect(info.supported).toBe(true);
    expect(info.quota).toBe(1000000);
    expect(info.usage).toBe(500000);
  });

  test('saveComicToDB and updateDownloadedComicInfo keep comicMeta synced without blobs', async () => {
    const saveFn = sandbox.saveComicToDB || sandbox.state.saveComicToDB;
    const updateFn = sandbox.updateDownloadedComicInfo || sandbox.state.updateDownloadedComicInfo;
    const comic = { id: 'comic-meta-1', name: 'Batman #10' };
    const blob = new Blob(['binary-payload']);

    await saveFn(comic, blob);
    expect(mockStores.comicMeta.has('comic-meta-1')).toBe(true);
    const meta = mockStores.comicMeta.get('comic-meta-1');
    expect(meta.fileBlob).toBeUndefined();
    expect(meta.fileSize).toBe(blob.size);
    expect(meta.userId).toBe('default-user');

    await updateFn('comic-meta-1', { series: 'Batman', read: true });
    expect(mockStores.comicMeta.get('comic-meta-1').comicInfo.read).toBe(true);
  });

  test('ensureComicMetaBackfilled backfills partial comicMeta and normalizes missing userId', async () => {
    mockStores.comics.set('legacy-1', {
      id: 'legacy-1',
      comicInfo: { id: 'legacy-1', name: 'Legacy #1' },
      fileBlob: new Blob(['12345'])
    });
    mockStores.comics.set('legacy-2', {
      id: 'legacy-2',
      userId: 'default-user',
      comicInfo: { id: 'legacy-2', name: 'Legacy #2' },
      fileBlob: new Blob(['123456'])
    });
    // Pre-existing partial comicMeta should NOT skip backfill when version flag is absent
    mockStores.comicMeta.set('legacy-2', {
      id: 'legacy-2',
      userId: 'default-user',
      comicInfo: { id: 'legacy-2', name: 'Legacy #2' },
      fileSize: 6
    });

    const getIdsFn = sandbox.getAllDownloadedComicIds || sandbox.state.getAllDownloadedComicIds;
    const ids = await getIdsFn();

    expect(ids.has('legacy-1')).toBe(true);
    expect(ids.has('legacy-2')).toBe(true);
    expect(mockStores.comicMeta.get('legacy-1').userId).toBe('default-user');
    expect(mockStores.settings.get('comicMetaBackfillVersion')?.value).toBe(14);
    // Must NOT call comicsStore.getAll()
    const comicsGetAllCalls = mockStores._spies.comics.reduce((sum, s) => sum + s.getAll.mock.calls.length, 0);
    expect(comicsGetAllCalls).toBe(0);
  });

  test('getAllDownloadedComicMetadata preserves page 0 and avoids comicsStore.getAll', async () => {
    mockStores.settings.set('comicMetaBackfillVersion', { key: 'comicMetaBackfillVersion', value: 14 });
    mockStores.comicMeta.set('c-zero', {
      id: 'c-zero',
      userId: 'default-user',
      comicInfo: { id: 'c-zero', name: 'Zero #1', progress: { lastReadPage: 5, totalPages: 20 } },
      fileSize: 4096
    });
    mockStores.progress.set('c-zero', { id: 'c-zero', lastReadPage: 0, totalPages: 20 });

    const fn = sandbox.getAllDownloadedComicMetadata || sandbox.state.getAllDownloadedComicMetadata;
    const items = await fn();
    expect(items).toHaveLength(1);
    expect(items[0].fileSize).toBe(4096);
    expect(items[0].progress.lastReadPage).toBe(0);
    const comicsGetAllCalls = mockStores._spies.comics.reduce((sum, s) => sum + s.getAll.mock.calls.length, 0);
    expect(comicsGetAllCalls).toBe(0);
  });

  test('getOfflineComicMetaById returns metadata from comicMeta + progress without reading blobs', async () => {
    mockStores.settings.set('comicMetaBackfillVersion', { key: 'comicMetaBackfillVersion', value: 14 });
    mockStores.comicMeta.set('meta-lookup-1', {
      id: 'meta-lookup-1',
      userId: 'default-user',
      comicInfo: { id: 'meta-lookup-1', name: 'Lookup #1' },
      fileSize: 2048
    });
    mockStores.progress.set('meta-lookup-1', { id: 'meta-lookup-1', lastReadPage: 4, totalPages: 22 });

    const fn = sandbox.getOfflineComicMetaById || sandbox.state.getOfflineComicMetaById;
    const result = await fn('meta-lookup-1');
    expect(result).not.toBeNull();
    expect(result.id).toBe('meta-lookup-1');
    expect(result.progress.lastReadPage).toBe(4);
    expect(result.fileSize).toBe(2048);
  });

  test('clearOfflineData uses cursor without comicsStore.getAll and clears comicMeta', async () => {
    mockStores.comics.set('del-1', { id: 'del-1', userId: 'default-user', comicInfo: { id: 'del-1' } });
    mockStores.comicMeta.set('del-1', { id: 'del-1', userId: 'default-user', comicInfo: { id: 'del-1' } });

    const clearFn = sandbox.clearOfflineData || sandbox.state.clearOfflineData;
    await clearFn();

    expect(mockStores.comics.has('del-1')).toBe(false);
    expect(mockStores.comicMeta.has('del-1')).toBe(false);
    expect(sandbox.caches.delete).toHaveBeenCalledWith('comics-now-downloads');
    const comicsGetAllCalls = mockStores._spies.comics.reduce((sum, s) => sum + s.getAll.mock.calls.length, 0);
    expect(comicsGetAllCalls).toBe(0);
  });
});
