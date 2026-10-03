/**
 * @jest-environment node
 *
 * Characterization tests for POST /api/v1/users/:userId/access.
 * These pin the exact dbRun sequence of the metadata-access normalization
 * path (where the hierarchy maps live) so refactors/deletions in that block
 * cannot silently change granted access.
 */

const attachUsersRoutes = require('../server/routes/admin/users');

describe('POST /api/v1/users/:userId/access', () => {
  let router;
  let deps;
  let accessHandler;

  const COMICS = [
    { path: '/comics/DC Comics/Batman/Batman 1.cbz', publisher: 'DC Comics', series: 'Batman' },
    { path: '/comics/IDW Publishing/X/X 1.cbz', publisher: 'IDW Publishing', series: 'X' },
    { path: '/elsewhere/Other/Other 1.cbz', publisher: 'Other Pub', series: 'Y' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    router = {
      get: jest.fn(),
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/users/:userId/access') accessHandler = args[args.length - 1];
      })
    };

    deps = {
      dbGet: jest.fn().mockResolvedValue({ userId: 'u1', role: 'user' }),
      dbRun: jest.fn().mockResolvedValue(undefined),
      dbAll: jest.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM comics')) return Promise.resolve(COMICS);
        return Promise.resolve([]);
      }),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err, req, msg) => msg || err.message),
      getComicsDirectories: jest.fn(() => ['/comics'])
    };

    attachUsersRoutes(router, deps);
  });

  function makeRes() {
    const res = {
      json: jest.fn(),
      status: jest.fn(() => res)
    };
    return res;
  }

  test('rejects a non-array access payload with 400 and writes nothing', async () => {
    const req = { params: { userId: 'u1' }, body: { access: 'nope' } };
    const res = makeRes();

    await accessHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Invalid access data: expected array' });
    expect(deps.dbRun).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown user', async () => {
    deps.dbGet.mockResolvedValue(null);
    const req = { params: { userId: 'ghost' }, body: { access: [] } };
    const res = makeRes();

    await accessHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'User not found' });
    expect(deps.dbRun).not.toHaveBeenCalled();
  });

  test('refuses to modify an admin user', async () => {
    deps.dbGet.mockResolvedValue({ userId: 'u1', role: 'admin' });
    const req = { params: { userId: 'u1' }, body: { access: [] } };
    const res = makeRes();

    await accessHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ ok: false, message: 'Cannot modify admin user access (admins have full access)' });
    expect(deps.dbRun).not.toHaveBeenCalled();
  });

  test('publisher child_access grant drops redundant series rows but keeps the publisher row', async () => {
    const req = {
      params: { userId: 'u1' },
      body: {
        access: [
          { accessType: 'publisher', accessValue: 'DC Comics', direct_access: true, child_access: true },
          { accessType: 'series', accessValue: 'Batman', direct_access: true, child_access: true }
        ]
      }
    };
    const res = makeRes();

    await accessHandler(req, res);

    expect(deps.dbRun.mock.calls).toEqual([
      ['DELETE FROM user_library_access WHERE userId = ?', ['u1']],
      [
        'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
        ['u1', 'publisher', 'DC Comics', 1, 1]
      ]
    ]);
    expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Access permissions updated successfully' });
  });

  test('series child_access collapses to direct_access (series is the lowest level)', async () => {
    const req = {
      params: { userId: 'u1' },
      body: {
        access: [
          { accessType: 'series', accessValue: 'Batman', direct_access: true, child_access: true }
        ]
      }
    };
    const res = makeRes();

    await accessHandler(req, res);

    expect(deps.dbRun.mock.calls).toEqual([
      ['DELETE FROM user_library_access WHERE userId = ?', ['u1']],
      [
        'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
        ['u1', 'series', 'Batman', 1, 0]
      ]
    ]);
    expect(deps.log).toHaveBeenCalledWith(
      'INFO',
      'ACCESS',
      expect.stringContaining('Normalized series:Batman')
    );
  });

  test('comic and folder grants bypass metadata normalization entirely', async () => {
    const req = {
      params: { userId: 'u1' },
      body: {
        access: [
          { accessType: 'comic', accessValue: '/comics/DC Comics/Batman/Batman 1.cbz', direct_access: true },
          { accessType: 'folder', accessValue: '/comics/DC Comics', direct_access: true, child_access: true }
        ]
      }
    };
    const res = makeRes();

    await accessHandler(req, res);

    expect(deps.getComicsDirectories).not.toHaveBeenCalled();
    expect(deps.dbAll).not.toHaveBeenCalled();
    expect(deps.dbRun.mock.calls).toEqual([
      ['DELETE FROM user_library_access WHERE userId = ?', ['u1']],
      [
        'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, 0)',
        ['u1', 'comic', '/comics/DC Comics/Batman/Batman 1.cbz', 1]
      ],
      [
        'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
        ['u1', 'folder', '/comics/DC Comics', 1, 1]
      ]
    ]);
    expect(res.json).toHaveBeenCalledWith({ ok: true, message: 'Access permissions updated successfully' });
  });
});
