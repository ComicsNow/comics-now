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
      getAllowedFormats: jest.fn(() => 'cbz'),
      getMetadataStorage: jest.fn(() => 'sidecar')
    };
  });

  it('should return settings and the API key to admins', () => {
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'admin' } };
    const res = {
      json: jest.fn()
    };

    getSettingsHandler(req, res);

    expect(deps.getComicVineApiKey).toHaveBeenCalled();
    expect(deps.getScanIntervalMinutes).toHaveBeenCalled();
    expect(deps.getAllowedFormats).toHaveBeenCalled();
    expect(deps.getMetadataStorage).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      scanInterval: 15,
      allowedFormats: 'cbz',
      metadataStorage: 'sidecar',
      hasApiKey: true,
      comicVineApiKey: 'api-key-value'
    });
  });

  it('should return settings but hide the API key for non-admins', () => {
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'user' } };
    const res = {
      json: jest.fn()
    };

    getSettingsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      scanInterval: 15,
      allowedFormats: 'cbz',
      metadataStorage: 'sidecar',
      hasApiKey: true,
      comicVineApiKey: undefined
    });
  });

  it('should return hasApiKey: false if API key is not configured or set to default', () => {
    deps.getComicVineApiKey.mockReturnValue('YOUR_API_KEY_HERE');
    attachUserSettingsRoutes(router, deps);

    const req = { user: { role: 'admin' } };
    const res = {
      json: jest.fn()
    };

    getSettingsHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        hasApiKey: false,
        comicVineApiKey: 'YOUR_API_KEY_HERE'
      })
    );
  });
});
