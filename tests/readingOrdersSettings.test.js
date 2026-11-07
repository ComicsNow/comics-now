const attachAdminSettingsRoutes = require('../server/routes/admin/settings');
const attachUserSettingsRoutes = require('../server/routes/user/settings');
const { createStoryArcsConfigAccessors } = require('../server/config/story-arcs-config');

describe('Reading Orders & Story Arcs Settings', () => {
  describe('Config Accessors', () => {
    let mockConfig;
    let mockSave;
    let accessors;

    beforeEach(() => {
      mockConfig = {
        readingOrdersIntervalDays: 7,
        readingOrdersMode: 'both'
      };
      mockSave = jest.fn();
      accessors = createStoryArcsConfigAccessors(mockConfig, mockSave);
    });

    it('should return default interval of 7 days and mode both', () => {
      expect(accessors.getReadingOrdersIntervalDays()).toBe(7);
      expect(accessors.getReadingOrdersMode()).toBe('both');
    });

    it('should sanitize and clamp interval days between 0 and 90', () => {
      accessors.setReadingOrdersIntervalDays(14);
      expect(mockConfig.readingOrdersIntervalDays).toBe(14);
      expect(mockSave).toHaveBeenCalled();

      accessors.setReadingOrdersIntervalDays(-5);
      expect(mockConfig.readingOrdersIntervalDays).toBe(0);

      accessors.setReadingOrdersIntervalDays(120);
      expect(mockConfig.readingOrdersIntervalDays).toBe(90);

      accessors.setReadingOrdersIntervalDays('invalid');
      expect(mockConfig.readingOrdersIntervalDays).toBe(7);
    });

    it('should sanitize ingestion mode to both, issues, or collected', () => {
      accessors.setReadingOrdersMode('issues');
      expect(mockConfig.readingOrdersMode).toBe('issues');

      accessors.setReadingOrdersMode('collected');
      expect(mockConfig.readingOrdersMode).toBe('collected');

      accessors.setReadingOrdersMode('invalid_mode');
      expect(mockConfig.readingOrdersMode).toBe('both');
    });
  });

  describe('User Settings GET /api/v1/settings', () => {
    it('should include readingOrdersIntervalDays and readingOrdersMode in response', async () => {
      let getHandler;
      const router = {
        get: jest.fn((path, handler) => {
          if (path === '/api/v1/settings') getHandler = handler;
        })
      };

      const deps = {
        getComicVineApiKey: () => '',
        getScanIntervalMinutes: () => 5,
        getAllowedFormats: () => 'cbz',
        getMetadataStorage: () => 'archive',
        getReadingOrdersIntervalDays: () => 7,
        getReadingOrdersMode: () => 'both'
      };

      attachUserSettingsRoutes(router, deps);

      const req = { user: { role: 'admin' } };
      const res = { json: jest.fn() };

      await getHandler(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        readingOrdersIntervalDays: 7,
        readingOrdersMode: 'both'
      }));
    });
  });

  describe('Admin Settings POST /api/v1/settings', () => {
    it('should persist readingOrdersIntervalDays and readingOrdersMode', async () => {
      let postHandler;
      const router = {
        get: jest.fn(),
        post: jest.fn((path, ...args) => {
          if (path === '/api/v1/settings') postHandler = args[args.length - 1];
        }),
        delete: jest.fn()
      };

      const deps = {
        saveSetting: jest.fn().mockResolvedValue(),
        scheduleNextScan: jest.fn(),
        formatErrorMessage: (err) => err.message,
        validateScanInterval: () => ({ valid: true, sanitized: 5 }),
        validateApiKey: () => ({ valid: true, sanitized: '' }),
        setScanIntervalMinutes: jest.fn(),
        setAllowedFormats: jest.fn(),
        setMetadataStorage: jest.fn(),
        setComicVineApiKey: jest.fn(),
        setReadingOrdersIntervalDays: jest.fn(),
        setReadingOrdersMode: jest.fn(),
        requireAdmin: (req, res, next) => next()
      };

      attachAdminSettingsRoutes(router, deps);

      const req = {
        body: {
          interval: 5,
          readingOrdersIntervalDays: 14,
          readingOrdersMode: 'issues'
        }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await postHandler(req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true });
      expect(deps.setReadingOrdersIntervalDays).toHaveBeenCalledWith(14);
      expect(deps.setReadingOrdersMode).toHaveBeenCalledWith('issues');
      expect(deps.saveSetting).toHaveBeenCalledWith('readingOrdersIntervalDays', 14);
      expect(deps.saveSetting).toHaveBeenCalledWith('readingOrdersMode', 'issues');
    });
  });
});
