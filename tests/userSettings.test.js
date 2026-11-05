const attachUserSettingsRoutes = require('../server/routes/user/settings');

describe('User Settings Routes', () => {
  let router;
  let deps;
  let getSettingsHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    router = {
      get: jest.fn((path, handler) => {
        if (path === '/api/v1/settings') {
          getSettingsHandler = handler;
        }
      })
    };

    deps = {
      getComicVineApiKey: jest.fn(() => 'api-key-value'),
      getScanIntervalMinutes: jest.fn(() => 15),
      getPageCacheMaxMb: jest.fn(() => 700),
      getPageCacheStats: jest.fn(async () => ({ totalBytes: 250 * 1024 * 1024, fileCount: 1234 })),
      getAllowedFormats: jest.fn(() => 'cbz'),
      getMetadataStorage: jest.fn(() => 'sidecar')
    };
  });

  it('should return settings and the API key to admins', async () => {
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'admin' } };
    const res = {
      json: jest.fn()
    };

    await getSettingsHandler(req, res);

    expect(deps.getComicVineApiKey).toHaveBeenCalled();
    expect(deps.getScanIntervalMinutes).toHaveBeenCalled();
    expect(deps.getPageCacheMaxMb).toHaveBeenCalled();
    expect(deps.getPageCacheStats).toHaveBeenCalled();
    expect(deps.getAllowedFormats).toHaveBeenCalled();
    expect(deps.getMetadataStorage).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      scanInterval: 15,
      pageCacheMaxMb: 700,
      pageCacheUsageBytes: 250 * 1024 * 1024,
      pageCacheFileCount: 1234,
      allowedFormats: 'cbz',
      deleteCbrAfterConversion: false,
      deletePdfAfterConversion: false,
      metadataStorage: 'sidecar',
      hasApiKey: true,
      comicVineApiKey: 'api-key-value'
    });
  });

  it('should return settings but hide the API key for non-admins', async () => {
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'user' } };
    const res = {
      json: jest.fn()
    };

    await getSettingsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      scanInterval: 15,
      pageCacheMaxMb: 700,
      pageCacheUsageBytes: 250 * 1024 * 1024,
      pageCacheFileCount: 1234,
      allowedFormats: 'cbz',
      deleteCbrAfterConversion: false,
      deletePdfAfterConversion: false,
      metadataStorage: 'sidecar',
      hasApiKey: true,
      comicVineApiKey: undefined
    });
  });

  it('should return hasApiKey: false if API key is not configured or set to default', async () => {
    deps.getComicVineApiKey.mockReturnValue('YOUR_API_KEY_HERE');
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'admin' } };
    const res = {
      json: jest.fn()
    };

    await getSettingsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hasApiKey: false,
        comicVineApiKey: 'YOUR_API_KEY_HERE'
      })
    );
  });
});
