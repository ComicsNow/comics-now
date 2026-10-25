const attachUserStats = require('../../../../server/routes/admin/user-stats');

describe('GET /api/v1/users/:userId/stats', () => {
  let router;
  let deps;
  let handler;

  beforeEach(() => {
    router = {
      get: jest.fn((path, cb) => {
        if (path === '/api/v1/users/:userId/stats') {
          handler = cb;
        }
      })
    };

    deps = {
      dbGet: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => `${msg}: ${err.message}`)
    };

    attachUserStats(router, deps);
  });

  const setupReqRes = (params = {}, query = {}) => {
    const req = { params, query };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    return { req, res };
  };

  test('should return 404 if user is not found', async () => {
    const { req, res } = setupReqRes({ userId: '1' });
    deps.dbGet.mockResolvedValueOnce(null);

    await handler(req, res);

    expect(deps.dbGet).toHaveBeenCalledWith('SELECT userId, email, role FROM users WHERE userId = ?', ['1']);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
  });

  test('should return 500 on database error', async () => {
    const { req, res } = setupReqRes({ userId: '1' });
    const error = new Error('DB error');
    deps.dbGet.mockRejectedValueOnce(error);

    await handler(req, res);

    expect(deps.log).toHaveBeenCalledWith('ERROR', 'STATS', 'Failed to build user stats: DB error');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message: 'Failed to load user stats: DB error'
    });
  });

  test('should return stats for a user successfully', async () => {
    const { req, res } = setupReqRes({ userId: '1' }, { days: '7' });
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    deps.dbGet.mockResolvedValueOnce({ userId: '1', email: 'test@example.com', role: 'user' });

    // Mock 3 comics:
    // 1: completed
    // 2: in_progress
    // 3: opened (but not in progress or completed, e.g. 0 pages read)
    deps.dbAll.mockResolvedValueOnce([
      {
        comicId: 'c1',
        lastReadPage: 19,
        totalPages: 20,
        updatedAt: now - 1 * DAY_MS,
        comicName: 'Comic 1',
        series: 'Series 1'
      },
      {
        comicId: 'c2',
        lastReadPage: 5,
        totalPages: 20,
        updatedAt: now - 2 * DAY_MS,
        comicName: 'Comic 2',
        series: 'Series 1'
      },
      {
        comicId: 'c3',
        lastReadPage: 0,
        totalPages: 20,
        updatedAt: now - 8 * DAY_MS, // Outside the 7-day range for day map, but still an opened comic
        comicName: 'Comic 3',
        series: 'Series 2'
      }
    ]);

    await handler(req, res);

    expect(deps.dbGet).toHaveBeenCalledWith('SELECT userId, email, role FROM users WHERE userId = ?', ['1']);
    expect(deps.dbAll).toHaveBeenCalledWith(
      expect.stringContaining('SELECT ucs.comicId, ucs.lastReadPage, ucs.totalPages, ucs.updatedAt'),
      ['1']
    );

    expect(res.json).toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0];

    expect(responseData.ok).toBe(true);
    expect(responseData.user).toEqual({ userId: '1', email: 'test@example.com', role: 'user' });
    expect(responseData.rangeDays).toBe(7);

    // Summary checks
    expect(responseData.summary).toEqual({
      opened: 3,
      completed: 1,
      inProgress: 1,
      activeDays: 2, // Only c1 and c2 are within the 7-day range
      lastActive: now - 1 * DAY_MS
    });

    // Recent checks
    expect(responseData.recent).toHaveLength(3);
    // Recent is sorted by updatedAt descending
    expect(responseData.recent[0].comicId).toBe('c1');
    expect(responseData.recent[0].status).toBe('completed');
    expect(responseData.recent[1].comicId).toBe('c2');
    expect(responseData.recent[1].status).toBe('in_progress');
    expect(responseData.recent[2].comicId).toBe('c3');
    expect(responseData.recent[2].status).toBe('opened');

    // Per day checks (should have 7 days)
    expect(responseData.perDay).toHaveLength(7);
  });
});
