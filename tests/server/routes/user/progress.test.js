const attachProgressRoutes = require('../../../../server/routes/user/progress');

describe('User Progress Routes', () => {
  let router;
  let mockDeps;
  let res;

  beforeEach(() => {
    router = {
      get: jest.fn(),
      post: jest.fn(),
    };

    mockDeps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      resolvePath: jest.fn((p) => p),
      validateLastReadPage: jest.fn((page) => ({ valid: true, sanitized: page })),
      validateStatus: jest.fn((status) => ({ valid: true, sanitized: status })),
      validateComicId: jest.fn((id) => ({ valid: true, sanitized: id })),
      validateDeviceId: jest.fn((id) => ({ valid: true, sanitized: id })),
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    attachProgressRoutes(router, mockDeps);
  });

  describe('GET /api/v1/sync/check/:comicId', () => {
    let routeHandler;

    beforeEach(() => {
      routeHandler = router.get.mock.calls.find((call) => call[0] === '/api/v1/sync/check/:comicId')[1];
    });

    test('should fail if validateComicId is invalid', async () => {
      mockDeps.validateComicId.mockReturnValueOnce({ valid: false, error: 'Invalid ID' });
      await routeHandler({ params: { comicId: 'bad' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid ID' });
    });

    test('should fail if missing deviceId parameter', async () => {
      await routeHandler({ params: { comicId: '123' }, query: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Missing parameters' });
    });

    test('should handle authorized sync check successfully', async () => {
      const req = {
        params: { comicId: '123' },
        query: { deviceId: 'dev1' },
        user: { userId: 'u1' }
      };

      mockDeps.dbGet
        .mockResolvedValueOnce({ userId: 'u1' }) // device ownership
        .mockResolvedValueOnce({ totalPages: 10 }) // comic total pages
        .mockResolvedValueOnce({ lastReadPage: 2, lastSyncTimestamp: 100 }) // current progress
        .mockResolvedValueOnce({ lastReadPage: 5, lastSyncTimestamp: 200, deviceId: 'dev2', deviceName: 'Tablet' }); // other progress

      await routeHandler(req, res);

      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE devices SET lastSeen = ? WHERE deviceId = ?'),
        [expect.any(Number), 'dev1']
      );

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        lastSyncTimestamp: 200,
        lastSyncDeviceId: 'dev2',
        lastSyncDeviceName: 'Tablet',
        lastReadPage: 5,
        totalPages: 10,
        hasNewerSync: true,
        isFromDifferentDevice: true,
        currentDeviceProgress: {
          lastReadPage: 2,
          lastSyncTimestamp: 100
        }
      });
    });
  });

  describe('POST /api/v1/sync/update', () => {
    let routeHandler;

    beforeEach(() => {
      routeHandler = router.post.mock.calls.find((call) => call[0] === '/api/v1/sync/update')[1];
    });

    test('should return 400 if missing comicId or deviceId', async () => {
      await routeHandler({ body: { comicId: null, deviceId: null } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should return 403 if deviceId belongs to another user', async () => {
      mockDeps.dbGet.mockResolvedValueOnce({ userId: 'other-user' });
      await routeHandler({ body: { comicId: '123', deviceId: 'dev1' }, user: { userId: 'u1' } }, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('should update progress and return ok: true', async () => {
      mockDeps.dbGet
        .mockResolvedValueOnce({ userId: 'u1' }) // ownership
        .mockResolvedValueOnce({ totalPages: 10 }); // total pages

      await routeHandler({
        body: { comicId: '123', deviceId: 'dev1', lastReadPage: 5 },
        user: { userId: 'u1' }
      }, res);

      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO device_progress'),
        expect.arrayContaining(['123', 'dev1', 5, 10, expect.any(Number)])
      );
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.any(Array)
      );

      expect(res.json).toHaveBeenCalledWith({ ok: true, lastSyncTimestamp: expect.any(Number) });
    });
  });

  describe('POST /api/v1/comics/status', () => {
    let routeHandler;

    beforeEach(() => {
      routeHandler = router.post.mock.calls.find((call) => call[0] === '/api/v1/comics/status')[1];
    });

    test('should fail if missing comicId or status', async () => {
      await routeHandler({ body: { comicId: '123' } }, res); // missing status
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should fail if comic not found', async () => {
      mockDeps.dbGet.mockResolvedValueOnce(null);
      await routeHandler({ body: { comicId: '123', status: 'read' } }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('should update to read status successfully', async () => {
      mockDeps.dbGet.mockResolvedValueOnce({ totalPages: 20 });
      await routeHandler({ body: { comicId: '123', status: 'read' }, user: { userId: 'u1' } }, res);

      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', '123', 19, 20, expect.any(Number)]
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, progress: { lastReadPage: 19, totalPages: 20 } });
    });

    test('should update to unread status successfully', async () => {
      mockDeps.dbGet.mockResolvedValueOnce({ totalPages: 20 });
      await routeHandler({ body: { comicId: '123', status: 'unread' }, user: { userId: 'u1' } }, res);

      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', '123', 0, 20, expect.any(Number)]
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true, progress: { lastReadPage: 0, totalPages: 20 } });
    });
  });

  describe('POST /api/v1/series/status', () => {
    let routeHandler;

    beforeEach(() => {
      routeHandler = router.post.mock.calls.find((call) => call[0] === '/api/v1/series/status')[1];
    });

    test('should fail if missing required fields', async () => {
      await routeHandler({ body: { series: 'S' } }, res); // missing publisher and status
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('should update series to read status successfully', async () => {
      const mockComics = [
        { id: '1', totalPages: 10 },
        { id: '2', totalPages: 15 }
      ];
      mockDeps.dbAll.mockResolvedValueOnce(mockComics);

      await routeHandler({
        body: { publisher: 'Pub', series: 'Ser', status: 'read', rootFolder: 'Library' },
        user: { userId: 'u1' }
      }, res);

      expect(mockDeps.dbRun).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', '1', 9, 10, expect.any(Number)]
      );
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', '2', 14, 15, expect.any(Number)]
      );
      expect(mockDeps.dbRun).toHaveBeenCalledWith('COMMIT');

      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('should roll back on error', async () => {
      const mockComics = [{ id: '1', totalPages: 10 }];
      mockDeps.dbAll.mockResolvedValueOnce(mockComics);
      mockDeps.dbRun.mockImplementationOnce(() => {}).mockImplementationOnce(() => {
        throw new Error('DB Error');
      });

      try {
        await routeHandler({
          body: { publisher: 'Pub', series: 'Ser', status: 'read' },
          user: { userId: 'u1' }
        }, res);
      } catch(e) {}

      expect(mockDeps.dbRun).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
