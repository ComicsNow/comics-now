const attach = require('../../../../server/routes/admin/impersonate');
const { signToken, setCookie, clearCookie } = require('../../../../server/middleware/impersonation');

jest.mock('../../../../server/middleware/impersonation', () => ({
  signToken: jest.fn(),
  setCookie: jest.fn(),
  clearCookie: jest.fn()
}));

describe('Admin Impersonation Routes', () => {
  let mockRouter;
  let mockDeps;
  let routeHandlers = {};

  beforeEach(() => {
    jest.clearAllMocks();
    routeHandlers = {};

    mockRouter = {
      get: jest.fn((path, handler) => {
        routeHandlers[`GET ${path}`] = handler;
      }),
      post: jest.fn((path, handler) => {
        routeHandlers[`POST ${path}`] = handler;
      })
    };

    mockDeps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => msg || err.message)
    };

    attach(mockRouter, mockDeps);
  });

  describe('GET /api/v1/admin/impersonate/status', () => {
    it('should return impersonating: false when not impersonating', () => {
      const handler = routeHandlers['GET /api/v1/admin/impersonate/status'];
      const req = {};
      const res = { json: jest.fn() };

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('should return impersonating: true and details when impersonating', () => {
      const handler = routeHandlers['GET /api/v1/admin/impersonate/status'];
      const req = {
        impersonator: { userId: 'admin1', email: 'admin@test.com' },
        user: { userId: 'user1', email: 'user@test.com' }
      };
      const res = { json: jest.fn() };

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 'user1', email: 'user@test.com' },
        admin: { userId: 'admin1', email: 'admin@test.com' }
      });
    });
  });

  describe('POST /api/v1/admin/impersonate/stop', () => {
    it('should clear cookie and return ok when not impersonating', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/stop'];
      const req = {};
      const res = { json: jest.fn() };

      await handler(req, res);

      expect(clearCookie).toHaveBeenCalledWith(res);
      expect(mockDeps.dbRun).not.toHaveBeenCalled();
      expect(mockDeps.log).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('should clear cookie, audit, log, and return ok when impersonating', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/stop'];
      const req = {
        impersonator: { userId: 'admin1', email: 'admin@test.com' },
        user: { userId: 'user1', email: 'user@test.com' }
      };
      const res = { json: jest.fn() };

      mockDeps.dbRun.mockResolvedValue();

      await handler(req, res);

      expect(clearCookie).toHaveBeenCalledWith(res);
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        ['admin1', 'admin@test.com', 'user1', 'user@test.com', 'stop', expect.any(Number)]
      );
      expect(mockDeps.log).toHaveBeenCalledWith('INFO', 'IMPERSONATE', 'admin@test.com stopped impersonating user@test.com');
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('should handle errors gracefully', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/stop'];
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      clearCookie.mockImplementationOnce(() => { throw new Error('Cookie error'); });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to stop impersonation'
      });
      expect(mockDeps.formatErrorMessage).toHaveBeenCalledWith(expect.any(Error), req, 'Failed to stop impersonation');
    });
  });

  describe('POST /api/v1/admin/impersonate/:userId', () => {
    it('should fail with 400 if trying to impersonate oneself', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1', email: 'admin@test.com' },
        params: { userId: 'admin1' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'You cannot impersonate yourself.' });
    });

    it('should fail with 404 if target user is not found', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1', email: 'admin@test.com' },
        params: { userId: 'unknown' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      mockDeps.dbGet.mockResolvedValue(null);

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
    });

    it('should fail with 400 if target user is an admin', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1', email: 'admin@test.com' },
        params: { userId: 'admin2' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      mockDeps.dbGet.mockResolvedValue({ userId: 'admin2', email: 'admin2@test.com', role: 'admin' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Cannot impersonate another admin.' });
    });

    it('should successfully start impersonation for a valid user', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1', email: 'admin@test.com' },
        params: { userId: 'user1' }
      };
      const res = { json: jest.fn() };

      mockDeps.dbGet.mockResolvedValue({ userId: 'user1', email: 'user@test.com', role: 'user' });
      mockDeps.dbRun.mockResolvedValue();
      signToken.mockResolvedValue('mockToken');

      await handler(req, res);

      expect(signToken).toHaveBeenCalledWith(mockDeps.dbGet, mockDeps.dbRun, { adminUserId: 'admin1', targetUserId: 'user1' });
      expect(setCookie).toHaveBeenCalledWith(res, 'mockToken', req);
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        ['admin1', 'admin@test.com', 'user1', 'user@test.com', 'start', expect.any(Number)]
      );
      expect(mockDeps.log).toHaveBeenCalledWith('INFO', 'IMPERSONATE', 'admin@test.com started impersonating user@test.com');
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 'user1', email: 'user@test.com' }
      });
    });

    it('should handle errors gracefully', async () => {
      const handler = routeHandlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1' },
        params: { userId: 'user1' }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      mockDeps.dbGet.mockRejectedValue(new Error('DB error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to start impersonation'
      });
      expect(mockDeps.formatErrorMessage).toHaveBeenCalledWith(expect.any(Error), req, 'Failed to start impersonation');
    });
  });

  describe('GET /api/v1/admin/impersonate/audit', () => {
    it('should return audit logs successfully', async () => {
      const handler = routeHandlers['GET /api/v1/admin/impersonate/audit'];
      const req = {};
      const res = { json: jest.fn() };
      const mockRows = [{ action: 'start' }, { action: 'stop' }];

      mockDeps.dbAll.mockResolvedValue(mockRows);

      await handler(req, res);

      expect(mockDeps.dbAll).toHaveBeenCalledWith(expect.stringContaining('SELECT adminEmail, targetEmail, action, ts FROM impersonation_audit'));
      expect(res.json).toHaveBeenCalledWith({ ok: true, audit: mockRows });
    });

    it('should handle errors gracefully', async () => {
      const handler = routeHandlers['GET /api/v1/admin/impersonate/audit'];
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      mockDeps.dbAll.mockRejectedValue(new Error('DB error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to load audit'
      });
      expect(mockDeps.formatErrorMessage).toHaveBeenCalledWith(expect.any(Error), req, 'Failed to load audit');
    });
  });
});
