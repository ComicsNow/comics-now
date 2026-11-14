/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLocalViewerSandbox() {
  let blobCounter = 0;
  const state = {
    currentComic: {
      id: 'local-1',
      name: 'Issue 1.cbr',
      file: new Blob(['rar-bytes']),
      progress: { totalPages: 6, lastReadPage: 0 }
    },
    currentPageIndex: 0,
    pageUrlCache: new Map(),
    preloadedImages: new Map(),
    inFlightPageLoads: new Map(),
    PRELOAD_AHEAD_COUNT: 2,
    getViewerPages: () => ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg', 'p6.jpg']
  };

  const sandbox = {
    window: window,
    document: document,
    sessionStorage: window.sessionStorage,
    state: state,
    canonicalGlobal: state,
    console: console,
    URL: {
      createObjectURL: jest.fn(() => `blob:local-${++blobCounter}`),
      revokeObjectURL: jest.fn()
    },
    Image: function MockImage() {
      const el = document.createElement('img');
      Object.defineProperty(el, 'complete', { value: true, writable: true, configurable: true });
      return el;
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
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
      .replace(/const\s+global\s*=/g, 'var global =')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+/g, '');
    vm.runInContext(cleanContent, sandbox);
  }

  loadFile('../../../../public/js/viewer/server/preloader.js');
  loadFile('../../../../public/js/viewer/viewer-local.js');

  return { sandbox, state };
}

describe('public/js/viewer/viewer-local.js (Bug 2 + local CBR/CBZ)', () => {
  it('uses currentComicArchiveCache before handle.getFile and supports openClientArchive for CBR', async () => {
    const { sandbox, state } = createLocalViewerSandbox();
    const mockArchive = {
      getPageBlob: jest.fn().mockResolvedValue(new Blob(['img']))
    };
    state.openClientArchive = jest.fn().mockResolvedValue(mockArchive);
    sandbox.openClientArchive = state.openClientArchive;

    const getFileMock = jest.fn().mockResolvedValue(new Blob(['rar-bytes']));
    state.currentComic = {
      id: 'local-cbr-1',
      name: 'Issue 1.cbr',
      handle: { getFile: getFileMock },
      progress: { totalPages: 6, lastReadPage: 0 }
    };

    const url1 = await sandbox.getPageUrl('p1.jpg');
    expect(url1).toBe('blob:local-1');
    expect(getFileMock).toHaveBeenCalledTimes(1);
    expect(state.openClientArchive).toHaveBeenCalledTimes(1);

    // Second page must hit memory-first archive cache and NOT call handle.getFile() again
    const url2 = await sandbox.getPageUrl('p2.jpg');
    expect(url2).toBe('blob:local-2');
    expect(getFileMock).toHaveBeenCalledTimes(1);
  });

  it('preloadPages preloads lookahead pages and prunePreloadedImages revokes out-of-window blob URLs', async () => {
    const { sandbox, state } = createLocalViewerSandbox();
    const mockArchive = {
      getPageBlob: jest.fn().mockResolvedValue(new Blob(['img']))
    };
    state.currentComicArchiveCache = { id: 'local-1', archive: mockArchive };

    const pages = state.getViewerPages();
    sandbox.preloadPages(0, pages);
    await new Promise(r => setTimeout(r, 20));

    // Lookahead is 2: p2.jpg (blob:local-1) and p3.jpg (blob:local-2)
    expect(state.pageUrlCache.has('p2.jpg')).toBe(true);
    expect(state.pageUrlCache.has('p3.jpg')).toBe(true);
    expect(state.preloadedImages.size).toBe(2);

    // Now advance to index 5 (window [3, 6)); p2.jpg and p3.jpg must be pruned & revoked
    sandbox.prunePreloadedImages(5, pages);
    await new Promise(r => setTimeout(r, 20));

    expect(state.pageUrlCache.has('p2.jpg')).toBe(false);
    expect(state.pageUrlCache.has('p3.jpg')).toBe(false);
    expect(state.preloadedImages.size).toBe(0);
    expect(sandbox.URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-1');
    expect(sandbox.URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-2');
  });

  it('renderPage triggers preloadPages for upcoming local pages', async () => {
    const { sandbox, state } = createLocalViewerSandbox();
    const mockArchive = {
      getPageBlob: jest.fn().mockResolvedValue(new Blob(['img']))
    };
    state.currentComicArchiveCache = { id: 'local-1', archive: mockArchive };
    document.body.innerHTML = '<div id="viewer-pages"></div>';
    state.viewerPagesDiv = document.getElementById('viewer-pages');

    const ok = await sandbox.renderPage();
    await new Promise(r => setTimeout(r, 20));

    expect(ok).toBe(true);
    expect(state.pageUrlCache.has('p2.jpg')).toBe(true);
    expect(state.pageUrlCache.has('p3.jpg')).toBe(true);
  });
});
