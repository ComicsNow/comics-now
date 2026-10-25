const path = require('path');
const { createStaticRouter } = require('../../../server/routes/static');

jest.mock('fs', () => {
  return {
    existsSync: jest.fn(),
    stat: jest.fn((p, cb) => {
      // Simulate ENOENT for static middleware to pass control to the route handler
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      cb(err);
    }),
    promises: {
      readFile: jest.fn(),
      stat: jest.fn(),
      readdir: jest.fn()
    }
  };
});

const fs = require('fs');

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

jest.mock('../../../server/config', () => ({
  isAuthEnabled: jest.fn().mockReturnValue(true)
}));

jest.mock('../../../server/db', () => ({
  dbGet: jest.fn(),
  dbRun: jest.fn()
}));

jest.mock('../../../server/services/library-pages', () => ({
  generateThumbnail: jest.fn()
}));

const mockDeps = {
  getConfig: jest.fn(() => ({
    baseUrl: '/',
    hideSupportForAdmin: false,
    authentication: {}
  })),
  getComicsDirectories: jest.fn(() => []),
  getPublicLibraries: jest.fn(() => [])
};

describe('Static Router', () => {
  let router;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    router = createStaticRouter(mockDeps);
  });

  const mockReqRes = (url, params = {}) => {
    const req = {
      method: 'GET',
      url,
      path: url,
      headers: {},
      params
    };

    const res = {
      statusCode: 200,
      headers: {},
      setHeader: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
      set: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
      status: jest.fn((code) => { res.statusCode = code; return res; }),
      send: jest.fn(),
      sendFile: jest.fn(),
      json: jest.fn()
    };

    return { req, res };
  };

  test('GET /favicon.ico responds with correct file', () => {
    return new Promise((resolve, reject) => {
      const { req, res } = mockReqRes('/favicon.ico');

      res.sendFile.mockImplementation((filePath) => {
        try {
          expect(res.headers['cache-control']).toBe('public, max-age=86400');
          expect(filePath).toMatch(/icon-192x192\.png$/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      router.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  });

  test('GET /index.html serves app shell with config injected', () => {
    return new Promise((resolve, reject) => {
      const { req, res } = mockReqRes('/index.html');

      const mockIndexHtml = '<html><head><base href="/"><script id="app-config"></script></head><body></body></html>';
      fs.promises.readFile.mockResolvedValue(mockIndexHtml);

      res.send.mockImplementation((html) => {
        try {
          expect(res.headers['cache-control']).toBe('no-store');
          expect(html).toContain('window.APP_CONFIG = {');
          expect(html).toContain('"baseUrl":"/"');
          expect(html).toContain('<base href="/">');
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      router.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  });

  test('GET /service-worker.js serves dynamic sw content', () => {
    return new Promise((resolve, reject) => {
      const { req, res } = mockReqRes('/service-worker.js');

      const mockSwContent = 'const CACHE_VERSION = "v9.0-old"; const ASSET_PATHS = ["assets/old.js"];';
      fs.promises.readFile.mockResolvedValue(mockSwContent);
      fs.promises.stat.mockResolvedValue({ mtimeMs: 1612345678000 });
      fs.promises.readdir.mockResolvedValue(['new.js']);

      res.send.mockImplementation((content) => {
        try {
          expect(res.headers['cache-control']).toBe('no-store');
          expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
          expect(content).toContain('const CACHE_VERSION = \'v9.0-1612345678000\';');
          expect(content).toContain('"assets/new.js"');
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      router.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  });

  test('GET /thumbnails/:filename serves existing thumbnail', () => {
    return new Promise((resolve, reject) => {
      const { req, res } = mockReqRes('/thumbnails/test.jpg', { filename: 'test.jpg' });

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('test.jpg')) return true;
        // mock the dist index check in router setup
        if (p.endsWith('index.html')) return true;
        return false;
      });

      res.sendFile.mockImplementation((filename, options) => {
        try {
          expect(filename).toBe('test.jpg');
          expect(options).toHaveProperty('root');
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      router.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  });

  test('GET /thumbnails/:filename attempts generation if not exists', () => {
    return new Promise((resolve, reject) => {
      const { req, res } = mockReqRes('/thumbnails/missing.jpg', { filename: 'missing.jpg' });

      fs.existsSync.mockImplementation((p) => {
        if (p.endsWith('missing.jpg') && p.includes('thumbnails')) return false; // Not in thumbnails
        if (p.endsWith('comic.cbz')) return true; // Comic exists
        if (p.endsWith('index.html')) return true;
        if (p.endsWith('gen.jpg')) return true; // Generated thumbnail exists
        return false;
      });

      const { dbGet, dbRun } = require('../../../server/db');
      const { generateThumbnail } = require('../../../server/services/library-pages');

      dbGet.mockResolvedValue({ id: 'missing', path: '/comics/comic.cbz' });
      generateThumbnail.mockResolvedValue('/thumbnails/gen.jpg');
      dbRun.mockResolvedValue();

      res.sendFile.mockImplementation((filename, options) => {
        try {
          expect(filename).toBe('gen.jpg');
          expect(options).toHaveProperty('root');
          expect(dbGet).toHaveBeenCalled();
          expect(generateThumbnail).toHaveBeenCalledWith('/comics/comic.cbz');
          expect(dbRun).toHaveBeenCalled();
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      router.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  });
});
