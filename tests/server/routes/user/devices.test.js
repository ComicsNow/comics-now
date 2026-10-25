const attachDevices = require('../../../../server/routes/user/devices');

describe('User Devices Routes', () => {
  let router;
  let routes;
  let deps;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, ...handlers) => { routes[`GET ${path}`] = handlers[handlers.length - 1]; }),
      post: jest.fn((path, ...handlers) => { routes[`POST ${path}`] = handlers[handlers.length - 1]; }),
      delete: jest.fn((path, ...handlers) => { routes[`DELETE ${path}`] = handlers[handlers.length - 1]; })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      validateFingerprint: jest.fn((f) => {
        if (!f) return { valid: true, sanitized: null };
        if (f === 'invalid-fp') return { valid: false, error: 'Invalid fingerprint' };
        return { valid: true, sanitized: f };
      }),
      validateDeviceId: jest.fn((id) => {
        if (id === 'invalid-id') return { valid: false, error: 'Invalid device ID' };
        return { valid: true, sanitized: id };
      }),
      validateDeviceName: jest.fn((name) => ({ valid: true, sanitized: name || 'Unknown Device' })),
      validateComicId: jest.fn((id) => {
        if (id === 'invalid-comic') return { valid: false, error: 'Invalid comic ID' };
        return { valid: true, sanitized: id };
      }),
      createId: jest.fn(() => 'new-device-id'),
      requireAuth: jest.fn((req, res, next) => next()) // Mock middleware
    };

    attachDevices(router, deps);
  });

  describe('POST /api/v1/device/register', () => {
    it('should successfully register a new device', async () => {
      const req = {
        body: { deviceName: 'My Phone', fingerprint: 'fp123' },
        user: { userId: 'user1' },
        headers: { 'user-agent': 'Test Agent' }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce(null); // No existing device
      deps.dbRun.mockResolvedValueOnce();

      await routes['POST /api/v1/device/register'](req, res);

      expect(deps.createId).toHaveBeenCalled();
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO devices'),
        expect.arrayContaining(['new-device-id', 'My Phone', 'fp123', 'user1'])
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'new-device-id', deviceName: 'My Phone' });
    });

    it('should fallback to existing device with same fingerprint and userId', async () => {
      const req = {
        body: { fingerprint: 'fp123' },
        user: { userId: 'user1' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ deviceId: 'existing-id', deviceName: 'Existing Device' });
      deps.dbGet.mockResolvedValueOnce({ userId: 'user1' }); // Owner check
      deps.dbRun.mockResolvedValueOnce();

      await routes['POST /api/v1/device/register'](req, res);

      expect(deps.createId).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'existing-id', deviceName: 'Existing Device' });
    });

    it('should return 400 for invalid fingerprint', async () => {
      const req = {
        body: { fingerprint: 'invalid-fp' },
        user: { userId: 'user1' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routes['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid fingerprint' });
    });

    it('should return 400 for invalid device ID', async () => {
      const req = {
        body: { deviceId: 'invalid-id' },
        user: { userId: 'user1' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routes['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid device ID' });
    });

    it('should return 409 if deviceId belongs to another user (non-admin)', async () => {
      const req = {
        body: { deviceId: 'other-user-device' },
        user: { userId: 'user1' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user2' });

      await routes['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Device ID is registered to another user' });
    });

    it('should allow if deviceId belongs to another user but caller is admin', async () => {
      const req = {
        body: { deviceId: 'other-user-device' },
        user: { userId: 'admin', role: 'admin' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user2' });
      deps.dbRun.mockResolvedValueOnce();

      await routes['POST /api/v1/device/register'](req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'other-user-device', deviceName: 'Unknown Device' });
    });

    it('should handle unexpected errors', async () => {
      const req = {
        body: { deviceName: 'My Phone' },
        user: { userId: 'user1' },
        headers: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbRun.mockRejectedValueOnce(new Error('DB error'));

      await routes['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'DB error' });
    });
  });

  describe('GET /api/v1/devices', () => {
    it('should return current user devices', async () => {
      const req = {
        user: { userId: 'user1' },
        query: {}
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      const mockDevices = [{ deviceId: 'dev1' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      await routes['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('WHERE userId = ?'),
        ['user1']
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, devices: mockDevices, currentUserId: 'user1', viewingUserId: 'user1' });
    });

    it('should allow admin to view other users devices via query param', async () => {
      const req = {
        user: { userId: 'admin1', role: 'admin' },
        query: { userId: 'user2' }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      const mockDevices = [{ deviceId: 'dev2' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      await routes['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('WHERE userId = ?'),
        ['user2']
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, devices: mockDevices, currentUserId: 'admin1', viewingUserId: 'user2' });
    });

    it('should ignore query param for non-admin', async () => {
      const req = {
        user: { userId: 'user1' },
        query: { userId: 'user2' }
      };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbAll.mockResolvedValueOnce([]);

      await routes['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('WHERE userId = ?'),
        ['user1']
      );
    });

    it('should handle errors', async () => {
      const req = { user: { userId: 'user1' }, query: {} };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbAll.mockRejectedValueOnce(new Error('DB error'));

      await routes['GET /api/v1/devices'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'DB error' });
    });
  });

  describe('DELETE /api/v1/devices/:deviceId', () => {
    it('should delete own device successfully', async () => {
      const req = { params: { deviceId: 'dev1' }, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user1' });
      deps.dbRun.mockResolvedValueOnce();

      await routes['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['dev1']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('should return 404 if device not found', async () => {
      const req = { params: { deviceId: 'dev1' }, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce(null);

      await routes['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Device not found' });
    });

    it('should return 403 if non-admin tries to delete another users device', async () => {
      const req = { params: { deviceId: 'dev1' }, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user2' });

      await routes['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'You can only delete your own devices' });
    });

    it('should delete another users device if caller is admin', async () => {
      const req = { params: { deviceId: 'dev1' }, user: { userId: 'admin', role: 'admin' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ userId: 'user2' });
      deps.dbRun.mockResolvedValueOnce();

      await routes['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['dev1']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('should handle errors', async () => {
      const req = { params: { deviceId: 'dev1' }, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockRejectedValueOnce(new Error('DB error'));

      await routes['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'DB error' });
    });
  });

  describe('GET /api/v1/sync/devices/:comicId', () => {
    it('should get comic sync devices', async () => {
      const req = { params: { comicId: 'comic1' }, query: { currentDeviceId: 'dev1' }, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce({ totalPages: 100 });
      const mockDevices = [
        { deviceId: 'dev1', deviceName: 'Dev 1', lastSeen: 1, lastReadPage: 10, lastSyncTimestamp: 100 },
        { deviceId: 'dev2', deviceName: 'Dev 2', lastSeen: 2, lastReadPage: null, lastSyncTimestamp: null }
      ];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      await routes['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        comic: { id: 'comic1', totalPages: 100 },
        devices: [
          { deviceId: 'dev1', deviceName: 'Dev 1', lastSeen: 1, lastReadPage: 10, lastSyncTimestamp: 100, isCurrentDevice: true },
          { deviceId: 'dev2', deviceName: 'Dev 2', lastSeen: 2, lastReadPage: null, lastSyncTimestamp: null, isCurrentDevice: false }
        ]
      });
    });

    it('should return 400 for invalid comic id', async () => {
      const req = { params: { comicId: 'invalid-comic' }, query: {}, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      await routes['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid comic ID' });
    });

    it('should return 404 if comic not found', async () => {
      const req = { params: { comicId: 'comic1' }, query: {}, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockResolvedValueOnce(null);

      await routes['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Comic not found' });
    });

    it('should handle errors', async () => {
      const req = { params: { comicId: 'comic1' }, query: {}, user: { userId: 'user1' } };
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

      deps.dbGet.mockRejectedValueOnce(new Error('DB error'));

      await routes['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'DB error' });
    });
  });
});
