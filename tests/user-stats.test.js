/**
 * @jest-environment node
 */

const attachUserStats = require('../server/routes/admin/user-stats');

describe('GET /api/v1/users/:userId/stats', () => {
  let router;
  let deps;
  let getHandler;
  let mockNow;
  const FIXED_NOW = 1700000000000; // arbitrary timestamp for deterministic tests
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNow = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/users/:userId/stats') {
          getHandler = args[args.length - 1];
        }
      })
    };

    deps = {
      dbGet: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => msg || err.message)
    };

    attachUserStats(router, deps);
  });

  afterEach(() => {
    mockNow.mockRestore();
  });

  function makeRes() {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    return res;
  }

  function dayKey(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  it('should return 404 if user not found', async () => {
    deps.dbGet.mockResolvedValue(null);
    const req = { params: { userId: 'u1' }, query: {} };
    const res = makeRes();

    await getHandler(req, res);

    expect(deps.dbGet).toHaveBeenCalledWith('SELECT userId, email, role FROM users WHERE userId = ?', ['u1']);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
  });

  it('should return 500 on database error', async () => {
    deps.dbGet.mockRejectedValue(new Error('DB connection failed'));
    const req = { params: { userId: 'u1' }, query: {} };
    const res = makeRes();

    await getHandler(req, res);

    expect(deps.log).toHaveBeenCalledWith('ERROR', 'STATS', 'Failed to build user stats: DB connection failed');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Failed to load user stats' });
  });

  it('should calculate stats for a user with empty reading history', async () => {
    deps.dbGet.mockResolvedValue({ userId: 'u1', email: 'test@example.com', role: 'user' });
    deps.dbAll.mockResolvedValue([]);
    const req = { params: { userId: 'u1' }, query: {} };
    const res = makeRes();

    await getHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      user: { userId: 'u1', email: 'test@example.com', role: 'user' },
      rangeDays: 30,
      summary: {
        opened: 0,
        completed: 0,
        inProgress: 0,
        activeDays: 0,
        lastActive: null
      },
      recent: []
    }));

    const responseData = res.json.mock.calls[0][0];
    expect(responseData.perDay.length).toBe(30);
    expect(responseData.perDay[0].day).toBe(dayKey(FIXED_NOW - 29 * DAY_MS));
    expect(responseData.perDay[0].comics).toBe(0);
    expect(responseData.perDay[29].day).toBe(dayKey(FIXED_NOW));
    expect(responseData.perDay[29].comics).toBe(0);
  });

  it('should calculate stats correctly for a user with history', async () => {
    deps.dbGet.mockResolvedValue({ userId: 'u1', email: 'test@example.com', role: 'user' });
    const yesterday = FIXED_NOW - DAY_MS;
    const today = FIXED_NOW;
    const oldDate = FIXED_NOW - 40 * DAY_MS; // outside the 30-day window

    deps.dbAll.mockResolvedValue([
      // Completed comic, read today
      { comicId: 'c1', comicName: 'Comic 1', series: 'Series A', lastReadPage: 10, totalPages: 11, updatedAt: today },
      // Completed comic (exactly last page), read yesterday
      { comicId: 'c2', comicName: 'Comic 2', series: 'Series A', lastReadPage: 11, totalPages: 11, updatedAt: yesterday },
      // In progress comic, read yesterday
      { comicId: 'c3', comicName: 'Comic 3', series: 'Series B', lastReadPage: 5, totalPages: 20, updatedAt: yesterday },
      // Opened but not in progress (page 0), read today
      { comicId: 'c4', comicName: 'Comic 4', series: 'Series C', lastReadPage: 0, totalPages: 10, updatedAt: today },
      // Completed comic, read outside 30 days window
      { comicId: 'c5', comicName: 'Comic 5', series: 'Series D', lastReadPage: 10, totalPages: 11, updatedAt: oldDate }
    ]);

    const req = { params: { userId: 'u1' }, query: {} };
    const res = makeRes();

    await getHandler(req, res);

    expect(deps.dbAll).toHaveBeenCalledWith(expect.any(String), ['u1']);

    const responseData = res.json.mock.calls[0][0];

    expect(responseData.ok).toBe(true);
    expect(responseData.summary).toEqual({
      opened: 5,       // all 5 rows
      completed: 3,    // c1, c2, c5
      inProgress: 1,   // c3 (c4 is page 0)
      activeDays: 2,   // today and yesterday (oldDate is out of window)
      lastActive: today
    });

    // Check perDay array
    const todayStr = dayKey(today);
    const yesterdayStr = dayKey(yesterday);
    const todayData = responseData.perDay.find(d => d.day === todayStr);
    const yesterdayData = responseData.perDay.find(d => d.day === yesterdayStr);

    expect(todayData.comics).toBe(2); // c1, c4
    expect(yesterdayData.comics).toBe(2); // c2, c3

    // Check recent array
    expect(responseData.recent.length).toBe(5);
    expect(responseData.recent[0]).toMatchObject({ comicId: 'c1', status: 'completed' });
    expect(responseData.recent[1]).toMatchObject({ comicId: 'c4', status: 'opened' });
    expect(responseData.recent[2]).toMatchObject({ comicId: 'c2', status: 'completed' });
    expect(responseData.recent[3]).toMatchObject({ comicId: 'c3', status: 'in_progress' });
    expect(responseData.recent[4]).toMatchObject({ comicId: 'c5', status: 'completed' }); // sorted by updatedAt descending
  });

  it('should respect custom days parameter', async () => {
    deps.dbGet.mockResolvedValue({ userId: 'u1', email: 'test@example.com', role: 'user' });

    // A record 40 days ago
    const oldDate = FIXED_NOW - 40 * DAY_MS;
    deps.dbAll.mockResolvedValue([
      { comicId: 'c1', comicName: 'Comic 1', series: 'Series A', lastReadPage: 10, totalPages: 11, updatedAt: oldDate }
    ]);

    const req = { params: { userId: 'u1' }, query: { days: '60' } };
    const res = makeRes();

    await getHandler(req, res);

    const responseData = res.json.mock.calls[0][0];
    expect(responseData.rangeDays).toBe(60);
    expect(responseData.summary.activeDays).toBe(1); // Now included in the window
    expect(responseData.perDay.length).toBe(60);
  });

  it('should cap days parameter at 365', async () => {
    deps.dbGet.mockResolvedValue({ userId: 'u1', email: 'test@example.com', role: 'user' });
    deps.dbAll.mockResolvedValue([]);

    const req = { params: { userId: 'u1' }, query: { days: '500' } };
    const res = makeRes();

    await getHandler(req, res);

    const responseData = res.json.mock.calls[0][0];
    expect(responseData.rangeDays).toBe(365);
    expect(responseData.perDay.length).toBe(365);
  });
});
