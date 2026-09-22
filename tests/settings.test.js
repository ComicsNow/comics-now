const attachSettingsRoutes = require('../server/routes/admin/settings');

describe('Admin Settings Routes', () => {
  let router;
  let deps;
  let getLibrariesHandler;
  let addLibraryHandler;
  let removeLibraryHandler;
  let saveSettingsHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/admin/libraries') {
          getLibrariesHandler = args[args.length - 1];
        }
      }),
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/admin/libraries') {
          addLibraryHandler = args[args.length - 1];
        } else if (path === '/api/v1/settings') {
          saveSettingsHandler = args[args.length - 1];
        }
      }),
      delete: jest.fn((path, ...args) => {
        if (path === '/api/v1/admin/libraries') {
          removeLibraryHandler = args[args.length - 1];
        }
      })
    };

    deps = {
      getLibraries: jest.fn(() => ['/comics1', '/comics2']),
      addLibrary: jest.fn(() => true),
      removeLibrary: jest.fn(() => true),
      saveSetting: jest.fn().mockResolvedValue(),
      scheduleNextScan: jest.fn(),
      formatErrorMessage: jest.fn((err) => err.message),
      validateScanInterval: jest.fn((val) => ({ valid: true, sanitized: val })),
      validateApiKey: jest.fn((val) => ({ valid: true, sanitized: val })),
      setScanIntervalMinutes: jest.fn(),
      setComicVineApiKey: jest.fn(),
      setAllowedFormats: jest.fn(),
      setMetadataStorage: jest.fn(),
      requireAdmin: jest.fn((req, res, next) => next())
    };
  });

  describe('GET /api/v1/admin/libraries', () => {
    it('should return the list of libraries', async () => {
      attachSettingsRoutes(router, deps);

      const req = {};
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await getLibrariesHandler(req, res);

      expect(deps.getLibraries).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, libraries: ['/comics1', '/comics2'] });
    });

    it('should return 500 error if getLibraries throws', async () => {
      deps.getLibraries.mockImplementation(() => {
        throw new Error('Database connection failed');
      });
      attachSettingsRoutes(router, deps);

      const req = {};
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await getLibrariesHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Database connection failed' });
    });
  });

  describe('POST /api/v1/admin/libraries', () => {
    it('should add a library with correct arguments', async () => {
      attachSettingsRoutes(router, deps);

      const req = { body: { path: '/comics3', hierarchyMode: 'folder' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await addLibraryHandler(req, res);

      expect(deps.addLibrary).toHaveBeenCalledWith('/comics3', 'folder');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should default hierarchyMode to metadata if not provided', async () => {
      attachSettingsRoutes(router, deps);

      const req = { body: { path: '/comics3' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await addLibraryHandler(req, res);

      expect(deps.addLibrary).toHaveBeenCalledWith('/comics3', 'metadata');
    });

    it('should return 400 error if path is missing', async () => {
      attachSettingsRoutes(router, deps);

      const req = { body: { hierarchyMode: 'metadata' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await addLibraryHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Path is required' });
    });

    it('should return 400 error if addLibrary returns false', async () => {
      deps.addLibrary.mockReturnValue(false);
      attachSettingsRoutes(router, deps);

      const req = { body: { path: '/comics3' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await addLibraryHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to add library (invalid path or already exists)'
      });
    });
  });

  describe('DELETE /api/v1/admin/libraries', () => {
    it('should remove a library successfully', async () => {
      attachSettingsRoutes(router, deps);

      const req = { body: { path: '/comics1' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await removeLibraryHandler(req, res);

      expect(deps.removeLibrary).toHaveBeenCalledWith('/comics1');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should return 400 if path is missing', async () => {
      attachSettingsRoutes(router, deps);

      const req = { body: {} };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await removeLibraryHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Path is required' });
    });

    it('should return 400 error if removeLibrary returns false', async () => {
      deps.removeLibrary.mockReturnValue(false);
      attachSettingsRoutes(router, deps);

      const req = { body: { path: '/non-existent' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await removeLibraryHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to remove library (path not found)'
      });
    });
  });

  describe('POST /api/v1/settings', () => {
    it('should save settings successfully', async () => {
      attachSettingsRoutes(router, deps);

      const req = {
        body: {
          interval: 10,
          apiKey: 'test-api-key',
          allowedFormats: 'cbz',
          metadataStorage: 'sidecar'
        }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await saveSettingsHandler(req, res);

      expect(deps.validateScanInterval).toHaveBeenCalledWith(10);
      expect(deps.validateApiKey).toHaveBeenCalledWith('test-api-key');
      expect(deps.setScanIntervalMinutes).toHaveBeenCalledWith(10);
      expect(deps.setComicVineApiKey).toHaveBeenCalledWith('test-api-key');
      expect(deps.setAllowedFormats).toHaveBeenCalledWith('cbz');
      expect(deps.setMetadataStorage).toHaveBeenCalledWith('sidecar');
      expect(deps.saveSetting).toHaveBeenCalledWith('scanInterval', 10);
      expect(deps.saveSetting).toHaveBeenCalledWith('comicVineApiKey', 'test-api-key');
      expect(deps.saveSetting).toHaveBeenCalledWith('allowed_formats', 'cbz');
      expect(deps.saveSetting).toHaveBeenCalledWith('metadata_storage', 'sidecar');
      expect(deps.scheduleNextScan).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should reject invalid scan interval', async () => {
      deps.validateScanInterval.mockReturnValue({ valid: false, error: 'Interval must be positive' });
      attachSettingsRoutes(router, deps);

      const req = { body: { interval: -5 } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await saveSettingsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Interval must be positive' });
    });

    it('should reject invalid API key', async () => {
      deps.validateApiKey.mockReturnValue({ valid: false, error: 'API Key must be hexadecimal' });
      attachSettingsRoutes(router, deps);

      const req = { body: { apiKey: 'invalid-key-chars' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await saveSettingsHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'API Key must be hexadecimal' });
    });
  });
});
