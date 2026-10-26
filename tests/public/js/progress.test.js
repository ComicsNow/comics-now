/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Progress JS Module', () => {
  let sandbox;
  let env;

  beforeEach(() => {
    jest.clearAllMocks();

    const state = {
      API_BASE_URL: '',
      db: null,
      library: {
        _isLazyLoaded: true,
        'Folder1': {
          publishers: {
            'DC': {
              _counts: { unread: 5, read: 2 },
              series: {
                'Batman': {
                  _counts: { unread: 3, read: 1 },
                  _hasDetails: false
                }
              }
            }
          }
        }
      },
      updateLibraryReadStatus: jest.fn(),
      applyFilterAndRender: jest.fn(),
      scheduleOfflineProgressSync: jest.fn(),
      saveLibraryCacheToDB: jest.fn().mockResolvedValue(),
      saveStatusToDB: jest.fn().mockResolvedValue(),
      getSeriesComics: jest.fn().mockResolvedValue([]),
      updateOfflineProgressForComic: jest.fn().mockResolvedValue(),
      updateOfflineProgressForSeries: jest.fn().mockResolvedValue(),
      openOfflineDB: jest.fn().mockResolvedValue()
    };

    sandbox = {
      window: {
        location: { pathname: '/' }
      },
      document: {
        querySelectorAll: jest.fn(() => []),
        createElement: jest.fn((tag) => ({
          className: '',
          textContent: '',
          style: {},
          remove: jest.fn()
        })),
        getElementById: jest.fn(() => null)
      },
      navigator: { onLine: true },
      state,
      console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      fetch: jest.fn(),
      setTimeout: (fn, ms) => fn(),
      requestAnimationFrame: (fn) => fn(),
      Date: global.Date,
      Number: global.Number,
      String: global.String,
      Array: global.Array,
      JSON: global.JSON,
      Error: global.Error,
      Promise: global.Promise
    };

    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    // Provide dependencies
    sandbox.ICONS = { READ: 'icon-read', UNREAD: 'icon-unread' };
    sandbox.debugLog = jest.fn();
    sandbox.applyDisplayInfoToComic = jest.fn();

    const fullPath = path.resolve(__dirname, '../../../public/js/progress.js');
    let content = fs.readFileSync(fullPath, 'utf8');

    // Strip imports and exports for VM execution
    content = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    const script = new vm.Script(content);
    script.runInContext(sandbox);

    // Add exports to sandbox object explicitly for easier access in tests
    // because they get attached to the sandbox implicitly by vm
  });

  describe('updateLazyLoadingCounts', () => {
    it('should correctly increment and decrement counts', () => {
      sandbox.updateLazyLoadingCounts('Folder1', 'DC', 'Batman', 'unread', 'read');

      const seriesData = sandbox.state.library['Folder1'].publishers['DC'].series['Batman'];
      expect(seriesData._counts.unread).toBe(2);
      expect(seriesData._counts.read).toBe(2);

      const publisherData = sandbox.state.library['Folder1'].publishers['DC'];
      expect(publisherData._counts.unread).toBe(4);
      expect(publisherData._counts.read).toBe(3);
    });

    it('should do nothing if library is not lazy loaded', () => {
      sandbox.state.library._isLazyLoaded = false;
      sandbox.updateLazyLoadingCounts('Folder1', 'DC', 'Batman', 'unread', 'read');

      const seriesData = sandbox.state.library['Folder1'].publishers['DC'].series['Batman'];
      expect(seriesData._counts.unread).toBe(3); // unchanged
    });
  });

  describe('updateCardBanner', () => {
    it('should fade out old banner and create new one if status is read', () => {
      const mockOldBanner = {
        classList: { add: jest.fn() },
        remove: jest.fn()
      };

      const mockImageContainer = {
        querySelector: jest.fn().mockReturnValue(mockOldBanner),
        insertBefore: jest.fn(),
        firstChild: {}
      };

      const mockCardButton = {};

      const mockCard = {
        querySelector: jest.fn((sel) => {
          if (sel.includes('data-comic-id')) return mockCardButton;
          if (sel === '.relative') return mockImageContainer;
          return null;
        })
      };

      sandbox.document.querySelectorAll.mockReturnValue([mockCard]);

      sandbox.updateCardBanner('123', 'read');

      expect(mockOldBanner.classList.add).toHaveBeenCalledWith('fade-out');
      expect(mockImageContainer.insertBefore).toHaveBeenCalled();
    });
  });

  describe('toggleReadStatus', () => {
    it('should toggle comic status from unread to read successfully', async () => {
      sandbox.fetch.mockResolvedValueOnce({ ok: true });

      const button = {
        dataset: {
          comicId: '123',
          rootFolder: 'Folder1',
          publisher: 'DC',
          currentStatus: 'unread'
        },
        innerHTML: 'icon-unread',
        className: 'text-gray-400',
        classList: {
          add: jest.fn(),
          remove: jest.fn()
        }
      };

      await sandbox.toggleReadStatus(button);

      expect(button.dataset.currentStatus).toBe('read');
      expect(button.innerHTML).toBe(sandbox.ICONS.READ);
      expect(button.classList.add).toHaveBeenCalledWith('text-green-400');

      expect(sandbox.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/comics/status'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ comicId: '123', status: 'read' })
        })
      );

      expect(sandbox.state.updateLibraryReadStatus).toHaveBeenCalled();
      expect(sandbox.state.applyFilterAndRender).toHaveBeenCalled();
      expect(sandbox.state.scheduleOfflineProgressSync).toHaveBeenCalledWith(true);
    });

    it('should fallback to offline storage when fetch fails', async () => {
      sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));

      const button = {
        dataset: {
          comicId: '123',
          rootFolder: 'Folder1',
          publisher: 'DC',
          currentStatus: 'unread'
        },
        innerHTML: 'icon-unread',
        className: 'text-gray-400',
        classList: {
          add: jest.fn(),
          remove: jest.fn()
        }
      };

      await sandbox.toggleReadStatus(button);

      // Falls back successfully and UI still says read
      expect(button.dataset.currentStatus).toBe('read');
      expect(button.innerHTML).toBe(sandbox.ICONS.READ);

      expect(sandbox.state.saveStatusToDB).toHaveBeenCalledWith({
        key: 'comic:123',
        type: 'comic',
        comicId: '123',
        status: 'read'
      });

      expect(sandbox.state.updateLibraryReadStatus).toHaveBeenCalled();
    });
  });

  describe('saveProgressToDB', () => {
    it('should save progress to indexedDB correctly', async () => {
      const mockProgressStore = { put: jest.fn() };
      const mockComicsStore = {
        get: jest.fn().mockReturnValue({ onsuccess: null, result: { comicInfo: { progress: null } }, put: jest.fn() })
      };

      const mockTransaction = {
        objectStore: jest.fn((storeName) => {
          if (storeName === 'progress') return mockProgressStore;
          if (storeName === 'comics') return mockComicsStore;
        }),
        oncomplete: null
      };

      sandbox.state.db = {
        transaction: jest.fn().mockReturnValue(mockTransaction)
      };

      // Wrap saveProgressToDB call and manually trigger oncomplete to resolve promise
      const savePromise = sandbox.saveProgressToDB('123', 5, 20, '/path/to/comic');

      if (mockTransaction.oncomplete) {
        mockTransaction.oncomplete();
      }

      await savePromise;

      expect(sandbox.state.db.transaction).toHaveBeenCalledWith(['progress', 'comics'], 'readwrite');
      expect(mockProgressStore.put).toHaveBeenCalledWith(expect.objectContaining({
        id: '123',
        lastReadPage: 5,
        page: 5,
        totalPages: 20,
        comicPath: '/path/to/comic',
        synced: false
      }));
    });
  });
});
