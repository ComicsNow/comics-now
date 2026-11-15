/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadServiceWorkerSandbox(overrides = {}) {
  const listeners = new Map();
  const cacheMap = new Map();
  const mockCache = {
    match: jest.fn(async (req) => cacheMap.get(typeof req === 'string' ? req : req.url) || null),
    put: jest.fn(async (req, res) => {
      cacheMap.set(typeof req === 'string' ? req : req.url, res);
    }),
    keys: jest.fn(async () => Array.from(cacheMap.keys()).map((url) => ({ url }))),
    delete: jest.fn(async (req) => cacheMap.delete(typeof req === 'string' ? req : req.url))
  };

  const createdStores = [];
  const existingStoreNames = new Set();
  const mockDb = {
    objectStoreNames: {
      contains: (name) => existingStoreNames.has(name)
    },
    createObjectStore: jest.fn((name, opts) => {
      existingStoreNames.add(name);
      const store = { name, opts, indexes: [], createIndex: jest.fn((idxName) => store.indexes.push(idxName)) };
      createdStores.push(store);
      return store;
    })
  };

  const sandbox = {
    self: null,
    location: { origin: 'http://localhost:3000' },
    registration: { scope: 'http://localhost:3000/' },
    caches: {
      open: jest.fn(async () => mockCache),
      keys: jest.fn(async () => []),
      delete: jest.fn(async () => true)
    },
    indexedDB: {
      open: jest.fn(() => {
        const req = { result: mockDb, onsuccess: null, onupgradeneeded: null, onerror: null, onblocked: null };
        setTimeout(() => {
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      })
    },
    fetch: overrides.fetch || jest.fn(async () => ({
      ok: true,
      status: 200,
      clone: () => ({ ok: true, status: 200, fromNetwork: true })
    })),
    URL,
    Response: class MockResponse {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = init.headers || {};
      }
    },
    AbortController: global.AbortController,
    setTimeout,
    clearTimeout,
    console,
    addEventListener: (type, fn) => listeners.set(type, fn)
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const swPath = path.resolve(__dirname, '../public/service-worker.js');
  const code = fs.readFileSync(swPath, 'utf8');
  vm.runInContext(code, sandbox);

  return { sandbox, listeners, cacheMap, mockCache, createdStores, existingStoreNames };
}

describe('public/service-worker.js', () => {
  test('pre-caches unrar.wasm in ASSET_PATHS', () => {
    const swPath = path.resolve(__dirname, '../public/service-worker.js');
    const code = fs.readFileSync(swPath, 'utf8');
    expect(code).toContain("'unrar.wasm'");
  });

  test('serves comic page images Cache-First without cache: no-store on miss', async () => {
    const { sandbox, listeners, cacheMap } = loadServiceWorkerSandbox();
    const fetchListener = listeners.get('fetch');
    expect(typeof fetchListener).toBe('function');

    const imgUrl = 'http://localhost:3000/api/v1/comics/pages/image?path=abc&page=1.jpg&fmt=webp';
    const cachedRes = { ok: true, status: 200, cached: true };
    cacheMap.set(imgUrl, cachedRes);

    let respondedPromise;
    fetchListener({
      request: { method: 'GET', url: imgUrl, headers: { get: () => '' } },
      respondWith: (p) => { respondedPromise = p; }
    });

    const hit = await respondedPromise;
    expect(hit).toBe(cachedRes);
    expect(sandbox.fetch).not.toHaveBeenCalled();

    // Cache miss fetches without cache: 'no-store'
    const missUrl = 'http://localhost:3000/api/v1/comics/pages/image?path=abc&page=2.jpg&fmt=webp';
    let missPromise;
    fetchListener({
      request: { method: 'GET', url: missUrl, headers: { get: () => '' } },
      respondWith: (p) => { missPromise = p; }
    });

    await missPromise;
    expect(sandbox.fetch).toHaveBeenCalledTimes(1);
    const fetchOpts = sandbox.fetch.mock.calls[0][1];
    expect(fetchOpts?.cache).not.toBe('no-store');
    expect(cacheMap.has(missUrl)).toBe(true);
  });

  test('removes deprecated SW processDownloadQueue and sync download-comics handler', () => {
    const swPath = path.resolve(__dirname, '../public/service-worker.js');
    const swCode = fs.readFileSync(swPath, 'utf8');
    expect(swCode).not.toContain('function processDownloadQueue');
    expect(swCode).not.toContain("event.tag === 'download-comics'");

    const downloadsPath = path.resolve(__dirname, '../public/js/offline/downloads.js');
    const dlCode = fs.readFileSync(downloadsPath, 'utf8');
    expect(dlCode).not.toContain('registerBackgroundSync');
  });

  test('openDownloadDB creates all 8 object stores on version upgrade', async () => {
    const { sandbox, existingStoreNames } = loadServiceWorkerSandbox();
    await sandbox.openDownloadDB();

    const expectedStores = [
      'comics',
      'progress',
      'statuses',
      'library',
      'downloadQueue',
      'settings',
      'deviceLibraries',
      'deviceComics',
      'comicMeta'
    ];
    for (const storeName of expectedStores) {
      expect(existingStoreNames.has(storeName)).toBe(true);
    }
  });

  test('bypasses fetch interception for /api/v1/sync/stream and text/event-stream', () => {
    const { listeners } = loadServiceWorkerSandbox();
    const fetchListener = listeners.get('fetch');

    let respondCalled = false;
    fetchListener({
      request: {
        method: 'GET',
        url: 'http://localhost:3000/api/v1/sync/stream?deviceId=dev-1',
        mode: 'cors',
        headers: { get: (k) => (k.toLowerCase() === 'accept' ? 'text/event-stream' : '') }
      },
      respondWith: () => { respondCalled = true; }
    });
    expect(respondCalled).toBe(false);
  });

  test('navigate falls back to cached index.html on 502 Bad Gateway', async () => {
    const cachedShell = { ok: true, status: 200, cachedShell: true };
    const { listeners, cacheMap } = loadServiceWorkerSandbox({
      fetch: jest.fn(async () => ({
        ok: false,
        status: 502,
        type: 'basic',
        headers: { get: () => 'text/html' },
        clone: () => ({ ok: false, status: 502 })
      }))
    });
    cacheMap.set('http://localhost:3000/index.html', cachedShell);

    const fetchListener = listeners.get('fetch');
    let respondedPromise;
    fetchListener({
      request: {
        method: 'GET',
        mode: 'navigate',
        url: 'http://localhost:3000/comic/123/page/4',
        headers: { get: (k) => (k.toLowerCase() === 'accept' ? 'text/html' : '') }
      },
      respondWith: (p) => { respondedPromise = p; }
    });

    const result = await respondedPromise;
    expect(result).toBe(cachedShell);
  });

  test('js/css fetch rejects HTML poisoning and falls back to cached asset on 502', async () => {
    const cachedJs = { ok: true, status: 200, cachedAsset: true };
    const { listeners, cacheMap, mockCache } = loadServiceWorkerSandbox({
      fetch: jest.fn(async () => ({
        ok: true,
        status: 200,
        type: 'basic',
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : '') },
        clone: () => ({ ok: true, status: 200 })
      }))
    });
    const assetUrl = 'http://localhost:3000/assets/index-abc.js';
    cacheMap.set(assetUrl, cachedJs);

    const fetchListener = listeners.get('fetch');
    let respondedPromise;
    fetchListener({
      request: {
        method: 'GET',
        mode: 'cors',
        url: assetUrl,
        headers: { get: () => '' }
      },
      respondWith: (p) => { respondedPromise = p; }
    });

    const result = await respondedPromise;
    expect(result).toBe(cachedJs);
    expect(mockCache.put).not.toHaveBeenCalled();
  });
});
