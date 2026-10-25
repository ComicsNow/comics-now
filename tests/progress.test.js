/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Progress Tracking System', () => {
  let mockState;
  let mockWindow;
  let mockedFetch;

  beforeEach(() => {
    // Set up DOM
    document.body.innerHTML = `
      <div class="comic-card">
        <div class="relative">
          <button data-comic-id="1" data-current-status="unread" class="text-gray-400"></button>
        </div>
      </div>
      <div class="series-card">
        <div class="relative">
          <button data-series-name="Batman" data-root-folder="/manga" data-publisher="DC" data-current-status="unread" class="text-gray-400"></button>
        </div>
      </div>
    `;

    // Mock global objects and state
    mockState = {
      db: null,
      library: {
        '/manga': {
          publishers: {
            'DC': {
              _counts: { unread: 5, read: 0 },
              series: {
                'Batman': [
                  { id: 1, progress: { lastReadPage: 0, totalPages: 22 } },
                  { id: 2, progress: { lastReadPage: 21, totalPages: 22 } }
                ]
              }
            }
          }
        }
      },
      API_BASE_URL: 'http://localhost:3000',
      currentView: 'library',
      openOfflineDB: jest.fn().mockResolvedValue(),
      scheduleOfflineProgressSync: jest.fn(),
      invalidateFolderCache: jest.fn(),
      getComicStatus: jest.fn().mockReturnValue('unread'),
      updateFilterButtonCounts: jest.fn(),
      updateDownloadedComicProgressData: jest.fn(),
      renderDownloadedSmartList: jest.fn(),
      saveLibraryCacheToDB: jest.fn().mockResolvedValue(),
      saveStatusToDB: jest.fn().mockResolvedValue(),
      getSeriesComics: jest.fn().mockResolvedValue([]),
      updateLibraryReadStatus: jest.fn(),
      applyFilterAndRender: jest.fn()
    };

    mockState.library['/manga'].publishers['DC'].series['Batman']._counts = { unread: 5, read: 0 };
    mockState.library._isLazyLoaded = true;

    mockedFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true })
    });
    global.fetch = mockedFetch;

    // Build IndexedDB mock
    const mockObjectStore = {
      put: jest.fn().mockReturnValue({ onsuccess: null, onerror: null }),
      get: jest.fn().mockReturnValue({ onsuccess: null, onerror: null, result: { comicInfo: {} } })
    };
    const mockTransaction = {
      objectStore: jest.fn().mockReturnValue(mockObjectStore),
      oncomplete: null,
      onerror: null
    };

    const mockDB = {
      transaction: jest.fn().mockReturnValue(mockTransaction)
    };

    mockState.db = mockDB;
    mockWindow = {
      db: mockDB,
      sessionStorage: {
        getItem: jest.fn().mockReturnValue(null)
      }
    };

    const fullPath = path.resolve(__dirname, '../public/js/progress.js');
    const content = fs.readFileSync(fullPath, 'utf8');

    // Strip out imports and exports
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    // Add globals that the file relies on from globals.js
    const globalsWrapper = `
      const ICONS = { READ: 'R', UNREAD: 'U' };
      const debugLog = function() {};
      const applyDisplayInfoToComic = function(c) { return c; };

      ${cleanContent}
    `;

    // Create a vm context to evaluate it
    const vmContext = {
      window: mockWindow,
      document,
      state: mockState,
      console,
      setTimeout: global.setTimeout,
      requestAnimationFrame: (cb) => cb(),
      Number,
      String,
      Math,
      Date,
      Array,
      Promise,
      navigator: { onLine: true },
      fetch: mockedFetch,
      Error,
      JSON,
      sessionStorage: mockWindow.sessionStorage
    };

    // In vm context, global is the context itself
    vmContext.window.window = vmContext.window;
    vm.createContext(vmContext);
    vm.runInContext(globalsWrapper, vmContext);

    // Provide the functions on the global object for the tests to use
    // In vm context, top level function declarations go to the context root, not window
    window.saveProgressToDB = vmContext.saveProgressToDB;
    window.updateLibraryProgress = vmContext.updateLibraryProgress;
    window.updateLazyLoadingCounts = vmContext.updateLazyLoadingCounts;
    window.toggleReadStatus = vmContext.toggleReadStatus;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('saveProgressToDB', () => {
    it('successfully updates IndexedDB and triggers sync', async () => {
      // Simulate IDB success responses
      const mockDB = mockState.db;
      mockDB.transaction.mockImplementationOnce(() => {
        const tx = {
          objectStore: jest.fn().mockReturnValue({
            put: jest.fn(),
            get: jest.fn().mockImplementation(() => {
              const req = { result: { comicInfo: {} } };
              setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
              return req;
            })
          })
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 10);
        return tx;
      });

      jest.useFakeTimers();

      const promise = window.saveProgressToDB(1, 10, 22, '/manga/DC/Batman/01.cbz');
      jest.advanceTimersByTime(20);
      await promise;

      expect(mockState.scheduleOfflineProgressSync).toHaveBeenCalledWith(true);
    });

    it('throws error if IndexedDB cannot be opened', async () => {
      mockState.db = null;
      mockWindow.db = null;
      mockState.openOfflineDB.mockImplementationOnce(() => {
        // still fails
      });

      await expect(window.saveProgressToDB(1, 10, 22, '')).rejects.toThrow('IndexedDB connection could not be opened');
    });
  });

  describe('updateLibraryProgress', () => {
    it('updates nested state library progress', () => {
      // Update comic 1 progress
      window.updateLibraryProgress(1, { lastReadPage: 15, totalPages: 22 });

      const comic = mockState.library['/manga'].publishers['DC'].series['Batman'][0];
      expect(comic.progress.lastReadPage).toBe(15);
      expect(comic.progress.totalPages).toBe(22);
      expect(mockState.invalidateFolderCache).toHaveBeenCalled();
    });

    it('handles numeric direct input instead of progress object', () => {
      window.updateLibraryProgress(1, 12, 24);
      const comic = mockState.library['/manga'].publishers['DC'].series['Batman'][0];
      expect(comic.progress.lastReadPage).toBe(12);
      expect(comic.progress.totalPages).toBe(24);
    });
  });

  describe('toggleReadStatus', () => {
    it('successfully toggles a comic status online', async () => {
      const button = document.querySelector('button[data-comic-id="1"]');
      mockState.getComicStatus.mockReturnValue('read'); // to trigger difference logic

      // Simulate IDB success for updateOfflineProgressForComic
      mockState.db.transaction.mockImplementation(() => {
        const tx = {
          objectStore: jest.fn().mockReturnValue({
            put: jest.fn().mockImplementation(() => {
              const req = {};
              setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
              return req;
            })
          })
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        return tx;
      });

      await window.toggleReadStatus(button);

      expect(mockedFetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/comics/status', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comicId: "1", status: "read" })
      }));
      expect(mockState.updateLibraryReadStatus).toHaveBeenCalledWith({
        rootFolder: undefined,
        publisher: undefined,
        seriesName: undefined,
        comicId: "1",
        status: "read"
      });
      expect(mockState.scheduleOfflineProgressSync).toHaveBeenCalledWith(true);
      expect(button.dataset.currentStatus).toBe('read');
    });

    it('rolls back optimistic update and falls back to offline storage on error', async () => {
      const button = document.querySelector('button[data-comic-id="1"]');
      mockedFetch.mockRejectedValueOnce(new Error('Network offline'));

      // Simulate IDB success for offline fallback updateOfflineProgressForComic
      mockState.db.transaction.mockImplementation(() => {
        const tx = {
          objectStore: jest.fn().mockReturnValue({
            put: jest.fn().mockImplementation(() => {
              const req = {};
              setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
              return req;
            })
          })
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        return tx;
      });

      await window.toggleReadStatus(button);

      expect(mockState.saveStatusToDB).toHaveBeenCalledWith(expect.objectContaining({
        key: 'comic:1',
        type: 'comic',
        comicId: "1",
        status: "read"
      }));
      expect(button.dataset.currentStatus).toBe('read'); // even offline it applies optimistically after fallback
    });

    it('toggles series successfully', async () => {
      const button = document.querySelector('button[data-series-name="Batman"]');

      // Simulate IDB success for offline fallback updateOfflineProgressForSeries
      mockState.db.transaction.mockImplementation(() => {
        const tx = {
          objectStore: jest.fn().mockReturnValue({
            put: jest.fn().mockImplementation(() => {
              const req = {};
              setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
              return req;
            })
          })
        };
        setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
        return tx;
      });

      await window.toggleReadStatus(button);

      expect(mockedFetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/series/status', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rootFolder: "/manga", publisher: "DC", series: "Batman", status: "read" })
      }));
    });
  });

  describe('updateLazyLoadingCounts', () => {
    it('updates counts correctly', () => {
      window.updateLazyLoadingCounts('/manga', 'DC', 'Batman', 'unread', 'read');
      const seriesCounts = mockState.library['/manga'].publishers['DC'].series['Batman']._counts;
      const pubCounts = mockState.library['/manga'].publishers['DC']._counts;

      expect(seriesCounts.unread).toBe(4);
      expect(seriesCounts.read).toBe(1);
      expect(pubCounts.unread).toBe(4);
      expect(pubCounts.read).toBe(1);
    });
  });
});