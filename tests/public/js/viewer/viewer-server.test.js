/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createViewerServerSandbox() {
  const state = {
    API_BASE_URL: 'http://localhost:3000',
    encodePath: (p) => p.replace(/\//g, '|'),
    currentComic: {
      id: 'comic-123',
      path: 'DC/Batman/01.cbz',
      progress: { lastReadPage: 0, totalPages: 25 }
    },
    pageUrlCache: new Map(),
    preloadedImages: new Map(),
    PRELOAD_AHEAD_COUNT: 3
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    canonicalGlobal: state,
    console: console,
    fetch: jest.fn(),
    URL: {
      createObjectURL: jest.fn(() => 'blob:mock-url'),
      revokeObjectURL: jest.fn()
    },
    Image: class {
      constructor() {
        this.src = '';
        this.complete = true;
      }
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

  return { sandbox, state, loadFile };
}

describe('public/js/viewer/viewer-server.js', () => {
  let ctx;

  beforeEach(() => {
    ctx = createViewerServerSandbox();
    ctx.loadFile('../../../../public/js/viewer/server/preloader.js');
    ctx.loadFile('../../../../public/js/viewer/server/navigation.js');
    ctx.loadFile('../../../../public/js/viewer/viewer-server.js');
  });

  describe('getPageUrl', () => {
    it('constructs correct API url with fmt=webp and caches it', async () => {
      const getPageUrl = ctx.sandbox.getPageUrl;
      const url = await getPageUrl('page_001.jpg');
      expect(url).toContain('/api/v1/comics/pages/image');
      expect(url).toContain('fmt=webp');
      expect(url).toContain(encodeURIComponent('page_001.jpg'));
      expect(ctx.state.pageUrlCache.get('page_001.jpg')).toBe(url);

      const cached = await getPageUrl('page_001.jpg');
      expect(cached).toBe(url);
    });

    it('returns null if no currentComic is set', async () => {
      ctx.state.currentComic = null;
      const url = await ctx.sandbox.getPageUrl('page_001.jpg');
      expect(url).toBeNull();
    });
  });

  describe('preloadPages and prunePreloadedImages', () => {
    it('prunes URLs outside of the lookahead and lookbehind window', async () => {
      const getPageUrl = ctx.sandbox.getPageUrl;
      const prunePreloadedImages = ctx.sandbox.prunePreloadedImages;

      const pages = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg', 'p6.jpg', 'p7.jpg', 'p8.jpg', 'p9.jpg'];
      const url1 = await getPageUrl('p1.jpg');
      const url5 = await getPageUrl('p5.jpg');
      const url9 = await getPageUrl('p9.jpg');

      ctx.state.preloadedImages.set(url1, {});
      ctx.state.preloadedImages.set(url5, {});
      ctx.state.preloadedImages.set(url9, {});

      prunePreloadedImages(4, pages);
      await new Promise(r => setTimeout(r, 20));

      expect(ctx.state.preloadedImages.has(url5)).toBe(true);
      expect(ctx.state.preloadedImages.has(url9)).toBe(false);
    });

    it('revokes blob: URLs via URL.revokeObjectURL and does not call getPageUrl for backward pages', async () => {
      const getPageUrl = ctx.sandbox.getPageUrl;
      const prunePreloadedImages = ctx.sandbox.prunePreloadedImages;

      const pages = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg', 'p5.jpg', 'p6.jpg'];
      const blobUrl1 = 'blob:http://localhost/page-1';
      ctx.state.pageUrlCache.set('p1.jpg', blobUrl1);
      ctx.state.preloadedImages.set(blobUrl1, {});

      // p2.jpg is uncached; pruning from index 5 with behind=2 must NOT call getComicFromDB
      ctx.state.getComicFromDB = jest.fn().mockResolvedValue(null);
      ctx.sandbox.getComicFromDB = ctx.state.getComicFromDB;

      prunePreloadedImages(5, pages);
      await new Promise(r => setTimeout(r, 20));

      expect(ctx.sandbox.URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl1);
      expect(ctx.state.pageUrlCache.has('p1.jpg')).toBe(false);
      expect(ctx.state.preloadedImages.has(blobUrl1)).toBe(false);
      expect(ctx.state.getComicFromDB).not.toHaveBeenCalled();
    });
  });

  describe('memory-first archive cache and CBR/CBZ extraction (Points 1 & 6)', () => {
    it('checks currentComicArchiveCache before calling getComicFromDB', async () => {
      ctx.state.getComicFromDB = jest.fn().mockResolvedValue(null);
      ctx.sandbox.getComicFromDB = ctx.state.getComicFromDB;
      const mockArchive = {
        getPageBlob: jest.fn().mockResolvedValue(new Blob(['img']))
      };
      ctx.state.currentComicArchiveCache = { id: 'comic-123', archive: mockArchive };

      const url = await ctx.sandbox.getPageUrl('page_001.jpg');

      expect(url).toBe('blob:mock-url');
      expect(mockArchive.getPageBlob).toHaveBeenCalledWith('page_001.jpg');
      expect(ctx.state.getComicFromDB).not.toHaveBeenCalled();
    });

    it('uses openClientArchive for offline CBR/CBZ and caches failure sentinel to avoid retry loops', async () => {
      const mockArchive = {
        getPageBlob: jest.fn().mockResolvedValue(new Blob(['cbr-img']))
      };
      ctx.state.openClientArchive = jest.fn().mockResolvedValue(mockArchive);
      ctx.sandbox.openClientArchive = ctx.state.openClientArchive;
      ctx.state.getComicFromDB = jest.fn().mockResolvedValue({
        id: 'comic-123',
        fileBlob: new Blob(['rar-bytes'])
      });
      ctx.sandbox.getComicFromDB = ctx.state.getComicFromDB;

      const url = await ctx.sandbox.getPageUrl('01.jpg');
      expect(url).toBe('blob:mock-url');
      expect(ctx.state.openClientArchive).toHaveBeenCalledTimes(1);

      // Now simulate extraction failure on a new comic
      ctx.state.pageUrlCache.clear();
      ctx.state.currentComicArchiveCache = null;
      ctx.state.currentComic = {
        id: 'comic-bad',
        path: 'DC/Batman/bad.cbr',
        progress: { lastReadPage: 0, totalPages: 5 }
      };
      ctx.state.openClientArchive = jest.fn().mockRejectedValue(new Error('Corrupt RAR'));
      ctx.sandbox.openClientArchive = ctx.state.openClientArchive;

      const fallback1 = await ctx.sandbox.getPageUrl('01.jpg');
      const fallback2 = await ctx.sandbox.getPageUrl('02.jpg');

      expect(fallback1).toContain('/api/v1/comics/pages/image');
      expect(fallback2).toContain('/api/v1/comics/pages/image');
      expect(ctx.state.openClientArchive).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-flight preload deduplication (Point 5)', () => {
    it('shares in-flight Image load between preloadPages and renderPage', async () => {
      let createdImages = 0;
      let pendingImg = null;
      ctx.sandbox.Image = class {
        constructor() {
          createdImages += 1;
          this.src = '';
          this.complete = false;
          this.onload = null;
          this.onerror = null;
          pendingImg = this;
        }
      };

      const pages = ['p1.jpg', 'p2.jpg', 'p3.jpg'];
      ctx.sandbox.preloadPages(0, pages);
      // Allow getPageUrl promise microtask to kick off image load
      await new Promise(r => setTimeout(r, 10));

      expect(createdImages).toBe(2); // p2.jpg and p3.jpg
      expect(ctx.state.inFlightPageLoads?.size).toBeGreaterThan(0);

      // Set up minimal DOM for renderPage(1)
      document.body.innerHTML = '<div id="viewer-container"></div><img id="comic-page" />';
      ctx.state.currentPages = pages;
      ctx.state.currentPageIndex = 0;
      ctx.state.viewerContainer = document.getElementById('viewer-container');
      ctx.state.comicPageImg = document.getElementById('comic-page');

      const renderPromise = ctx.sandbox.renderPage(1);
      await new Promise(r => setTimeout(r, 10));

      // renderPage must reuse the in-flight load for p2.jpg rather than creating a 3rd Image
      expect(createdImages).toBe(2);

      // Complete all pending images
      for (const entry of ctx.state.inFlightPageLoads.values()) {
        if (entry && entry.img && entry.img.onload) {
          entry.img.complete = true;
          entry.img.onload();
        }
      }
      if (pendingImg && pendingImg.onload) {
        pendingImg.complete = true;
        pendingImg.onload();
      }
      await renderPromise;
    });
  });

  describe('next-issue cover prefetching (Enhancement 3)', () => {
    it('prefetches page 0 of next comic when within last 2 pages', async () => {
      const createdSrcs = [];
      ctx.sandbox.Image = class {
        constructor() {
          this._src = '';
          this.complete = true;
        }
        set src(val) {
          this._src = val;
          createdSrcs.push(val);
        }
        get src() {
          return this._src;
        }
      };

      ctx.state.getNextComicInSeries = jest.fn().mockResolvedValue({
        id: 'comic-124',
        path: 'DC/Batman/02.cbz',
        pages: ['cover_02.jpg']
      });
      ctx.sandbox.getNextComicInSeries = ctx.state.getNextComicInSeries;

      const pages = ['p1.jpg', 'p2.jpg', 'p3.jpg', 'p4.jpg'];
      await ctx.sandbox.prefetchNextComicCover?.(2, pages);

      expect(ctx.state.getNextComicInSeries).toHaveBeenCalled();
      expect(createdSrcs.some(s => s.includes('02.cbz') && s.includes('cover_02.jpg'))).toBe(true);
    });
  });

  describe('saveProgress', () => {
    it('updates currentComic.progress.lastReadPage and calls syncManager', async () => {
      const mockSync = { updateProgress: jest.fn().mockResolvedValue(true) };
      ctx.sandbox.window.syncManager = mockSync;
      ctx.state.window = ctx.sandbox.window;
      ctx.sandbox.syncManager = mockSync;

      await ctx.sandbox.saveProgress(5);
      expect(ctx.state.currentComic.progress.lastReadPage).toBe(5);
      expect(mockSync.updateProgress).toHaveBeenCalledWith('comic-123', 5);
    });
  });

  describe('initServerViewer', () => {
    it('wires up methods to state', () => {
      ctx.sandbox.initServerViewer();
      expect(ctx.state.getPageUrl).toBeDefined();
      expect(ctx.state.preloadPages).toBeDefined();
      expect(ctx.state.renderPage).toBeDefined();
    });
  });
});
