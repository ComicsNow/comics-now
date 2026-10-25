const express = require('express');
const fs = require('fs');
const path = require('path');
const { createStaticRouter } = require('../../../server/routes/static');

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    promises: {
      readFile: jest.fn(),
      stat: jest.fn(),
      readdir: jest.fn()
    }
  };
});

jest.mock('../../../server/constants', () => ({
  PUBLIC_DIR: '/fake/public',
  ICONS_DIRECTORY: '/fake/icons',
  THUMBNAILS_DIRECTORY: '/fake/thumbnails',
  LOGOS_DIRECTORY: '/fake/logos'
}));

jest.mock('../../../server/logger', () => ({
  log: jest.fn()
}));

jest.mock('../../../server/config', () => ({
  isAuthEnabled: jest.fn(() => true)
}));

jest.mock('../../../server/db', () => ({
  dbGet: jest.fn(),
  dbRun: jest.fn()
}));

jest.mock('../../../server/services/library-pages', () => ({
  generateThumbnail: jest.fn()
}));

describe('createStaticRouter', () => {
  let router;
  let mockDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up mock index.html template
    fs.promises.readFile.mockImplementation(async (filePath) => {
      if (filePath.endsWith('index.html')) {
        return '<script id="app-config"></script><base href="/">';
      }
      if (filePath.endsWith('service-worker.js')) {
        return 'const CACHE_VERSION = "v1-old"; const ASSET_PATHS = ["old.js"];';
      }
      return '';
    });

    fs.existsSync.mockImplementation((filePath) => {
      if (filePath === path.join('/fake/public/dist', 'index.html')) {
        return true;
      }
      return false; // other checks default to false, overridden in specific tests
    });

    // Express static internally calls stat to check if file exists, so mock it for thumbnails directory
    fs.stat = jest.fn((filePath, cb) => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      cb(err);
    });

    fs.promises.stat.mockResolvedValue({ mtimeMs: 1234567890 });
    fs.promises.readdir.mockResolvedValue(['new_asset.js']);

    mockDeps = {
      getConfig: jest.fn(() => ({
        baseUrl: 'http://localhost:3000',
        authentication: { cloudflare: { teamDomain: 'test.cloudflareaccess.com' } },
        hideSupportForAdmin: false
      })),
      getComicsDirectories: jest.fn(() => ['/comics']),
      getPublicLibraries: jest.fn(() => [{ id: 'lib_0', name: 'Comics' }])
    };

    router = createStaticRouter(mockDeps);
  });

  const simulateRequest = (reqOptions) => {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        headers: {},
        ...reqOptions
      };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
        set: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
        status: jest.fn(function(code) { this.statusCode = code; return this; }),
        send: jest.fn((data) => {
          resolve({ res, data });
        }),
        sendFile: jest.fn((filePath, options) => {
          resolve({ res, filePath, options });
        })
      };

      router.handle(req, res, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve({ res, nextCalled: true }); // Represent reaching a fallback/next
        }
      });
    });
  };

  test('GET /index.html serves injected app shell', async () => {
    const { res, data } = await simulateRequest({ url: '/index.html' });

    expect(res.headers['cache-control']).toBe('no-store');

    // Check if configuration is injected
    expect(data).toContain('window.APP_CONFIG');
    expect(data).toContain('http://localhost:3000');
    expect(data).toContain('lib_0');
    expect(data).toContain('test.cloudflareaccess.com');
    expect(data).toContain('<base href="http://localhost:3000/">');
    expect(data).toContain('<link rel="manifest" href="http://localhost:3000/manifest.json">');
  });

  test('GET /service-worker.js injects dynamic build mtime and assets', async () => {
    const { res, data } = await simulateRequest({ url: '/service-worker.js' });

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toContain('application/javascript');

    expect(data).toContain('const CACHE_VERSION = \'v9.0-1234567890\';');
    expect(data).toContain('"assets/new_asset.js"');
  });

  test('GET /favicon.ico serves correct file with cache headers', async () => {
    const { res, filePath } = await simulateRequest({ url: '/favicon.ico' });

    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(filePath).toBe(path.join('/fake/icons', 'icon-192x192.png'));
  });

  test('GET /thumbnails/:filename serves existing thumbnail', async () => {
    // Override existsSync specifically for this test
    fs.existsSync.mockImplementation((p) => {
      if (p === path.join('/fake/thumbnails', 'test.jpg')) return true;
      return false;
    });

    const { res, filePath, options } = await simulateRequest({ url: '/thumbnails/test.jpg' });

    expect(filePath).toBe('test.jpg');
    expect(options.root).toBe(path.resolve('/fake/thumbnails'));
  });

  test('GET /thumbnails/:filename handles path traversal rejection', async () => {
    // If someone manages to pass a path that resolves outside the directory
    // Note: path.basename usually strips ../ so we might have to mock path.basename
    // or test a different mechanism if the code was purely relying on startsWith.
    // Let's mock path.resolve temporarily to return a malicious path for this specific test
    // to prove the security check works.
    const originalResolve = path.resolve;
    jest.spyOn(path, 'resolve').mockImplementation((...args) => {
      if (args[1] === 'malicious') return '/fake/otherdir/malicious';
      return originalResolve(...args);
    });

    // We pass url that parses so safeFilename becomes 'malicious'
    const { res, data } = await simulateRequest({ url: '/thumbnails/malicious' });

    expect(res.statusCode).toBe(403);
    expect(data).toBe('Forbidden');

    path.resolve.mockRestore();
  });

  test('GET /thumbnails/:filename generates on-demand if not exists', async () => {
    // Require here so we can assert on mocks that were set up globally
    const { dbGet, dbRun } = require('../../../server/db');
    const { generateThumbnail } = require('../../../server/services/library-pages');

    // Mock db and generation
    dbGet.mockResolvedValue({ id: '1', path: '/comics/test.cbz' });
    generateThumbnail.mockResolvedValue('/fake/thumbnails/gen_test.jpg');

    fs.existsSync.mockImplementation((p) => {
      // First check for thumbnail file in dir
      if (p === path.join(path.resolve('/fake/thumbnails'), 'test.jpg')) return false;
      // Check comic file exists
      if (p === '/comics/test.cbz') return true;
      // Check generated file exists
      if (p === path.join(path.resolve('/fake/thumbnails'), 'gen_test.jpg')) return true;
      return false;
    });

    const { res, filePath, options } = await simulateRequest({ url: '/thumbnails/test.jpg' });

    expect(dbGet).toHaveBeenCalledWith('SELECT id, path FROM comics WHERE id = ? OR thumbnailPath = ?', ['test', 'test.jpg']);
    expect(generateThumbnail).toHaveBeenCalledWith('/comics/test.cbz');
    expect(dbRun).toHaveBeenCalledWith('UPDATE comics SET thumbnailPath = ? WHERE id = ?', ['gen_test.jpg', '1']);

    expect(filePath).toBe('gen_test.jpg');
    expect(options.root).toBe(path.resolve('/fake/thumbnails'));
  });

});
