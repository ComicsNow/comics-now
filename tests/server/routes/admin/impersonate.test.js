const attach = require('../../../../server/routes/admin/impersonate');
const impersonationMiddleware = require('../../../../server/middleware/impersonation');

jest.mock('../../../../server/middleware/impersonation', () => ({
  signToken: jest.fn(),
  setCookie: jest.fn(),
  clearCookie: jest.fn()
}));

describe('Admin Impersonation Routes', () => {
  let router;
  let deps;
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();

    handlers = {};
    router = {
      get: jest.fn((path, handler) => {
        handlers[`GET ${path}`] = handler;
      }),
      post: jest.fn((path, handler) => {
        handlers[`POST ${path}`] = handler;
      })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => msg)
    };

    attach(router, deps);
  });

  describe('GET /api/v1/admin/impersonate/status', () => {
    it('returns impersonating: true with target and admin details when req.impersonator is present', () => {
      const handler = handlers['GET /api/v1/admin/impersonate/status'];
      const req = {
        impersonator: { userId: 'admin1', email: 'admin@test.com' },
        user: { userId: 'user1', email: 'user@test.com' }
      };
      const res = {
        json: jest.fn()
      };

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 'user1', email: 'user@test.com' },
        admin: { userId: 'admin1', email: 'admin@test.com' }
      });
    });

    it('returns impersonating: false when req.impersonator is not present', () => {
      const handler = handlers['GET /api/v1/admin/impersonate/status'];
      const req = { user: { userId: 'admin1', email: 'admin@test.com' } };
      const res = { json: jest.fn() };

      handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });
  });

  describe('POST /api/v1/admin/impersonate/stop', () => {
    it('clears cookie, audits, logs, and returns impersonating: false when req.impersonator is present', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/stop'];
      const req = {
        impersonator: { userId: 'admin1', email: 'admin@test.com' },
        user: { userId: 'user1', email: 'user@test.com' }
      };
      const res = { json: jest.fn() };

      await handler(req, res);

      expect(impersonationMiddleware.clearCookie).toHaveBeenCalledWith(res);
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        ['admin1', 'admin@test.com', 'user1', 'user@test.com', 'stop', expect.any(Number)]
      );
      expect(deps.log).toHaveBeenCalledWith('INFO', 'IMPERSONATE', 'admin@test.com stopped impersonating user@test.com');
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('clears cookie and returns impersonating: false when req.impersonator is not present', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/stop'];
      const req = { user: { userId: 'admin1', email: 'admin@test.com' } };
      const res = { json: jest.fn() };

      await handler(req, res);

      expect(impersonationMiddleware.clearCookie).toHaveBeenCalledWith(res);
      expect(deps.dbRun).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('returns 500 when an error occurs', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/stop'];
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      impersonationMiddleware.clearCookie.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to stop impersonation' });
    });
  });

  describe('POST /api/v1/admin/impersonate/:userId', () => {
    it('returns 400 when admin tries to impersonate themselves', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1' },
        params: { userId: 'admin1' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'You cannot impersonate yourself.' });
    });

    it('returns 404 when target user is not found', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1' },
        params: { userId: 'unknown' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      deps.dbGet.mockResolvedValueOnce(null);

      await handler(req, res);

      expect(deps.dbGet).toHaveBeenCalledWith('SELECT userId, email, role FROM users WHERE userId = ?', ['unknown']);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
    });

    it('returns 400 when target user is another admin', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1' },
        params: { userId: 'admin2' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'admin2', email: 'admin2@test.com', role: 'admin' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Cannot impersonate another admin.' });
    });

    it('signs token, sets cookie, audits, logs, and returns success', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1', email: 'admin1@test.com' },
        params: { userId: 'user1' }
      };
      const res = { json: jest.fn() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user1', email: 'user1@test.com', role: 'user' });
      impersonationMiddleware.signToken.mockResolvedValueOnce('mock-token');

      await handler(req, res);

      expect(impersonationMiddleware.signToken).toHaveBeenCalledWith(deps.dbGet, deps.dbRun, {
        adminUserId: 'admin1',
        targetUserId: 'user1'
      });
      expect(impersonationMiddleware.setCookie).toHaveBeenCalledWith(res, 'mock-token', req);
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        ['admin1', 'admin1@test.com', 'user1', 'user1@test.com', 'start', expect.any(Number)]
      );
      expect(deps.log).toHaveBeenCalledWith('INFO', 'IMPERSONATE', 'admin1@test.com started impersonating user1@test.com');
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 'user1', email: 'user1@test.com' }
      });
    });

    it('returns 500 when an error occurs', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        user: { userId: 'admin1' },
        params: { userId: 'user1' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      deps.dbGet.mockRejectedValueOnce(new Error('DB Error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to start impersonation' });
    });

    it('uses realUser if available instead of user', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/:userId'];
      const req = {
        realUser: { userId: 'admin1', email: 'admin1@test.com' },
        user: { userId: 'somebody', email: 'somebody@test.com' },
        params: { userId: 'user1' }
      };
      const res = { json: jest.fn() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user1', email: 'user1@test.com', role: 'user' });
      impersonationMiddleware.signToken.mockResolvedValueOnce('mock-token');

      await handler(req, res);

      expect(impersonationMiddleware.signToken).toHaveBeenCalledWith(deps.dbGet, deps.dbRun, {
        adminUserId: 'admin1',
        targetUserId: 'user1'
      });
    });
  });

  describe('GET /api/v1/admin/impersonate/audit', () => {
    it('returns audit trail successfully', async () => {
      const handler = handlers['GET /api/v1/admin/impersonate/audit'];
      const req = {};
      const res = { json: jest.fn() };

      const mockRows = [{ adminEmail: 'admin@test.com', targetEmail: 'user@test.com', action: 'start', ts: 12345 }];
      deps.dbAll.mockResolvedValueOnce(mockRows);

      await handler(req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(expect.stringContaining('SELECT adminEmail, targetEmail, action, ts FROM impersonation_audit'));
      expect(res.json).toHaveBeenCalledWith({ ok: true, audit: mockRows });
    });

    it('returns 500 when an error occurs', async () => {
      const handler = handlers['GET /api/v1/admin/impersonate/audit'];
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      deps.dbAll.mockRejectedValueOnce(new Error('DB Error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to load audit' });
    });
  });

  describe('audit failures', () => {
    it('catches audit write failures and logs them', async () => {
      const handler = handlers['POST /api/v1/admin/impersonate/stop'];
      const req = {
        impersonator: { userId: 'admin1', email: 'admin@test.com' },
        user: { userId: 'user1', email: 'user@test.com' }
      };
      const res = { json: jest.fn() };

      deps.dbRun.mockRejectedValueOnce(new Error('Audit DB Error'));

      await handler(req, res);

      expect(deps.log).toHaveBeenCalledWith('WARN', 'IMPERSONATE', 'audit write failed: Audit DB Error');
      // Still completes normally
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });
  });
});
