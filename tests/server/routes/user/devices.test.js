const attach = require('../../../../server/routes/user/devices');

describe('User Devices Route', () => {
  let router;
  let deps;
  let handlers = {};

  beforeEach(() => {
    jest.clearAllMocks();

    router = {
      post: jest.fn((path, middleware, handler) => {
        handlers[`POST ${path}`] = handler;
      }),
      get: jest.fn((path, middleware, handler) => {
        handlers[`GET ${path}`] = handler;
      }),
      delete: jest.fn((path, middleware, handler) => {
        handlers[`DELETE ${path}`] = handler;
      })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => `${msg}: ${err.message}`),
      validateFingerprint: jest.fn(fp => {
        if (!fp || fp === 'invalid-fp') return { valid: false, error: 'Invalid fingerprint' };
        return { valid: true, sanitized: fp };
      }),
      validateDeviceId: jest.fn(id => {
        if (id === 'invalid-id') return { valid: false, error: 'Invalid device ID' };
        return { valid: true, sanitized: id };
      }),
      validateDeviceName: jest.fn(name => ({ valid: true, sanitized: name || 'Unknown Device' })),
      validateComicId: jest.fn(id => {
        if (id === 'invalid-comic') return { valid: false, error: 'Invalid comic ID' };
        return { valid: true, sanitized: id };
      }),
      createId: jest.fn(() => 'generated-id'),
      requireAuth: jest.fn((req, res, next) => next())
    };

    attach(router, deps);
  });

  describe('POST /api/v1/device/register', () => {
    it('should return 400 for invalid fingerprint', async () => {
      const req = { body: { fingerprint: 'invalid-fp' }, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handlers['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid fingerprint' });
    });

    it('should register a new device when no deviceId provided and no existing device matches fingerprint', async () => {
      deps.dbGet.mockResolvedValueOnce(null); // No existing device
      deps.dbRun.mockResolvedValueOnce();

      const req = {
        body: { fingerprint: 'valid-fp', deviceName: 'My Phone' },
        user: { userId: 'user-1' },
        headers: { 'user-agent': 'Test Agent' }
      };
      const res = { json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(deps.dbGet).toHaveBeenCalledWith(
        'SELECT deviceId, deviceName FROM devices WHERE fingerprint = ? AND userId = ? LIMIT 1',
        ['valid-fp', 'user-1']
      );
      expect(deps.createId).toHaveBeenCalled();
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO devices'),
        expect.arrayContaining(['generated-id', 'My Phone', 'valid-fp', 'user-1', expect.any(Number), 'Test Agent'])
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'generated-id', deviceName: 'My Phone' });
    });

    it('should return existing device if matching fingerprint and userId are found', async () => {
      deps.dbGet.mockResolvedValueOnce({ deviceId: 'existing-id', deviceName: 'Existing Phone' });
      deps.dbGet.mockResolvedValueOnce(null); // existingOwner check
      deps.dbRun.mockResolvedValueOnce();

      const req = {
        body: { fingerprint: 'valid-fp' }, // no deviceName, will take from existing
        user: { userId: 'user-1' },
        headers: {}
      };
      const res = { json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO devices'),
        expect.arrayContaining(['existing-id', 'Existing Phone'])
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'existing-id', deviceName: 'Existing Phone' });
    });

    it('should validate and process provided deviceId', async () => {
      deps.dbGet.mockResolvedValueOnce(null); // No existing device with fingerprint
      deps.dbGet.mockResolvedValueOnce(null); // existingOwner check
      deps.dbRun.mockResolvedValueOnce();

      const req = {
        body: { deviceId: 'provided-id', fingerprint: 'valid-fp', deviceName: 'New Device' },
        user: { userId: 'user-1' },
        headers: {}
      };
      const res = { json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(deps.validateDeviceId).toHaveBeenCalledWith('provided-id');
      expect(deps.dbGet).not.toHaveBeenCalledWith(
        'SELECT deviceId, deviceName FROM devices WHERE fingerprint = ? AND userId = ? LIMIT 1',
        expect.anything()
      );
      expect(deps.dbGet).toHaveBeenCalledWith('SELECT userId FROM devices WHERE deviceId = ?', ['provided-id']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'provided-id', deviceName: 'New Device' });
    });

    it('should return 409 if deviceId is registered to another user (non-admin)', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' }); // existingOwner check

      const req = {
        body: { deviceId: 'provided-id', fingerprint: 'valid-fp' },
        user: { userId: 'user-1', role: 'user' },
        headers: {}
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Device ID is registered to another user' });
    });

    it('should allow admin to register an existing deviceId registered to another user', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' }); // existingOwner check
      deps.dbRun.mockResolvedValueOnce();

      const req = {
        body: { deviceId: 'provided-id', fingerprint: 'valid-fp', deviceName: 'Admin Phone' },
        user: { userId: 'admin-user', role: 'admin' },
        headers: {}
      };
      const res = { json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, deviceId: 'provided-id', deviceName: 'Admin Phone' });
    });

    it('should return 400 for invalid deviceId', async () => {
      const req = {
        body: { deviceId: 'invalid-id', fingerprint: 'valid-fp' },
        user: { userId: 'user-1' },
        headers: {}
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid device ID' });
    });

    it('should handle database errors gracefully', async () => {
      deps.dbRun.mockRejectedValueOnce(new Error('DB Error'));

      const req = {
        body: { deviceId: 'valid-id', fingerprint: 'valid-fp' },
        user: { userId: 'user-1' },
        headers: {}
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['POST /api/v1/device/register'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Device registration failed: DB Error' });
    });
  });

  describe('GET /api/v1/devices', () => {
    it('should fetch devices for the current user', async () => {
      const mockDevices = [{ deviceId: 'device-1' }, { deviceId: 'device-2' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      const req = { user: { userId: 'user-1' }, query: {} };
      const res = { json: jest.fn() };

      await handlers['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        ['user-1']
      );
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        devices: mockDevices,
        currentUserId: 'user-1',
        viewingUserId: 'user-1'
      });
    });

    it('should allow admin to fetch devices for another user', async () => {
      const mockDevices = [{ deviceId: 'target-device' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      const req = { user: { userId: 'admin-user', role: 'admin' }, query: { userId: 'target-user' } };
      const res = { json: jest.fn() };

      await handlers['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        ['target-user']
      );
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        devices: mockDevices,
        currentUserId: 'admin-user',
        viewingUserId: 'target-user'
      });
    });

    it('should ignore userId query param for non-admins', async () => {
      const mockDevices = [{ deviceId: 'user-device' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      const req = { user: { userId: 'user-1', role: 'user' }, query: { userId: 'target-user' } };
      const res = { json: jest.fn() };

      await handlers['GET /api/v1/devices'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        ['user-1']
      );
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        devices: mockDevices,
        currentUserId: 'user-1',
        viewingUserId: 'user-1'
      });
    });

    it('should handle database errors gracefully', async () => {
      deps.dbAll.mockRejectedValueOnce(new Error('DB Error'));

      const req = { user: { userId: 'user-1' }, query: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['GET /api/v1/devices'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to fetch devices: DB Error' });
    });
  });

  describe('DELETE /api/v1/devices/:deviceId', () => {
    it('should return 404 if device is not found', async () => {
      deps.dbGet.mockResolvedValueOnce(null);

      const req = { params: { deviceId: 'missing-id' }, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Device not found' });
    });

    it('should block non-admin from deleting another user\'s device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });

      const req = { params: { deviceId: 'target-id' }, user: { userId: 'user-1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'You can only delete your own devices' });
      expect(deps.dbRun).not.toHaveBeenCalled();
    });

    it('should allow user to delete their own device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'user-1' });
      deps.dbRun.mockResolvedValueOnce();

      const req = { params: { deviceId: 'my-id' }, user: { userId: 'user-1', role: 'user' } };
      const res = { json: jest.fn() };

      await handlers['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['my-id']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('should allow admin to delete another user\'s device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });
      deps.dbRun.mockResolvedValueOnce();

      const req = { params: { deviceId: 'target-id' }, user: { userId: 'admin-user', role: 'admin' } };
      const res = { json: jest.fn() };

      await handlers['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['target-id']);
      expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('should handle database errors gracefully', async () => {
      deps.dbGet.mockRejectedValueOnce(new Error('DB Error'));

      const req = { params: { deviceId: 'any-id' }, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['DELETE /api/v1/devices/:deviceId'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to delete device: DB Error' });
    });
  });

  describe('GET /api/v1/sync/devices/:comicId', () => {
    it('should return 400 for invalid comicId', async () => {
      const req = { params: { comicId: 'invalid-comic' }, query: {}, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid comic ID' });
    });

    it('should return 400 if comicId validation returns empty', async () => {
      deps.validateComicId.mockReturnValueOnce({ valid: true, sanitized: null });

      const req = { params: { comicId: 'valid-but-empty' }, query: {}, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Comic ID is required' });
    });

    it('should return 404 if comic is not found', async () => {
      deps.dbGet.mockResolvedValueOnce(null);

      const req = { params: { comicId: 'valid-comic' }, query: {}, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Comic not found' });
    });

    it('should return sync devices correctly mapped', async () => {
      deps.dbGet.mockResolvedValueOnce({ totalPages: 22 });
      const mockDevices = [
        { deviceId: 'dev-1', deviceName: 'Phone', lastSeen: 123, lastSyncTimestamp: 456, lastReadPage: 10 },
        { deviceId: 'dev-2', deviceName: 'Tablet', lastSeen: 100, lastSyncTimestamp: null, lastReadPage: null }
      ];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      const req = { params: { comicId: 'valid-comic' }, query: { currentDeviceId: 'dev-1' }, user: { userId: 'user-1' } };
      const res = { json: jest.fn() };

      await handlers['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('SELECT d.deviceId'),
        ['valid-comic', 'user-1']
      );

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        comic: {
          id: 'valid-comic',
          totalPages: 22
        },
        devices: [
          {
            deviceId: 'dev-1',
            deviceName: 'Phone',
            lastSeen: 123,
            lastSyncTimestamp: 456,
            lastReadPage: 10,
            isCurrentDevice: true
          },
          {
            deviceId: 'dev-2',
            deviceName: 'Tablet',
            lastSeen: 100,
            lastSyncTimestamp: null,
            lastReadPage: null,
            isCurrentDevice: false
          }
        ]
      });
    });

    it('should handle database errors gracefully', async () => {
      deps.dbGet.mockRejectedValueOnce(new Error('DB Error'));

      const req = { params: { comicId: 'valid-comic' }, query: {}, user: { userId: 'user-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await handlers['GET /api/v1/sync/devices/:comicId'](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to fetch comic sync devices: DB Error' });
    });
  });
});
