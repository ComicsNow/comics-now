const express = require('express');
const path = require('path');
const { createApiRouter } = require('../../../server/routes/index');

// Mock all sub-route modules
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

// Mock services/utils/db/validation
jest.mock('../../../server/utils', () => ({
  formatErrorMessage: jest.fn(),
  isPathSafe: jest.fn(),
  resolveLibraryPath: jest.fn()
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

jest.mock('../../../server/services/modal-detector', () => ({
  dummy: true
}));

const utils = require('../../../server/utils');
const db = require('../../../server/db');
const validation = require('../../../server/validation');

describe('createApiRouter', () => {
  let mockDeps;

  beforeEach(() => {
    mockDeps = {
      log: jest.fn(),
      getComicsDirectories: jest.fn(() => ['/comics']),
      getPathFromLibraryId: jest.fn(),
      requireAuth: jest.fn((req, res, next) => next()),
      requireAdmin: jest.fn((req, res, next) => next()),
      isAuthEnabled: jest.fn(() => true)
    };

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('extendedDeps generation', () => {
    it('creates extended dependencies and passes them to subroutes', () => {
      const authMock = require('../../../server/routes/public/auth');

      createApiRouter(mockDeps);

      expect(authMock).toHaveBeenCalled();
      const [, passedDeps] = authMock.mock.calls[0];

      expect(passedDeps).toBeDefined();
      expect(passedDeps.log).toBe(mockDeps.log);

      // Check util functions are exposed
      expect(typeof passedDeps.formatErrorMessage).toBe('function');
      expect(typeof passedDeps.isPathSafe).toBe('function');
      expect(typeof passedDeps.resolvePath).toBe('function');

      // Check validation functions are exposed
      expect(passedDeps.validateFingerprint).toBe(validation.validateFingerprint);
      expect(passedDeps.validateDeviceId).toBe(validation.validateDeviceId);

      // Check db functions are exposed
      expect(passedDeps.checkComicAccess).toBe(db.checkComicAccess);
      expect(passedDeps.getAllReadingPreferences).toBe(db.getAllReadingPreferences);

      // Check modalDetector is exposed
      expect(passedDeps.modalDetector).toBeDefined();
    });

    it('extendedDeps.formatErrorMessage calls sharedFormatErrorMessage', () => {
      const authMock = require('../../../server/routes/public/auth');
      createApiRouter(mockDeps);
      const [, passedDeps] = authMock.mock.calls[0];

      const error = new Error('test');
      const req = {};
      passedDeps.formatErrorMessage(error, req, 'fallback');

      expect(utils.formatErrorMessage).toHaveBeenCalledWith(mockDeps.log, error, req, 'fallback');
    });

    it('extendedDeps.isPathSafe calls resolveLibraryPath and sharedIsPathSafe', () => {
      const authMock = require('../../../server/routes/public/auth');
      createApiRouter(mockDeps);
      const [, passedDeps] = authMock.mock.calls[0];

      utils.resolveLibraryPath.mockReturnValue('/resolved/path');
      utils.isPathSafe.mockReturnValue(true);

      const result = passedDeps.isPathSafe('L1/path');

      expect(utils.resolveLibraryPath).toHaveBeenCalledWith('L1/path', mockDeps.getPathFromLibraryId);
      expect(utils.isPathSafe).toHaveBeenCalledWith(mockDeps.log, mockDeps.getComicsDirectories, '/resolved/path');
      expect(result).toBe(true);
    });

    it('extendedDeps.resolvePath calls resolveLibraryPath', () => {
      const authMock = require('../../../server/routes/public/auth');
      createApiRouter(mockDeps);
      const [, passedDeps] = authMock.mock.calls[0];

      utils.resolveLibraryPath.mockReturnValue('/resolved/path2');

      const result = passedDeps.resolvePath('L2/path');

      expect(utils.resolveLibraryPath).toHaveBeenCalledWith('L2/path', mockDeps.getPathFromLibraryId);
      expect(result).toBe('/resolved/path2');
    });
  });

  describe('auth middlewares', () => {
    let originalRouter;
    let routerInstance;
    let routerCalls = [];

    beforeAll(() => {
      originalRouter = express.Router;
    });

    beforeEach(() => {
      routerCalls = [];
      jest.spyOn(express, 'Router').mockImplementation(() => {
        const instance = {
          use: jest.fn(),
          get: jest.fn(),
          post: jest.fn(),
          delete: jest.fn()
        };
        routerCalls.push(instance);
        return instance;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(() => {
      express.Router = originalRouter;
    });

    it('requireUserAuth bypassing and enforcing', () => {
      createApiRouter(mockDeps);

      // index.js creates 5 routers:
      // 1. main router
      // 2. public router
      // 3. impersonation router
      // 4. user router
      // 5. admin router

      const userRouter = routerCalls[3];
      const requireUserAuth = userRouter.use.mock.calls[0][0];

      // Test bypass
      const next1 = jest.fn();
      requireUserAuth({ path: '/public/test' }, {}, next1);
      expect(next1).toHaveBeenCalled();
      expect(mockDeps.requireAuth).not.toHaveBeenCalled();

      // Test enforce
      const next2 = jest.fn();
      requireUserAuth({ path: '/api/user/test' }, {}, next2);
      expect(mockDeps.requireAuth).toHaveBeenCalled();
    });

    it('requireAdminAuth bypassing and enforcing', () => {
      createApiRouter(mockDeps);

      const adminRouter = routerCalls[4];
      const requireAdminAuth = adminRouter.use.mock.calls[0][0];

      // Test bypass
      const next1 = jest.fn();
      requireAdminAuth({ path: '/public/test' }, {}, next1);
      expect(next1).toHaveBeenCalled();
      expect(mockDeps.requireAdmin).not.toHaveBeenCalled();

      // Test enforce
      const next2 = jest.fn();
      requireAdminAuth({ path: '/api/admin/test' }, {}, next2);
      expect(mockDeps.requireAdmin).toHaveBeenCalled();
    });

    it('requireRealAdminAuth handles impersonation paths properly', () => {
      createApiRouter(mockDeps);

      const impersonationRouter = routerCalls[2];
      const requireRealAdminAuth = impersonationRouter.use.mock.calls[0][0];

      // 1. Non-impersonate path -> bypass
      let res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      let next = jest.fn();
      requireRealAdminAuth({ path: '/api/other' }, res, next);
      expect(next).toHaveBeenCalled();

      // 2. Auth disabled -> bypass
      mockDeps.isAuthEnabled.mockReturnValueOnce(false);
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
      requireRealAdminAuth({ path: '/api/v1/admin/impersonate/test' }, res, next);
      expect(next).toHaveBeenCalled();

      // 3. Auth enabled, no user -> 403
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
      requireRealAdminAuth({ path: '/api/v1/admin/impersonate/test' }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });

      // 4. Auth enabled, user has admin role -> 200
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
      requireRealAdminAuth({ path: '/api/v1/admin/impersonate/test', user: { role: 'admin' } }, res, next);
      expect(next).toHaveBeenCalled();

      // 5. Auth enabled, realUser has admin role -> 200
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
      requireRealAdminAuth({ path: '/api/v1/admin/impersonate/test', realUser: { role: 'admin' }, user: { role: 'user' } }, res, next);
      expect(next).toHaveBeenCalled();

      // 6. Auth enabled, realUser is user -> 403
      res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      next = jest.fn();
      requireRealAdminAuth({ path: '/api/v1/admin/impersonate/test', realUser: { role: 'user' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
