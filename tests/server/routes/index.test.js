const express = require('express');
const { createApiRouter } = require('../../../server/routes/index');

// Mock route modules
jest.mock('../../../server/routes/public/auth', () => jest.fn());
jest.mock('../../../server/routes/public/health', () => jest.fn());
jest.mock('../../../server/routes/user/settings', () => jest.fn());
jest.mock('../../../server/routes/user/devices', () => jest.fn());
jest.mock('../../../server/routes/user/reading-lists', () => jest.fn());
jest.mock('../../../server/routes/user/reading', () => jest.fn());
jest.mock('../../../server/routes/user/progress', () => jest.fn());
jest.mock('../../../server/routes/user/library', () => jest.fn());
jest.mock('../../../server/routes/user/pages', () => jest.fn());
jest.mock('../../../server/routes/user/metadata', () => jest.fn());
jest.mock('../../../server/routes/admin/users', () => jest.fn());
jest.mock('../../../server/routes/admin/comictagger', () => jest.fn());
jest.mock('../../../server/routes/admin/guided', () => jest.fn());
jest.mock('../../../server/routes/admin/settings', () => jest.fn());
jest.mock('../../../server/routes/admin/library-mgmt', () => jest.fn());
jest.mock('../../../server/routes/admin/rename', () => jest.fn());
jest.mock('../../../server/routes/admin/mcp-tools', () => jest.fn());
jest.mock('../../../server/routes/admin/user-stats', () => jest.fn());
jest.mock('../../../server/routes/admin/gemini', () => jest.fn());
jest.mock('../../../server/routes/admin/impersonate', () => jest.fn());

// Mock utilities and validation to avoid real DB/fs operations and track usage
jest.mock('../../../server/utils', () => ({
  formatErrorMessage: jest.fn((log, error, req, fallbackMessage) => 'mock_formatted_error'),
  isPathSafe: jest.fn((log, getComicsDirectories, resolved) => true),
  resolveLibraryPath: jest.fn((requestedPath, getPathFromLibraryId) => 'mock_resolved_path')
}));

jest.mock('../../../server/validation', () => ({
  validateFingerprint: jest.fn(),
  validateDeviceId: jest.fn(),
  validateDeviceName: jest.fn(),
  validateLastReadPage: jest.fn(),
  validateStatus: jest.fn(),
  validateScanInterval: jest.fn(),
  validateApiKey: jest.fn(),
  validateSearchQuery: jest.fn(),
  validateComicId: jest.fn()
}));

jest.mock('../../../server/db', () => ({
  checkComicAccess: jest.fn(),
  getAllReadingPreferences: jest.fn(),
  setReadingPreference: jest.fn(),
  getReadingPrefMaps: jest.fn(),
  resolveReadingModes: jest.fn()
}));

jest.mock('../../../server/services/modal-detector', () => ({}));

const utils = require('../../../server/utils');
const publicAuthRoute = require('../../../server/routes/public/auth');

