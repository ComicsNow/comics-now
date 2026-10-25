const express = require('express');
const attach = require('../../../../server/routes/admin/impersonate');

jest.mock('../../../../server/middleware/impersonation', () => ({
  signToken: jest.fn(),
  setCookie: jest.fn(),
  clearCookie: jest.fn()
}));

const { signToken, setCookie, clearCookie } = require('../../../../server/middleware/impersonation');

describe('Admin Impersonate Routes', () => {
  let router;
  let mockDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDeps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message)
    };

    router = express.Router();
    attach(router, mockDeps);
  });

  const getHandler = (method, path) => {
    const layer = router.stack.find(
      (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
    );
    return layer ? layer.route.stack[0].handle : null;
  };

  const createReqRes = (overrides = {}) => {
    const req = {
      user: { userId: 1, email: 'admin@test.com', role: 'admin' },
      ...overrides
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    return { req, res };
  };

  describe('GET /api/v1/admin/impersonate/status', () => {
    it('returns impersonating: false when not impersonating', async () => {
      const handler = getHandler('get', '/api/v1/admin/impersonate/status');
      const { req, res } = createReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('returns impersonation details when impersonator is set', async () => {
      const handler = getHandler('get', '/api/v1/admin/impersonate/status');
      const { req, res } = createReqRes({
        user: { userId: 2, email: 'user@test.com' },
        impersonator: { userId: 1, email: 'admin@test.com' }
      });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 2, email: 'user@test.com' },
        admin: { userId: 1, email: 'admin@test.com' }
      });
    });
  });
  describe('POST /api/v1/admin/impersonate/stop', () => {
    it('stops impersonation and creates audit log if impersonating', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/stop');
      const { req, res } = createReqRes({
        user: { userId: 2, email: 'user@test.com' },
        impersonator: { userId: 1, email: 'admin@test.com' }
      });
      mockDeps.dbRun.mockResolvedValueOnce();

      await handler(req, res);

      expect(clearCookie).toHaveBeenCalledWith(res);
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        [1, 'admin@test.com', 2, 'user@test.com', 'stop', expect.any(Number)]
      );
      expect(mockDeps.log).toHaveBeenCalledWith(
        'INFO',
        'IMPERSONATE',
        'admin@test.com stopped impersonating user@test.com'
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('stops impersonation safely even if not currently impersonating', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/stop');
      const { req, res } = createReqRes();

      await handler(req, res);

      expect(clearCookie).toHaveBeenCalledWith(res);
      expect(mockDeps.dbRun).not.toHaveBeenCalled();
      expect(mockDeps.log).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, impersonating: false });
    });

    it('handles errors properly', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/stop');
      const { req, res } = createReqRes();

      clearCookie.mockImplementationOnce(() => {
        throw new Error('Cookie error');
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Cookie error'
      });
    });
  });

  describe('POST /api/v1/admin/impersonate/:userId', () => {
    it('prevents impersonating oneself', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/:userId');
      const { req, res } = createReqRes({
        params: { userId: 1 },
        user: { userId: 1, email: 'admin@test.com', role: 'admin' }
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'You cannot impersonate yourself.' });
    });

    it('returns 404 if target user is not found', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/:userId');
      const { req, res } = createReqRes({
        params: { userId: 99 }
      });
      mockDeps.dbGet.mockResolvedValueOnce(null);

      await handler(req, res);

      expect(mockDeps.dbGet).toHaveBeenCalledWith(
        'SELECT userId, email, role FROM users WHERE userId = ?',
        [99]
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
    });

    it('prevents impersonating another admin', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/:userId');
      const { req, res } = createReqRes({
        params: { userId: 2 }
      });
      mockDeps.dbGet.mockResolvedValueOnce({ userId: 2, email: 'admin2@test.com', role: 'admin' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Cannot impersonate another admin.' });
    });

    it('successfully starts impersonation', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/:userId');
      const { req, res } = createReqRes({
        params: { userId: 2 }
      });

      mockDeps.dbGet.mockResolvedValueOnce({ userId: 2, email: 'user@test.com', role: 'user' });
      signToken.mockResolvedValueOnce('fake-jwt-token');
      mockDeps.dbRun.mockResolvedValueOnce(); // audit

      await handler(req, res);

      expect(signToken).toHaveBeenCalledWith(mockDeps.dbGet, mockDeps.dbRun, {
        adminUserId: 1,
        targetUserId: 2
      });
      expect(setCookie).toHaveBeenCalledWith(res, 'fake-jwt-token', req);

      // Audit assertions
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO impersonation_audit'),
        [1, 'admin@test.com', 2, 'user@test.com', 'start', expect.any(Number)]
      );
      expect(mockDeps.log).toHaveBeenCalledWith(
        'INFO',
        'IMPERSONATE',
        'admin@test.com started impersonating user@test.com'
      );

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        impersonating: true,
        target: { userId: 2, email: 'user@test.com' }
      });
    });

    it('handles errors properly', async () => {
      const handler = getHandler('post', '/api/v1/admin/impersonate/:userId');
      const { req, res } = createReqRes({
        params: { userId: 2 }
      });

      mockDeps.dbGet.mockRejectedValueOnce(new Error('DB error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'DB error'
      });
    });
  });

  describe('GET /api/v1/admin/impersonate/audit', () => {
    it('successfully retrieves audit records', async () => {
      const handler = getHandler('get', '/api/v1/admin/impersonate/audit');
      const { req, res } = createReqRes();

      const mockRows = [
        { adminEmail: 'admin@test.com', targetEmail: 'user@test.com', action: 'start', ts: 12345 },
        { adminEmail: 'admin@test.com', targetEmail: 'user@test.com', action: 'stop', ts: 12346 }
      ];
      mockDeps.dbAll.mockResolvedValueOnce(mockRows);

      await handler(req, res);

      expect(mockDeps.dbAll).toHaveBeenCalledWith(
        'SELECT adminEmail, targetEmail, action, ts FROM impersonation_audit ORDER BY ts DESC LIMIT 100'
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, audit: mockRows });
    });

    it('handles errors properly', async () => {
      const handler = getHandler('get', '/api/v1/admin/impersonate/audit');
      const { req, res } = createReqRes();

      mockDeps.dbAll.mockRejectedValueOnce(new Error('DB error'));

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        message: 'DB error'
      });
    });
  });
});
