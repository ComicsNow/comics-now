const attach = require('../../../../server/routes/user/progress');
const path = require('path');

describe('User Progress Routes', () => {
  let router;
  let deps;
  let routes;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, handler) => { routes[path] = handler; }),
      post: jest.fn((path, handler) => { routes[path] = handler; })
    };

    deps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      resolvePath: jest.fn((p) => p),
      validateLastReadPage: jest.fn(),
      validateStatus: jest.fn(),
      validateComicId: jest.fn((id) => ({ valid: true, sanitized: id })),
      validateDeviceId: jest.fn((id) => ({ valid: true, sanitized: id }))
    };

    attach(router, deps);
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  test('should attach routes correctly', () => {
    expect(router.get).toHaveBeenCalledWith('/api/v1/sync/check/:comicId', expect.any(Function));
    expect(router.post).toHaveBeenCalledWith('/api/v1/sync/update', expect.any(Function));
    expect(router.post).toHaveBeenCalledWith('/api/v1/comics/status', expect.any(Function));
    expect(router.post).toHaveBeenCalledWith('/api/v1/series/status', expect.any(Function));
  });

  describe('GET /api/v1/sync/check/:comicId', () => {
    test('missing parameters', async () => {
      const req = { params: {}, query: {} };
      const res = mockRes();

      deps.validateComicId.mockReturnValueOnce({ valid: false, error: 'Invalid ID' });
      await routes['/api/v1/sync/check/:comicId'](req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid ID' });

      req.params.comicId = 'comic123';
      deps.validateComicId.mockReturnValueOnce({ valid: true, sanitized: 'comic123' });
      await routes['/api/v1/sync/check/:comicId'](req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Missing parameters' });
    });

    test('successful sync check with newer remote', async () => {
      const req = {
        params: { comicId: 'comic1' },
        query: { deviceId: 'dev1' },
        user: { userId: 'user1' }
      };
      const res = mockRes();

      deps.dbGet.mockImplementation(async (query, params) => {
        if (query.includes('FROM comics')) return { totalPages: 10 };
        if (query.includes('WHERE comicId = ? AND deviceId = ?')) {
          return { lastReadPage: 1, lastSyncTimestamp: 1000 };
        }
        if (query.includes('FROM device_progress dp')) {
          return { lastReadPage: 5, lastSyncTimestamp: 2000, deviceId: 'dev2', deviceName: 'Other Dev' };
        }
      });

      await routes['/api/v1/sync/check/:comicId'](req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        lastSyncTimestamp: 2000,
        lastSyncDeviceId: 'dev2',
        lastSyncDeviceName: 'Other Dev',
        lastReadPage: 5,
        totalPages: 10,
        hasNewerSync: true,
        isFromDifferentDevice: true,
        currentDeviceProgress: {
          lastReadPage: 1,
          lastSyncTimestamp: 1000
        }
      });
      expect(deps.dbRun).toHaveBeenCalledWith(expect.stringContaining('UPDATE devices SET lastSeen = ? WHERE deviceId = ?'), [expect.any(Number), 'dev1']);
    });
  });

  describe('POST /api/v1/sync/update', () => {
    test('missing parameters', async () => {
      const req = { body: { comicId: 'c1' } };
      const res = mockRes();

      await routes['/api/v1/sync/update'](req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Missing parameters' });
    });

    test('unauthorized device', async () => {
      const req = {
        body: { comicId: 'c1', deviceId: 'd1', lastReadPage: 1 },
        user: { userId: 'user1' }
      };
      const res = mockRes();

      deps.dbGet.mockResolvedValueOnce({ userId: 'otherUser' });
      await routes['/api/v1/sync/update'](req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Unauthorized device' });
    });

    test('successful update', async () => {
      const req = {
        body: { comicId: 'c1', deviceId: 'd1', lastReadPage: 5 },
        user: { userId: 'u1' }
      };
      const res = mockRes();

      deps.dbGet.mockImplementation(async (q) => {
        if (q.includes('FROM devices')) return { userId: 'u1' };
        if (q.includes('FROM comics')) return { totalPages: 10 };
      });

      deps.validateLastReadPage.mockReturnValue({ valid: true, sanitized: 5 });

      await routes['/api/v1/sync/update'](req, res);

      expect(res.json).toHaveBeenCalledWith({ ok: true, lastSyncTimestamp: expect.any(Number) });
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO device_progress'),
        ['c1', 'd1', 5, 10, expect.any(Number)]
      );
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', 'c1', 5, 10, expect.any(Number)]
      );
    });
  });

  describe('POST /api/v1/comics/status', () => {
    test('missing parameters', async () => {
      const req = { body: { comicId: 'c1' } }; // missing status
      const res = mockRes();

      await routes['/api/v1/comics/status'](req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Bad request' });
    });

    test('comic not found', async () => {
      const req = { body: { comicId: 'c1', status: 'read' } };
      const res = mockRes();

      deps.validateStatus.mockReturnValue({ valid: true, sanitized: 'read' });
      deps.dbGet.mockResolvedValueOnce(null); // Comic not found

      await routes['/api/v1/comics/status'](req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Comic not found' });
    });

    test('mark as read', async () => {
      const req = { body: { comicId: 'c1', status: 'read' }, user: { userId: 'u1' } };
      const res = mockRes();

      deps.validateStatus.mockReturnValue({ valid: true, sanitized: 'read' });
      deps.dbGet.mockResolvedValueOnce({ totalPages: 20 });

      await routes['/api/v1/comics/status'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', 'c1', 19, 20, expect.any(Number)]
      );
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        progress: { lastReadPage: 19, totalPages: 20 }
      });
    });

    test('mark as unread', async () => {
      const req = { body: { comicId: 'c1', status: 'unread' }, user: { userId: 'u1' } };
      const res = mockRes();

      deps.validateStatus.mockReturnValue({ valid: true, sanitized: 'unread' });
      deps.dbGet.mockResolvedValueOnce({ totalPages: 20 });

      await routes['/api/v1/comics/status'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', 'c1', 0, 20, expect.any(Number)]
      );
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        progress: { lastReadPage: 0, totalPages: 20 }
      });
    });
  });

  describe('POST /api/v1/series/status', () => {
    test('missing parameters', async () => {
      const req = { body: { publisher: 'DC' } };
      const res = mockRes();

      await routes['/api/v1/series/status'](req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('mark series as read', async () => {
      const req = {
        body: { publisher: 'Pub', series: 'Ser', status: 'read', rootFolder: 'lib' },
        user: { userId: 'u1' }
      };
      const res = mockRes();

      deps.validateStatus.mockReturnValue({ valid: true, sanitized: 'read' });
      deps.dbAll.mockResolvedValueOnce([{ id: 'c1', totalPages: 10 }, { id: 'c2', totalPages: 15 }]);
      deps.resolvePath.mockImplementation((p) => p);

      await routes['/api/v1/series/status'](req, res);

      expect(deps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, totalPages FROM comics WHERE series = ? AND publisher = ? AND path LIKE ?'),
        ['Ser', 'Pub', `lib${path.sep}%`]
      );

      expect(deps.dbRun).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', 'c1', 9, 10, expect.any(Number)]
      );
      expect(deps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        ['u1', 'c2', 14, 15, expect.any(Number)]
      );
      expect(deps.dbRun).toHaveBeenCalledWith('COMMIT');

      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('rollback on error', async () => {
      const req = {
        body: { publisher: 'Pub', series: 'Ser', status: 'read' },
        user: { userId: 'u1' }
      };
      const res = mockRes();

      deps.validateStatus.mockReturnValue({ valid: true, sanitized: 'read' });
      deps.dbAll.mockResolvedValueOnce([{ id: 'c1', totalPages: 10 }]);

      deps.dbRun.mockImplementation(async (q) => {
        if (q.includes('INSERT')) throw new Error('DB Error');
      });

      await routes['/api/v1/series/status'](req, res);

      expect(deps.dbRun).toHaveBeenCalledWith('ROLLBACK');
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
