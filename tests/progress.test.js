/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupEnvironment() {
  const state = {
    API_BASE_URL: '',
    db: null,
    updateLibraryReadStatus: jest.fn(),
    applyFilterAndRender: jest.fn(),
    scheduleOfflineProgressSync: jest.fn(),
    saveLibraryCacheToDB: jest.fn().mockResolvedValue(),
    saveStatusToDB: jest.fn().mockResolvedValue(),
    openOfflineDB: jest.fn().mockResolvedValue(),
    library: {
      _isLazyLoaded: true,
      'root1': {
        publishers: {
          'pub1': {
            _counts: { unread: 2, read: 1 },
            series: {
              'series1': {
                _counts: { unread: 1, read: 1 }
              }
            }
          }
        }
      }
    }
  };

  const ICONS = {
    READ: '<svg>read</svg>',
    UNREAD: '<svg>unread</svg>'
  };

  const dbMock = {
    transaction: jest.fn(() => {
      const tx = {
        objectStore: jest.fn((storeName) => {
          if (storeName === 'progress') {
            return {
              put: jest.fn(() => {
                const req = {};
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              })
            };
          } else if (storeName === 'comics') {
            return {
              get: jest.fn(() => {
                const req = { result: null };
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              }),
              put: jest.fn(() => {
                const req = {};
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              })
            };
          }
        })
      };
      // Manually trigger oncomplete so the promise resolves
      setTimeout(() => {
        if (tx.oncomplete) tx.oncomplete();
      }, 0);
      return tx;
    })
  };

  const sandbox = {
    window: {
      openOfflineDB: jest.fn().mockImplementation(async () => {
        state.db = dbMock;
        sandbox.state.db = dbMock;
      }),
      scheduleOfflineProgressSync: jest.fn(),
      saveLibraryCacheToDB: jest.fn().mockResolvedValue(),
      saveStatusToDB: jest.fn().mockResolvedValue(),
      updateLibraryReadStatus: jest.fn(),
      applyFilterAndRender: jest.fn()
    },
    document,
    navigator: {
      onLine: true
    },
    state,
    console,
    fetch: jest.fn(),
    Event,
    AbortController: global.AbortController,
    setTimeout: (cb) => { cb(); },
    clearTimeout: global.clearTimeout,
    Date: global.Date,
    requestAnimationFrame: (cb) => { cb(); },

    // Mocks for globals.js exports
    ICONS,
    debugLog: jest.fn(),
    applyDisplayInfoToComic: jest.fn(),

    // These need to be accessible for test verification
    dbMock
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../public/js/progress.js');
  const content = fs.readFileSync(fullPath, 'utf8');

  // Clean up modules for vm
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

  return { sandbox, state, dbMock };
}

describe('Progress.js Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('saveProgressToDB', () => {
    test('opens DB if not initialized, normalizes page, and saves progress', async () => {
      const { sandbox, state, dbMock } = setupEnvironment();

      // Make sure state.openOfflineDB resolves and populates db
      state.openOfflineDB.mockImplementation(async () => {
        state.db = dbMock;
        sandbox.state.db = dbMock;
        sandbox.window.db = dbMock;
      });

      await sandbox.saveProgressToDB('comic-123', 'invalid', 10, '/path');

      expect(state.openOfflineDB).toHaveBeenCalled();
      expect(dbMock.transaction).toHaveBeenCalledWith(['progress', 'comics'], 'readwrite');

      const transactionMock = dbMock.transaction.mock.results[0].value;
      const objectStoreMock = transactionMock.objectStore;
      expect(objectStoreMock).toHaveBeenCalledWith('progress');

      const putMock = objectStoreMock.mock.results.find(r => r.value.put).value.put;
      expect(putMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'comic-123',
        lastReadPage: 0, // Normalized from 'invalid'
        page: 0,
        synced: false
      }));
    });
  });

  describe('updateLazyLoadingCounts', () => {
    test('updates series and publisher counts correctly', () => {
      const { sandbox, state } = setupEnvironment();

      sandbox.updateLazyLoadingCounts('root1', 'pub1', 'series1', 'unread', 'read');

      const seriesCounts = state.library.root1.publishers.pub1.series.series1._counts;
      expect(seriesCounts.unread).toBe(0);
      expect(seriesCounts.read).toBe(2);

      const pubCounts = state.library.root1.publishers.pub1._counts;
      expect(pubCounts.unread).toBe(1);
      expect(pubCounts.read).toBe(2);
    });
  });

  describe('toggleReadStatus', () => {
    test('toggles individual comic read status successfully', async () => {
      const { sandbox, state } = setupEnvironment();

      // Setup DOM
      document.body.innerHTML = `
        <div class="comic-card">
          <div class="relative"></div>
          <button data-comic-id="comic-1" data-current-status="unread" class="text-gray-400">Read</button>
        </div>
      `;
      const button = document.querySelector('button');

      sandbox.fetch.mockResolvedValueOnce({ ok: true });

      // Mock internal call by setting active DB since updateOfflineProgressForComic is invoked
      state.db = {
        transaction: jest.fn(() => {
          const tx = {
            objectStore: jest.fn(() => ({
              put: jest.fn(() => {
                const req = {};
                setTimeout(() => { if(req.onsuccess) req.onsuccess(); }, 0);
                return req;
              }),
              get: jest.fn(() => {
                const req = { result: null };
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              })
            }))
          };
          setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return tx;
        })
      };

      await sandbox.toggleReadStatus(button);

      // Verify optimistic UI update
      expect(button.dataset.currentStatus).toBe('read');
      expect(button.classList.contains('text-green-400')).toBe(true);

      // Verify API call
      expect(sandbox.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/comics/status'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ comicId: 'comic-1', status: 'read' })
        })
      );

      // Verify callbacks
      expect(state.updateLibraryReadStatus).toHaveBeenCalledWith({
        rootFolder: undefined,
        publisher: undefined,
        seriesName: undefined,
        comicId: 'comic-1',
        status: 'read'
      });
      expect(state.applyFilterAndRender).toHaveBeenCalled();
      expect(state.scheduleOfflineProgressSync).toHaveBeenCalledWith(true);
      expect(state.saveLibraryCacheToDB).toHaveBeenCalledWith(state.library);
    });

    test('handles fetch failure and rolls back status', async () => {
      const { sandbox, state } = setupEnvironment();

      document.body.innerHTML = `
        <button data-comic-id="comic-error" data-current-status="read" class="text-green-400">Unread</button>
      `;
      const button = document.querySelector('button');

      sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));
      state.db = {
        transaction: jest.fn(() => {
          const tx = {
            objectStore: jest.fn(() => ({
              put: jest.fn(() => {
                const req = {};
                setTimeout(() => { if(req.onsuccess) req.onsuccess(); }, 0);
                return req;
              }),
              get: jest.fn(() => {
                const req = { result: null };
                setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                return req;
              })
            }))
          };
          setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return tx;
        })
      };

      await sandbox.toggleReadStatus(button);

      // Should attempt to change to unread
      expect(sandbox.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: JSON.stringify({ comicId: 'comic-error', status: 'unread' }) })
      );

      // Fallback: save to IDB offline queue
      expect(state.saveStatusToDB).toHaveBeenCalledWith(expect.objectContaining({
        key: 'comic:comic-error',
        comicId: 'comic-error',
        status: 'unread'
      }));

      // In the end, offline mode updates the button optimistically anyways (it's queued)
      expect(button.dataset.currentStatus).toBe('unread');
      expect(button.classList.contains('text-gray-400')).toBe(true);
    });
  });
});
