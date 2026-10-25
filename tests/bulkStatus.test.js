/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Bulk Status Updates (bulk-status.js)', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    document.body.innerHTML = '';

    state = {
      library: {},
      API_BASE_URL: 'http://localhost',
      updateLibraryReadStatus: jest.fn(),
      applyFilterAndRender: jest.fn(),
    };

    sandbox = {
      window: {
        ...window,
        alert: jest.fn(),
        API_BASE_URL: 'http://localhost',
      },
      document,
      state,
      console,
      alert: jest.fn(),
      fetch: jest.fn().mockResolvedValue({ ok: true }),
      setTimeout,
      clearTimeout,
    };

    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../public/js/bulk-status.js');
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getComicReadStatus', () => {
    it('returns "read" when total > 0 and lastRead >= total - 1', () => {
      const getComicReadStatus = vm.runInContext('getComicReadStatus', sandbox);
      expect(getComicReadStatus({ progress: { totalPages: 10, lastReadPage: 9 } })).toBe('read');
      expect(getComicReadStatus({ progress: { totalPages: 10, lastReadPage: 10 } })).toBe('read');
    });

    it('returns "in-progress" when lastRead > 0 and not completed', () => {
      const getComicReadStatus = vm.runInContext('getComicReadStatus', sandbox);
      expect(getComicReadStatus({ progress: { totalPages: 10, lastReadPage: 5 } })).toBe('in-progress');
      expect(getComicReadStatus({ progress: { totalPages: 0, lastReadPage: 5 } })).toBe('in-progress');
    });

    it('returns "unread" when no progress or lastRead is 0', () => {
      const getComicReadStatus = vm.runInContext('getComicReadStatus', sandbox);
      expect(getComicReadStatus({ progress: { totalPages: 10, lastReadPage: 0 } })).toBe('unread');
      expect(getComicReadStatus({})).toBe('unread');
      expect(getComicReadStatus({ progress: {} })).toBe('unread');
    });
  });

  describe('open & close UI Modal', () => {
    it('alerts user and does not open modal if no comics are passed', () => {
      const open = vm.runInContext('open', sandbox);
      open([], 'selection');
      expect(sandbox.alert).toHaveBeenCalledWith('No comics in this selection.');
      expect(document.getElementById('bulk-status-modal')).toBeNull();
    });

    it('renders the modal, counts statuses, and shows scope label', () => {
      const open = vm.runInContext('open', sandbox);
      const comics = [
        { id: 1, progress: { totalPages: 10, lastReadPage: 9 } }, // read
        { id: 2, progress: { totalPages: 10, lastReadPage: 5 } }, // in-progress
        { id: 3, progress: { totalPages: 10, lastReadPage: 0 } }, // unread
        { id: 4 } // unread
      ];

      open(comics, 'test-scope');

      const modal = document.getElementById('bulk-status-modal');
      expect(modal).not.toBeNull();
      expect(modal.classList.contains('hidden')).toBe(false);

      const scopeEl = document.getElementById('bulk-status-scope');
      expect(scopeEl.textContent).toBe('4 comics in test-scope.');

      const countsEl = document.getElementById('bulk-status-counts');
      expect(countsEl.innerHTML).toContain('1</div><div>Read</div>');
      expect(countsEl.innerHTML).toContain('1</div><div>In progress</div>');
      expect(countsEl.innerHTML).toContain('2</div><div>Unread</div>');
    });

    it('closes the modal by adding the "hidden" class', () => {
      const open = vm.runInContext('open', sandbox);
      const close = vm.runInContext('close', sandbox);

      open([{ id: 1 }], 'test');
      const modal = document.getElementById('bulk-status-modal');
      expect(modal.classList.contains('hidden')).toBe(false);

      close();
      expect(modal.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Actions & applyStatus', () => {
    it('calls fetch for each comic, invalidates cache, and updates library on "Mark all Read"', async () => {
      const open = vm.runInContext('open', sandbox);
      const comics = [
        { id: 1 },
        { id: 2 }
      ];

      // Setup mock library structure for cache invalidation test
      state.library = {
        '/comics': {
          publishers: {
            'DC': {
              _counts: { total: 10 },
              series: {
                'Batman': {
                  _counts: { total: 5 },
                  0: { id: 1 },
                  1: { id: 2 },
                  length: 2,
                  some: Array.prototype.some,
                  map: Array.prototype.map,
                }
              }
            }
          }
        }
      };

      // Ensure Array methods work for the mocked series array-like object if needed,
      // but invalidateCachedCounts uses Array.isArray which would fail.
      // Let's use a real array.
      state.library['/comics'].publishers['DC'].series['Batman'] = [{id: 1}, {id: 2}];
      state.library['/comics'].publishers['DC'].series['Batman']._counts = { total: 5 };

      open(comics, 'test');

      const readBtn = document.getElementById('bulk-status-mark-read');
      const progressEl = document.getElementById('bulk-status-progress');

      // Mock invalidateCachedCounts being called inside applyStatus (it will use state.library)

      await readBtn.click();

      // We need to wait a tick for async click handler
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sandbox.fetch).toHaveBeenCalledTimes(2);
      expect(sandbox.fetch).toHaveBeenCalledWith('http://localhost/api/v1/comics/status', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comicId: 1, status: 'read' })
      }));
      expect(sandbox.fetch).toHaveBeenCalledWith('http://localhost/api/v1/comics/status', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comicId: 2, status: 'read' })
      }));

      expect(state.updateLibraryReadStatus).toHaveBeenCalledTimes(2);
      expect(state.applyFilterAndRender).toHaveBeenCalled();

      // Check if caches were invalidated
      expect(state.library['/comics'].publishers['DC']._counts).toBeUndefined();
      expect(state.library['/comics'].publishers['DC'].series['Batman']._counts).toBeUndefined();

      // Modal should be hidden after finish
      const modal = document.getElementById('bulk-status-modal');
      expect(modal.classList.contains('hidden')).toBe(true);
    });
  });
});