describe('server/routes/index.js', () => {
  let mockDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeps = {
      log: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
      getComicsDirectories: jest.fn(),
      getPathFromLibraryId: jest.fn(),
      requireAuth: jest.fn((req, res, next) => next()),
      requireAdmin: jest.fn((req, res, next) => next()),
      isAuthEnabled: jest.fn(() => true)
    };
  });

  describe('createExtendedDeps', () => {
    it('should correctly construct and pass extendedDeps to sub-routes', () => {
      createApiRouter(mockDeps);

      expect(publicAuthRoute).toHaveBeenCalled();
      const passedDeps = publicAuthRoute.mock.calls[0][1];

      expect(passedDeps).toBeDefined();
      expect(passedDeps.log).toBe(mockDeps.log);
      expect(typeof passedDeps.formatErrorMessage).toBe('function');
      expect(typeof passedDeps.isPathSafe).toBe('function');
      expect(typeof passedDeps.resolvePath).toBe('function');
      expect(passedDeps.validateFingerprint).toBeDefined();
      expect(passedDeps.checkComicAccess).toBeDefined();
      expect(passedDeps.modalDetector).toBeDefined();
    });

    it('should implement formatErrorMessage wrapper correctly', () => {
      createApiRouter(mockDeps);
      const passedDeps = publicAuthRoute.mock.calls[0][1];

      const error = new Error('test');
      const req = {};
      const fallback = 'fallback';

      const result = passedDeps.formatErrorMessage(error, req, fallback);

      expect(utils.formatErrorMessage).toHaveBeenCalledWith(mockDeps.log, error, req, fallback);
      expect(result).toBe('mock_formatted_error');
    });

    it('should implement isPathSafe wrapper correctly', () => {
      createApiRouter(mockDeps);
      const passedDeps = publicAuthRoute.mock.calls[0][1];

      const requestedPath = '/some/path';
      const result = passedDeps.isPathSafe(requestedPath);

      expect(utils.resolveLibraryPath).toHaveBeenCalledWith(requestedPath, mockDeps.getPathFromLibraryId);
      expect(utils.isPathSafe).toHaveBeenCalledWith(mockDeps.log, mockDeps.getComicsDirectories, 'mock_resolved_path');
      expect(result).toBe(true);
    });

    it('should implement resolvePath wrapper correctly', () => {
      createApiRouter(mockDeps);
      const passedDeps = publicAuthRoute.mock.calls[0][1];

      const requestedPath = '/another/path';
      const result = passedDeps.resolvePath(requestedPath);

      expect(utils.resolveLibraryPath).toHaveBeenCalledWith(requestedPath, mockDeps.getPathFromLibraryId);
      expect(result).toBe('mock_resolved_path');
    });
  });

  describe('createAuthMiddlewares', () => {
    let capturedMiddlewares;
    let originalRouter;

    beforeAll(() => {
      originalRouter = express.Router;
    });

    afterAll(() => {
      express.Router = originalRouter;
    });

    beforeEach(() => {
      capturedMiddlewares = [];
      // Intercept Router.use to capture middleware functions
      express.Router = jest.fn(() => ({
        use: jest.fn((middleware) => {
          if (typeof middleware === 'function' && middleware.name) {
            // we capture standard middlewares
            capturedMiddlewares.push(middleware);
          }
        })
      }));
    });

    it('requireUserAuth should enforce authentication for /api paths', () => {
      createApiRouter(mockDeps);
      const requireUserAuth = capturedMiddlewares.find(m => m.name === 'requireUserAuth');
      expect(requireUserAuth).toBeDefined();

      const next = jest.fn();

      // Test non-api path
      requireUserAuth({ path: '/public/image.jpg' }, {}, next);
      expect(next).toHaveBeenCalled();
      expect(mockDeps.requireAuth).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // Test api path
      requireUserAuth({ path: '/api/user/info' }, {}, next);
      expect(mockDeps.requireAuth).toHaveBeenCalled();
    });

    it('requireAdminAuth should enforce admin authentication for /api paths', () => {
      createApiRouter(mockDeps);
      const requireAdminAuth = capturedMiddlewares.find(m => m.name === 'requireAdminAuth');
      expect(requireAdminAuth).toBeDefined();

      const next = jest.fn();

      // Test non-api path
      requireAdminAuth({ path: '/public/styles.css' }, {}, next);
      expect(next).toHaveBeenCalled();
      expect(mockDeps.requireAdmin).not.toHaveBeenCalled();

      jest.clearAllMocks();

      // Test api path
      requireAdminAuth({ path: '/api/admin/users' }, {}, next);
      expect(mockDeps.requireAdmin).toHaveBeenCalled();
    });

    describe('requireRealAdminAuth', () => {
      let requireRealAdminAuth;
      let res;
      let next;

      beforeEach(() => {
        createApiRouter(mockDeps);
        requireRealAdminAuth = capturedMiddlewares.find(m => m.name === 'requireRealAdminAuth');
        expect(requireRealAdminAuth).toBeDefined();

        res = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        next = jest.fn();
      });

      it('should skip for non-impersonate paths', () => {
        requireRealAdminAuth({ path: '/api/admin/users' }, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should skip if auth is disabled', () => {
        mockDeps.isAuthEnabled.mockReturnValueOnce(false);
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate' }, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should forbid access if no user is present', () => {
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate' }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
        expect(next).not.toHaveBeenCalled();
      });

      it('should forbid access if realUser is not admin', () => {
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate', realUser: { role: 'user' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
        expect(next).not.toHaveBeenCalled();
      });

      it('should forbid access if user is not admin (no realUser)', () => {
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate', user: { role: 'user' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
        expect(next).not.toHaveBeenCalled();
      });

      it('should allow access if realUser is admin', () => {
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate', realUser: { role: 'admin' } }, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it('should allow access if user is admin (no realUser)', () => {
        requireRealAdminAuth({ path: '/api/v1/admin/impersonate', user: { role: 'admin' } }, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });
    });
  });
});
