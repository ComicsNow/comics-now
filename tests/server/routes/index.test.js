const express = require('express');
const { createApiRouter } = require('../../../server/routes/index');
const utils = require('../../../server/utils');

jest.mock('express', () => {
  return {
    Router: jest.fn(() => ({
      use: jest.fn()
    }))
  };
});

jest.mock('../../../server/utils', () => ({
  formatErrorMessage: jest.fn(() => 'formatted_error'),
  isPathSafe: jest.fn(() => true),
  resolveLibraryPath: jest.fn(() => '/resolved/path')
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

const mockSubRouters = [
  './public/auth', './public/health',
  './user/settings', './user/devices', './user/reading-lists', './user/reading', './user/progress', './user/library', './user/pages', './user/metadata',
  './admin/users', './admin/comictagger', './admin/guided', './admin/settings', './admin/library-mgmt', './admin/rename', './admin/mcp-tools', './admin/user-stats', './admin/gemini',
  './admin/impersonate'
];

mockSubRouters.forEach(route => {
  jest.mock(`../../../server/routes/${route}`, () => jest.fn());
});

describe('createApiRouter', () => {
  let mockDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDeps = {
      log: jest.fn(),
      getComicsDirectories: jest.fn(() => ['/mock/comics']),
      getPathFromLibraryId: jest.fn(() => '/mock/library'),
      requireAuth: jest.fn((req, res, next) => next()),
      requireAdmin: jest.fn((req, res, next) => next()),
      isAuthEnabled: jest.fn(() => true)
    };
  });

  it('should initialize and attach all routers', () => {
    const router = createApiRouter(mockDeps);

    // 1 main router + 4 sub-routers (public, user, admin, impersonation)
    expect(express.Router).toHaveBeenCalledTimes(5);

    expect(router.use).toHaveBeenCalledTimes(4); // Attach 4 sub-routers

    // Verify that sub-routes are required
    mockSubRouters.forEach(route => {
      const routeMock = require(`../../../server/routes/${route}`);
      expect(routeMock).toHaveBeenCalled();

      // Ensure extendedDeps are passed
      const args = routeMock.mock.calls[0];
      expect(args[1]).toHaveProperty('formatErrorMessage');
      expect(args[1]).toHaveProperty('isPathSafe');
      expect(args[1]).toHaveProperty('resolvePath');
    });
  });

  describe('extendedDeps', () => {
    let extendedDeps;

    beforeEach(() => {
      // Capture the extended deps by looking at a mocked route's arguments
      createApiRouter(mockDeps);
      const authMock = require('../../../server/routes/public/auth');
      extendedDeps = authMock.mock.calls[0][1];
    });

    it('formatErrorMessage calls shared utility', () => {
      const result = extendedDeps.formatErrorMessage(new Error('test'), {}, 'fallback');
      expect(utils.formatErrorMessage).toHaveBeenCalledWith(mockDeps.log, expect.any(Error), {}, 'fallback');
      expect(result).toBe('formatted_error');
    });

    it('isPathSafe calls shared utility', () => {
      const result = extendedDeps.isPathSafe('/some/path');
      expect(utils.resolveLibraryPath).toHaveBeenCalledWith('/some/path', mockDeps.getPathFromLibraryId);
      expect(utils.isPathSafe).toHaveBeenCalledWith(mockDeps.log, mockDeps.getComicsDirectories, '/resolved/path');
      expect(result).toBe(true);
    });

    it('resolvePath calls shared utility', () => {
      const result = extendedDeps.resolvePath('/another/path');
      expect(utils.resolveLibraryPath).toHaveBeenCalledWith('/another/path', mockDeps.getPathFromLibraryId);
      expect(result).toBe('/resolved/path');
    });
  });

  describe('Auth Middlewares', () => {
    let userMiddleware, adminMiddleware, realAdminMiddleware;
    let req, res, next;

    beforeEach(() => {
      createApiRouter(mockDeps);

      // Look at the use calls for the sub-routers to find the auth middlewares
      const routers = express.Router.mock.results;

      // 0: main, 1: public, 2: impersonation, 3: user, 4: admin
      const impersonationRouter = routers[2].value;
      const userRouter = routers[3].value;
      const adminRouter = routers[4].value;

      realAdminMiddleware = impersonationRouter.use.mock.calls[0][0];
      userMiddleware = userRouter.use.mock.calls[0][0];
      adminMiddleware = adminRouter.use.mock.calls[0][0];

      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      next = jest.fn();
    });

    describe('requireUserAuth', () => {
      it('should bypass for non-API paths', () => {
        req = { path: '/images/test.jpg' };
        userMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(mockDeps.requireAuth).not.toHaveBeenCalled();
      });

      it('should require auth for API paths', () => {
        req = { path: '/api/v1/user/settings' };
        userMiddleware(req, res, next);
        expect(mockDeps.requireAuth).toHaveBeenCalledWith(req, res, next);
      });
    });

    describe('requireAdminAuth', () => {
      it('should bypass for non-API paths', () => {
        req = { path: '/assets/style.css' };
        adminMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(mockDeps.requireAdmin).not.toHaveBeenCalled();
      });

      it('should require admin auth for API paths', () => {
        req = { path: '/api/v1/admin/users' };
        adminMiddleware(req, res, next);
        expect(mockDeps.requireAdmin).toHaveBeenCalledWith(req, res, next);
      });
    });

    describe('requireRealAdminAuth', () => {
      it('should bypass for non-impersonate paths', () => {
        req = { path: '/api/v1/admin/users' };
        realAdminMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should bypass when auth is disabled', () => {
        req = { path: '/api/v1/admin/impersonate' };
        mockDeps.isAuthEnabled.mockReturnValueOnce(false);
        realAdminMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should return 403 if no real/user exists', () => {
        req = { path: '/api/v1/admin/impersonate' };
        realAdminMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: Admin access required' });
        expect(next).not.toHaveBeenCalled();
      });

      it('should return 403 if user is not admin', () => {
        req = { path: '/api/v1/admin/impersonate', user: { role: 'user' } };
        realAdminMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      });

      it('should call next if realUser is admin', () => {
        req = { path: '/api/v1/admin/impersonate', realUser: { role: 'admin' }, user: { role: 'user' } };
        realAdminMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it('should call next if user is admin (and realUser is absent)', () => {
        req = { path: '/api/v1/admin/impersonate', user: { role: 'admin' } };
        realAdminMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
      });
    });
  });
});
