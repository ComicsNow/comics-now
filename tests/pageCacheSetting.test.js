const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const { DEFAULT_MAX_PAGE_CACHE_MB, PAGE_CACHE_MIN_MB, PAGE_CACHE_MAX_MB } = require('../server/constants');
const { validatePageCacheMaxMb } = require('../server/validation');
const attachUserSettingsRoutes = require('../server/routes/user/settings');
const attachAdminSettingsRoutes = require('../server/routes/admin/settings');

describe('Page Cache Limit setting', () => {
  let originalMaxMb;

  beforeEach(() => {
    originalMaxMb = config.getPageCacheMaxMb();
    jest.clearAllMocks();
  });

  afterEach(() => {
    config.setPageCacheMaxMb(originalMaxMb, true);
  });

  test('defaults to 200 MB', () => {
    expect(DEFAULT_MAX_PAGE_CACHE_MB).toBe(200);
    expect(config.DEFAULT_CONFIG.pageCacheMaxMb).toBe(200);
    expect(config.getPageCacheMaxMb()).toBe(200);
  });

  test('config.example.json includes pageCacheMaxMb set to 200 by default', () => {
    const examplePath = path.join(__dirname, '..', 'config.example.json');
    const parsed = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
    expect(parsed.pageCacheMaxMb).toBe(200);
  });

  test('accessor sanitizes and clamps values', () => {
    expect(typeof config.getPageCacheMaxMb).toBe('function');
    expect(typeof config.setPageCacheMaxMb).toBe('function');

    expect(config.setPageCacheMaxMb(700, true)).toBe(700);
    expect(config.getPageCacheMaxMb()).toBe(700);

    expect(config.setPageCacheMaxMb('800', true)).toBe(800);
    expect(config.getPageCacheMaxMb()).toBe(800);

    expect(config.setPageCacheMaxMb(PAGE_CACHE_MIN_MB - 1, true)).toBe(PAGE_CACHE_MIN_MB);
    expect(config.setPageCacheMaxMb(PAGE_CACHE_MAX_MB + 1, true)).toBe(PAGE_CACHE_MAX_MB);
    expect(config.setPageCacheMaxMb('abc', true)).toBe(DEFAULT_MAX_PAGE_CACHE_MB);
  });

  test('validator accepts integers in range and rejects others', () => {
    expect(validatePageCacheMaxMb(200)).toEqual({ valid: true, sanitized: 200 });
    expect(validatePageCacheMaxMb('700')).toEqual({ valid: true, sanitized: 700 });
    expect(validatePageCacheMaxMb(49).valid).toBe(false);
    expect(validatePageCacheMaxMb(10241).valid).toBe(false);
    expect(validatePageCacheMaxMb(200.5).valid).toBe(false);
  });

  test('GET /api/v1/settings returns the limit and current usage', async () => {
    let getHandler;
    const router = {
      get: jest.fn((p, h) => {
        if (p === '/api/v1/settings') getHandler = h;
      })
    };
    const deps = {
      getComicVineApiKey: () => '',
      getScanIntervalMinutes: () => 5,
      getPageCacheMaxMb: () => 700,
      getPageCacheStats: async () => ({ totalBytes: 250 * 1024 * 1024, fileCount: 1234 }),
      getAllowedFormats: () => 'cbz',
      getMetadataStorage: () => 'archive'
    };
    attachUserSettingsRoutes(router, deps);

    const res = { json: jest.fn() };
    await getHandler({ user: { role: 'admin' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        pageCacheMaxMb: 700,
        pageCacheUsageBytes: 250 * 1024 * 1024,
        pageCacheFileCount: 1234
      })
    );
  });

  function createAdminDeps(overrides = {}) {
    return {
      getLibraries: jest.fn(() => []),
      addLibrary: jest.fn(),
      removeLibrary: jest.fn(),
      saveSetting: jest.fn().mockResolvedValue(),
      scheduleNextScan: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      validateScanInterval: jest.fn((v) => ({ valid: true, sanitized: v })),
      validatePageCacheMaxMb,
      validateApiKey: jest.fn((v) => ({ valid: true, sanitized: v })),
      setScanIntervalMinutes: jest.fn(),
      setPageCacheMaxMb: jest.fn(),
      prunePageCache: jest.fn().mockResolvedValue(),
      setComicVineApiKey: jest.fn(),
      setAllowedFormats: jest.fn(),
      setMetadataStorage: jest.fn(),
      requireAdmin: jest.fn((req, res, next) => next()),
      ...overrides
    };
  }

  function attachAdmin(deps) {
    let postHandler;
    const router = {
      get: jest.fn(),
      post: jest.fn((p, ...args) => {
        if (p === '/api/v1/settings') postHandler = args[args.length - 1];
      }),
      delete: jest.fn()
    };
    attachAdminSettingsRoutes(router, deps);
    return postHandler;
  }

  test('POST /api/v1/settings applies, persists, then prunes with the new limit', async () => {
    const deps = createAdminDeps();
    const postHandler = attachAdmin(deps);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await postHandler({
      body: {
        interval: 5,
        apiKey: '',
        allowedFormats: 'cbz',
        metadataStorage: 'archive',
        pageCacheMaxMb: 700
      }
    }, res);

    expect(deps.setPageCacheMaxMb).toHaveBeenCalledWith(700);
    expect(deps.saveSetting).toHaveBeenCalledWith('pageCacheMaxMb', 700);
    expect(deps.prunePageCache).toHaveBeenCalled();
    expect(deps.setPageCacheMaxMb.mock.invocationCallOrder[0])
      .toBeLessThan(deps.prunePageCache.mock.invocationCallOrder[0]);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  test('POST without pageCacheMaxMb leaves the setting untouched', async () => {
    const deps = createAdminDeps();
    const postHandler = attachAdmin(deps);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await postHandler({
      body: { interval: 5, apiKey: '', deleteCbrAfterConversion: true }
    }, res);

    expect(deps.setPageCacheMaxMb).not.toHaveBeenCalled();
    expect(deps.prunePageCache).not.toHaveBeenCalled();
    expect(deps.saveSetting).not.toHaveBeenCalledWith('pageCacheMaxMb', expect.anything());
  });

  test('POST rejects an invalid limit before any other setting is written', async () => {
    const deps = createAdminDeps();
    const postHandler = attachAdmin(deps);
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await postHandler({
      body: { interval: 5, apiKey: '', pageCacheMaxMb: 10 }
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message: `Page cache limit must be at least ${PAGE_CACHE_MIN_MB} MB`
    });
    expect(deps.setScanIntervalMinutes).not.toHaveBeenCalled();
    expect(deps.saveSetting).not.toHaveBeenCalled();
    expect(deps.setPageCacheMaxMb).not.toHaveBeenCalled();
    expect(deps.prunePageCache).not.toHaveBeenCalled();
  });

  test('public/index.html includes the page cache controls', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html).toMatch(/id="page-cache-max-input"/);
    expect(html).toMatch(/id="page-cache-usage"/);
  });
});
