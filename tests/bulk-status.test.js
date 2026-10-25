/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Bulk Status UI', () => {
  let sandbox;
  let bulkStatusModule;
  const realSetTimeout = global.setTimeout;

  beforeEach(() => {
    document.body.innerHTML = '';

    sandbox = {
      window,
      document,
      console,
      Date,
      JSON,
      Math,
      alert: jest.fn(),
      fetch: jest.fn(),
      state: {
        API_BASE_URL: '',
        library: {},
        updateLibraryReadStatus: jest.fn(),
        applyFilterAndRender: jest.fn()
      }
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const filePath = path.resolve(__dirname, '../public/js/bulk-status.js');
    const content = fs.readFileSync(filePath, 'utf8');

    // Clean up ES6 syntax and make variables available on sandbox
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
    bulkStatusModule = sandbox;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function tick() {
    return new Promise((resolve) => realSetTimeout(resolve, 0));
  }

  // Basic sanity check to ensure setup worked
  test('should load the module successfully', () => {
    expect(typeof bulkStatusModule.state.openBulkReadStatusDialog).toBe('function');
    expect(typeof bulkStatusModule.state.closeBulkReadStatusDialog).toBe('function');
  });

  test('openBulkReadStatusDialog alerts when comics array is empty', () => {
    bulkStatusModule.state.openBulkReadStatusDialog([], 'Test Scope');
    expect(sandbox.alert).toHaveBeenCalledWith('No comics in this selection.');
    const modal = document.getElementById('bulk-status-modal');
    expect(modal).toBeNull();
  });

  test('openBulkReadStatusDialog renders modal and correct counts', () => {
    const mockComics = [
      { id: 1, progress: { totalPages: 10, lastReadPage: 9 } }, // read
      { id: 2, progress: { totalPages: 10, lastReadPage: 10 } }, // read
      { id: 3, progress: { totalPages: 10, lastReadPage: 5 } }, // in-progress
      { id: 4, progress: {} }, // unread
      { id: 5 } // unread
    ];

    bulkStatusModule.state.openBulkReadStatusDialog(mockComics, 'My Custom List');

    const modal = document.getElementById('bulk-status-modal');
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('hidden')).toBe(false);

    const scopeEl = document.getElementById('bulk-status-scope');
    expect(scopeEl.textContent).toBe('5 comics in My Custom List.');

    const countsEl = document.getElementById('bulk-status-counts');
    const countsHtml = countsEl.innerHTML;
    // 2 read, 1 in-progress, 2 unread
    expect(countsHtml).toContain('>2<');
    expect(countsHtml).toContain('>1<');
    expect(countsHtml).toContain('>2<');
    expect(countsHtml).toContain('Read');
    expect(countsHtml).toContain('In progress');
    expect(countsHtml).toContain('Unread');
  });

  test('updates status correctly when Mark all Read is clicked', async () => {
    const mockComics = [
      { id: 'c1' },
      { id: 'c2' }
    ];


    const mockSeriesComics = [{ id: 'c1' }];
    mockSeriesComics._counts = { total: 5 };
    sandbox.state.library = {
      'folder': {
        publishers: {
          'pub': {
            _counts: { total: 10 },
            series: {
              'ser': mockSeriesComics
            }
          }
        }
      }
    };

    // Setup fetch mock to return success
    sandbox.fetch.mockImplementation(() => Promise.resolve({ ok: true }));

    bulkStatusModule.state.openBulkReadStatusDialog(mockComics, 'Test Scope');

    const readBtn = document.getElementById('bulk-status-mark-read');
    expect(readBtn).not.toBeNull();

    readBtn.click();
    await tick();

    // Check fetch calls
    expect(sandbox.fetch).toHaveBeenCalledTimes(2);
    expect(sandbox.fetch).toHaveBeenCalledWith(
      '/api/v1/comics/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comicId: 'c1', status: 'read' })
      })
    );

    // Check callbacks
    expect(sandbox.state.updateLibraryReadStatus).toHaveBeenCalledTimes(2);
    expect(sandbox.state.updateLibraryReadStatus).toHaveBeenCalledWith({ comicId: 'c1', status: 'read' });
    expect(sandbox.state.applyFilterAndRender).toHaveBeenCalled();

    // Check cache invalidation
    expect(sandbox.state.library['folder'].publishers['pub']._counts).toBeUndefined();
    expect(sandbox.state.library['folder'].publishers['pub'].series['ser']._counts).toBeUndefined();

    // Check modal close
    const modal = document.getElementById('bulk-status-modal');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('updates status correctly when Mark all Unread is clicked', async () => {
    const mockComics = [
      { id: 'c3' }
    ];

    sandbox.fetch.mockImplementation(() => Promise.resolve({ ok: true }));

    bulkStatusModule.state.openBulkReadStatusDialog(mockComics, 'Test Scope');

    const unreadBtn = document.getElementById('bulk-status-mark-unread');
    expect(unreadBtn).not.toBeNull();

    unreadBtn.click();
    await tick();

    expect(sandbox.fetch).toHaveBeenCalledWith(
      '/api/v1/comics/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ comicId: 'c3', status: 'unread' })
      })
    );
    expect(sandbox.state.updateLibraryReadStatus).toHaveBeenCalledWith({ comicId: 'c3', status: 'unread' });
  });
});
