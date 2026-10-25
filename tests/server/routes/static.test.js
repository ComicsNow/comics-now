const fs = require('fs');
const path = require('path');

// Mock express before requiring it so that jest can resolve it correctly if it's external in the app
jest.mock('express', () => {
  const mRouter = {
    get: jest.fn(),
    use: jest.fn()
  };
  return {
    Router: jest.fn(() => mRouter),
    static: jest.fn(() => 'mockStaticMiddleware')
  };
}, { virtual: true });

const express = require('express');

// Mock dependencies
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn()
  }
}));

jest.mock('../../../server/constants', () => ({
  PUBLIC_DIR: '/mock/public',
  ICONS_DIRECTORY: '/mock/icons',
  THUMBNAILS_DIRECTORY: '/mock/thumbnails',
  LOGOS_DIRECTORY: '/mock/logos'
}));

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

// Mock config module, since createStaticRouter uses `require('../config').isAuthEnabled()`
jest.mock('../../../server/config', () => ({
  isAuthEnabled: jest.fn(() => true)
}));

// We'll need to clear module cache for static.js to ensure mocks are applied
const { createStaticRouter } = require('../../../server/routes/static');

describe('Static Router', () => {
  let mockGetConfig;
  let mockGetComicsDirectories;
  let mockGetPublicLibraries;
  let router;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetConfig = jest.fn(() => ({
      baseUrl: 'http://localhost:3000/',
      authentication: {
        cloudflare: {
          teamDomain: 'test-team'
        }
      },
      hideSupportForAdmin: false
    }));

    mockGetComicsDirectories = jest.fn(() => []);
    mockGetPublicLibraries = jest.fn(() => [{ id: 1, name: 'Library' }]);

    // Default fs.existsSync for dist/index.html to true
    if (fs.existsSync) {
      fs.existsSync.mockImplementation((p) => {
        if (p === path.join('/mock/public', 'dist', 'index.html')) return true;
        return false;
      });
    }

    router = createStaticRouter({
      getConfig: mockGetConfig,
      getComicsDirectories: mockGetComicsDirectories,
      getPublicLibraries: mockGetPublicLibraries
    });
  });

  describe('Router Initialization', () => {
    it('should create an express router and register routes', () => {
      expect(express.Router).toHaveBeenCalled();
      expect(router.get).toHaveBeenCalledWith('/service-worker.js', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/favicon.ico', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('/index.html', expect.any(Function));
      expect(router.get).toHaveBeenCalledWith('*', expect.any(Function));

      // Should serve static files correctly
      expect(express.static).toHaveBeenCalled();

      // router.use is called multiple times, let's just check that it's called
      expect(router.use).toHaveBeenCalled();
    });
  });

  describe('Route Handlers', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        params: {},
        url: ''
      };
      res = {
        set: jest.fn(),
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        sendFile: jest.fn()
      };
      next = jest.fn();
    });

    describe('/index.html', () => {
      it('should read index.html and inject config', async () => {
        // Find the handler for /index.html
        const handler = router.get.mock.calls.find(call => call[0] === '/index.html')[1];

        fs.promises.readFile.mockResolvedValue('<html><head><script id="app-config"></script><base href="/"></head><body></body></html>');

        await handler(req, res);

        expect(fs.promises.readFile).toHaveBeenCalledWith(
          path.join('/mock/public', 'dist', 'index.html'),
          'utf-8'
        );
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');

        const sentHtml = res.send.mock.calls[0][0];
        expect(sentHtml).toContain('window.APP_CONFIG');
        expect(sentHtml).toContain('"baseUrl":"http://localhost:3000/"');
        expect(sentHtml).toContain('"cloudflareTeamDomain":"test-team"');
        expect(sentHtml).toContain('<base href="http://localhost:3000/">');
      });

      it('should handle error when reading index.html fails', async () => {
        const handler = router.get.mock.calls.find(call => call[0] === '/index.html')[1];

        fs.promises.readFile.mockRejectedValue(new Error('File not found'));

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.send).toHaveBeenCalledWith('Error loading application.');
      });
    });

    describe('/service-worker.js', () => {
      it('should inject dynamic cache version and asset paths', async () => {
        const handler = router.get.mock.calls.find(call => call[0] === '/service-worker.js')[1];

        fs.promises.readFile.mockResolvedValue(
          'const CACHE_VERSION = "v9.0-old";\nconst ASSET_PATHS = ["index.html"];'
        );
        fs.promises.stat.mockResolvedValue({ mtimeMs: 1234567890 });
        fs.promises.readdir.mockResolvedValue(['main.js', 'style.css', 'app.map']);

        await handler(req, res);

        expect(fs.promises.readFile).toHaveBeenCalledWith(
          path.join('/mock/public', 'service-worker.js'),
          'utf-8'
        );
        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript; charset=utf-8');

        const sentContent = res.send.mock.calls[0][0];
        expect(sentContent).toContain("const CACHE_VERSION = 'v9.0-1234567890';");
        expect(sentContent).toContain('assets/main.js');
        expect(sentContent).toContain('assets/style.css');
        expect(sentContent).not.toContain('assets/app.map');
      });

      it('should fallback to serving service worker file directly on error', async () => {
        const handler = router.get.mock.calls.find(call => call[0] === '/service-worker.js')[1];

        fs.promises.readFile.mockRejectedValue(new Error('File not found'));

        await handler(req, res);

        expect(res.sendFile).toHaveBeenCalledWith(path.join('/mock/public', 'service-worker.js'));
      });
    });

    describe('/favicon.ico', () => {
      it('should send favicon', () => {
        const handler = router.get.mock.calls.find(call => call[0] === '/favicon.ico')[1];

        handler(req, res);

        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400');
        expect(res.sendFile).toHaveBeenCalledWith(path.join('/mock/icons', 'icon-192x192.png'));
      });
    });
  });
});
