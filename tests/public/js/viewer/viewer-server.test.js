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
      createObjectURL: jest.fn(() => 'blob:mock-url')
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
