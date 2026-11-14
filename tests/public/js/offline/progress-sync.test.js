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
});
