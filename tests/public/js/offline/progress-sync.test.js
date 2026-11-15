/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('public/js/offline/status/progress-sync.js', () => {
  test('retains unsynced offline progress record instead of deleting when comicPath cannot be resolved', async () => {
    const progressRecords = new Map([
      ['comic-999', { id: 'comic-999', lastReadPage: 14, page: 14, synced: false }]
    ]);

    const mockDelete = jest.fn((id) => {
      progressRecords.delete(id);
      const req = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess(), 0);
      return req;
    });

    const mockPut = jest.fn((item) => {
      progressRecords.set(item.id, item);
      const req = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess(), 0);
      return req;
    });

    const mockDb = {
      transaction: jest.fn(() => {
        const tx = {
          objectStore: jest.fn(() => ({
            getAll: jest.fn(() => {
              const req = { result: Array.from(progressRecords.values()), onsuccess: null, onerror: null };
              setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
              return req;
            }),
            delete: mockDelete,
            put: mockPut
          })),
          oncomplete: null,
          onerror: null
        };
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
        return tx;
      })
    };

    const state = {
      db: mockDb,
      library: {}, // Empty library (not yet loaded)
      OfflineDB: {
        openOfflineDB: jest.fn().mockResolvedValue(),
        getOfflineComicRecordById: jest.fn().mockResolvedValue(null)
      },
      syncManager: {
        deviceId: 'dev-1',
        updateProgress: jest.fn()
      }
    };

    const sandbox = {
      window: {},
      state,
      navigator: { onLine: true },
      debugLog: () => {},
      console,
      setTimeout,
      clearTimeout
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../../../../public/js/offline/status/progress-sync.js');
    const code = fs.readFileSync(fullPath, 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ');

    vm.runInContext(code, sandbox);

    await sandbox.syncOfflineProgress();

    expect(mockDelete).not.toHaveBeenCalled();
    expect(progressRecords.has('comic-999')).toBe(true);
    expect(progressRecords.get('comic-999').synced).toBe(false);
    expect(progressRecords.get('comic-999').syncAttempts).toBe(1);
  });

  test('hasPendingOfflineSync seeds dirty sentinel once when null and skips IDB on clean boots', async () => {
    const progressRecords = new Map();
    const statusRecords = new Map();
    const txSpy = jest.fn(() => {
      const tx = {
        objectStore: jest.fn((name) => ({
          getAll: jest.fn(() => {
            const list = name === 'statuses' ? Array.from(statusRecords.values()) : Array.from(progressRecords.values());
            const req = { result: list, onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
            return req;
          })
        })),
        oncomplete: null,
        onerror: null
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    });

    const store = new Map();
    const mockLocalStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    };

    const sandbox = {
      window: {},
      localStorage: mockLocalStorage,
      state: {
        db: { transaction: txSpy },
        OfflineDB: { openOfflineDB: jest.fn().mockResolvedValue() }
      },
      navigator: { onLine: true },
      document: { hidden: false },
      debugLog: () => {},
      console,
      setTimeout,
      clearTimeout
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../../../../public/js/offline/status/progress-sync.js');
    const code = fs.readFileSync(fullPath, 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ');
    vm.runInContext(code, sandbox);

    expect(await sandbox.hasPendingOfflineSync()).toBe(false);
    expect(mockLocalStorage.getItem('comicsNow_offlineSyncDirty')).toBe('0');
    expect(txSpy).toHaveBeenCalledTimes(1);

    // Second call must do 0 IDB reads
    expect(await sandbox.hasPendingOfflineSync()).toBe(false);
    expect(txSpy).toHaveBeenCalledTimes(1);
  });

  test('enhancedBackgroundSync retains dirty flag if updateProgress returns ok:false and clears when synced', async () => {
    const progressRecords = new Map([
      ['comic-1', { id: 'comic-1', lastReadPage: 5, page: 5, synced: false, comicPath: '/c1.cbz' }]
    ]);
    const txSpy = jest.fn(() => {
      const tx = {
        objectStore: jest.fn(() => ({
          getAll: jest.fn(() => {
            const req = { result: Array.from(progressRecords.values()), onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
            return req;
          }),
          put: jest.fn((item) => {
            progressRecords.set(item.id, item);
            const req = { onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess && req.onsuccess(), 0);
            return req;
          })
        })),
        oncomplete: null,
        onerror: null
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    });

    const store = new Map([['comicsNow_offlineSyncDirty', '1']]);
    const mockLocalStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    };

    const updateProgress = jest.fn().mockResolvedValueOnce({ ok: false });
    const sandbox = {
      window: {},
      localStorage: mockLocalStorage,
      state: {
        db: { transaction: txSpy },
        library: {},
        OfflineDB: { openOfflineDB: jest.fn().mockResolvedValue() },
        syncManager: { deviceId: 'dev-1', updateProgress },
        syncOfflineStatuses: jest.fn().mockResolvedValue(0)
      },
      navigator: { onLine: true },
      document: { hidden: false },
      debugLog: () => {},
      console,
      setTimeout,
      clearTimeout
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../../../../public/js/offline/status/progress-sync.js');
    const code = fs.readFileSync(fullPath, 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ');
    vm.runInContext(code, sandbox);

    await sandbox.enhancedBackgroundSync();
    expect(progressRecords.get('comic-1').synced).toBe(false);
    expect(mockLocalStorage.getItem('comicsNow_offlineSyncDirty')).toBe('1');
    sandbox.cancelOfflineSyncRetry();

    updateProgress.mockResolvedValueOnce({ ok: true });
    await sandbox.enhancedBackgroundSync();
    expect(progressRecords.get('comic-1').synced).toBe(true);
    expect(mockLocalStorage.getItem('comicsNow_offlineSyncDirty')).toBe('0');
  });
});
