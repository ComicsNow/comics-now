const attachDeviceRoutes = require('../../../../server/routes/user/devices');

describe('User Device Routes', () => {
  let router;
  let routes;
  let deps;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, ...middlewares) => { routes[`GET ${path}`] = middlewares[middlewares.length - 1]; }),
      post: jest.fn((path, ...middlewares) => { routes[`POST ${path}`] = middlewares[middlewares.length - 1]; }),
      delete: jest.fn((path, ...middlewares) => { routes[`DELETE ${path}`] = middlewares[middlewares.length - 1]; })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((error, req, defaultMessage) => defaultMessage),
      validateFingerprint: jest.fn(),
      validateDeviceId: jest.fn(),
      validateDeviceName: jest.fn(),
      validateComicId: jest.fn(),
      createId: jest.fn(),
      requireAuth: (req, res, next) => next()
    };

    mockReq = {
      body: {},
      query: {},
      params: {},
      headers: {},
      user: { userId: 'test-user' }
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    mockNext = jest.fn();

    attachDeviceRoutes(router, deps);
  });

  describe('POST /api/v1/device/register', () => {
    it('returns 400 if fingerprint validation fails', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: false, error: 'Invalid fingerprint' });
      mockReq.body = { fingerprint: 'bad' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid fingerprint' });
    });

    it('reuses existing deviceId if fingerprint matches and deviceId not provided', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceName.mockReturnValue({ valid: true, sanitized: 'Test Device' });
      deps.validateDeviceId.mockReturnValue({ valid: true, sanitized: 'existing-device-123' });

      deps.dbGet
        .mockResolvedValueOnce({ deviceId: 'existing-device-123', deviceName: 'Old Name' })
        .mockResolvedValueOnce({ userId: 'test-user' });

      mockReq.body = { fingerprint: 'good-fingerprint' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(deps.dbGet).toHaveBeenCalledWith(
        'SELECT deviceId, deviceName FROM devices WHERE fingerprint = ? AND userId = ? LIMIT 1',
        ['good-fingerprint', 'test-user']
      );

      expect(deps.dbRun).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        deviceId: 'existing-device-123',
        deviceName: 'Test Device'
      });
    });

    it('uses existing deviceName if not provided and fingerprint matches', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceName.mockReturnValue({ valid: true, sanitized: 'Old Name' });
      deps.validateDeviceId.mockReturnValue({ valid: true, sanitized: 'existing-device-123' });

      deps.dbGet
        .mockResolvedValueOnce({ deviceId: 'existing-device-123', deviceName: 'Old Name' })
        .mockResolvedValueOnce({ userId: 'test-user' });

      mockReq.body = { fingerprint: 'good-fingerprint' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        deviceId: 'existing-device-123',
        deviceName: 'Old Name'
      });
    });

    it('generates a new deviceId if not provided and no existing fingerprint match', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceName.mockReturnValue({ valid: true, sanitized: 'Test Device' });
      deps.createId.mockReturnValue('new-device-id');

      deps.dbGet.mockResolvedValueOnce(null);

      mockReq.body = { fingerprint: 'good-fingerprint', deviceName: 'Test Device' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(deps.createId).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        deviceId: 'new-device-id',
        deviceName: 'Test Device'
      });
    });

    it('returns 400 if provided deviceId is invalid', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceId.mockReturnValue({ valid: false, error: 'Invalid device ID' });

      mockReq.body = { deviceId: 'bad-id', fingerprint: 'good-fingerprint' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid device ID' });
    });

    it('returns 409 if provided deviceId is registered to another user (non-admin)', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceId.mockReturnValue({ valid: true, sanitized: 'good-id' });

      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });

      mockReq.body = { deviceId: 'good-id', fingerprint: 'good-fingerprint' };
      mockReq.user.role = 'user';

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Device ID is registered to another user' });
    });

    it('allows registering existing deviceId if user is admin', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceId.mockReturnValue({ valid: true, sanitized: 'good-id' });
      deps.validateDeviceName.mockReturnValue({ valid: true, sanitized: 'Test Device' });

      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });

      mockReq.body = { deviceId: 'good-id', fingerprint: 'good-fingerprint', deviceName: 'Test Device' };
      mockReq.user.role = 'admin';

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        deviceId: 'good-id',
        deviceName: 'Test Device'
      });
    });

    it('handles database errors gracefully', async () => {
      deps.validateFingerprint.mockReturnValue({ valid: true, sanitized: 'good-fingerprint' });
      deps.validateDeviceName.mockReturnValue({ valid: true, sanitized: 'Test Device' });
      deps.createId.mockReturnValue('new-device-id');

      deps.dbGet.mockRejectedValueOnce(new Error('DB error'));

      mockReq.body = { fingerprint: 'good-fingerprint' };

      await routes['POST /api/v1/device/register'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Device registration failed'
      });
    });
  });

  describe('GET /api/v1/devices', () => {
    it('fetches own devices for regular user', async () => {
      const mockDevices = [{ deviceId: '1' }, { deviceId: '2' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      await routes['GET /api/v1/devices'](mockReq, mockRes);

      expect(deps.dbAll).toHaveBeenCalledWith(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        ['test-user']
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        devices: mockDevices,
        currentUserId: 'test-user',
        viewingUserId: 'test-user'
      });
    });

    it('allows admin to fetch devices for another user', async () => {
      const mockDevices = [{ deviceId: '3' }];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      mockReq.user.role = 'admin';
      mockReq.query = { userId: 'other-user' };

      await routes['GET /api/v1/devices'](mockReq, mockRes);

      expect(deps.dbAll).toHaveBeenCalledWith(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        ['other-user']
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        devices: mockDevices,
        currentUserId: 'test-user',
        viewingUserId: 'other-user'
      });
    });

    it('handles database errors gracefully', async () => {
      deps.dbAll.mockRejectedValueOnce(new Error('DB error'));

      await routes['GET /api/v1/devices'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to fetch devices'
      });
    });
  });

  describe('DELETE /api/v1/devices/:deviceId', () => {
    it('returns 404 if device not found', async () => {
      deps.dbGet.mockResolvedValueOnce(null);
      mockReq.params = { deviceId: 'missing-id' };

      await routes['DELETE /api/v1/devices/:deviceId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Device not found' });
    });

    it('returns 403 if non-admin tries to delete another users device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });
      mockReq.params = { deviceId: 'other-device-id' };
      mockReq.user.role = 'user';

      await routes['DELETE /api/v1/devices/:deviceId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'You can only delete your own devices' });
    });

    it('allows admin to delete another users device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });
      mockReq.params = { deviceId: 'other-device-id' };
      mockReq.user.role = 'admin';

      await routes['DELETE /api/v1/devices/:deviceId'](mockReq, mockRes);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['other-device-id']);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('allows user to delete own device', async () => {
      deps.dbGet.mockResolvedValueOnce({ userId: 'test-user' });
      mockReq.params = { deviceId: 'my-device-id' };

      await routes['DELETE /api/v1/devices/:deviceId'](mockReq, mockRes);

      expect(deps.dbRun).toHaveBeenCalledWith('DELETE FROM devices WHERE deviceId = ?', ['my-device-id']);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true, message: 'Device deleted successfully' });
    });

    it('handles database errors gracefully', async () => {
      deps.dbGet.mockRejectedValueOnce(new Error('DB error'));
      mockReq.params = { deviceId: 'my-device-id' };

      await routes['DELETE /api/v1/devices/:deviceId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to delete device'
      });
    });
  });

  describe('GET /api/v1/sync/devices/:comicId', () => {
    it('returns 400 if comicId is invalid', async () => {
      deps.validateComicId.mockReturnValue({ valid: false, error: 'Invalid comic ID' });
      mockReq.params = { comicId: 'bad-id' };

      await routes['GET /api/v1/sync/devices/:comicId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid comic ID' });
    });

    it('returns 400 if comicId is falsy', async () => {
      deps.validateComicId.mockReturnValue({ valid: true, sanitized: null });
      mockReq.params = { comicId: 'null' };

      await routes['GET /api/v1/sync/devices/:comicId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Comic ID is required' });
    });

    it('returns 404 if comic not found in db', async () => {
      deps.validateComicId.mockReturnValue({ valid: true, sanitized: 'good-id' });
      deps.dbGet.mockResolvedValueOnce(null); // Comic doesn't exist
      mockReq.params = { comicId: 'good-id' };

      await routes['GET /api/v1/sync/devices/:comicId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ ok: false, message: 'Comic not found' });
    });

    it('returns devices with progress info for the comic', async () => {
      deps.validateComicId.mockReturnValue({ valid: true, sanitized: 'good-id' });
      deps.dbGet.mockResolvedValueOnce({ totalPages: 100 });

      const mockDevices = [
        { deviceId: 'd1', deviceName: 'D1', lastSeen: 1000, lastSyncTimestamp: 1000, lastReadPage: 10 },
        { deviceId: 'd2', deviceName: 'D2', lastSeen: 2000, lastSyncTimestamp: null, lastReadPage: null }
      ];
      deps.dbAll.mockResolvedValueOnce(mockDevices);

      mockReq.params = { comicId: 'good-id' };
      mockReq.query = { currentDeviceId: 'd1' };

      await routes['GET /api/v1/sync/devices/:comicId'](mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        comic: {
          id: 'good-id',
          totalPages: 100
        },
        devices: [
          {
            deviceId: 'd1',
            deviceName: 'D1',
            lastSeen: 1000,
            lastSyncTimestamp: 1000,
            lastReadPage: 10,
            isCurrentDevice: true
          },
          {
            deviceId: 'd2',
            deviceName: 'D2',
            lastSeen: 2000,
            lastSyncTimestamp: null,
            lastReadPage: null,
            isCurrentDevice: false
          }
        ]
      });
    });

    it('handles database errors gracefully', async () => {
      deps.validateComicId.mockReturnValue({ valid: true, sanitized: 'good-id' });
      deps.dbGet.mockRejectedValueOnce(new Error('DB error'));
      mockReq.params = { comicId: 'good-id' };

      await routes['GET /api/v1/sync/devices/:comicId'](mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ok: false,
        message: 'Failed to fetch comic sync devices'
      });
    });
  });
});