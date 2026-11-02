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
      progress: new Map(),
      statuses: new Map()
    };

    const createMockStore = (storeName) => ({
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
    });

    const mockDb = {
      transaction: jest.fn((storeNames) => {
        const tx = {
          objectStore: jest.fn((name) => createMockStore(name)),
          oncomplete: null,
          onerror: null
        };
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
        return tx;
      })
    };

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
});
