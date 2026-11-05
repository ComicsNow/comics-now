/**
 * @jest-environment node
 */

const attachRunFileRoutes = require('../server/routes/admin/comictagger/run-file');

describe('POST /api/v1/tag-comics-now/run-file', () => {
  let handler;
  let deps;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    const router = {
      post: jest.fn((routePath, ...args) => {
        if (routePath === '/api/v1/tag-comics-now/run-file') handler = args[args.length - 1];
      })
    };

    deps = {
      dbGet: jest.fn().mockResolvedValue({
        id: 'mock-comic-id',
        path: 'fixtures/mock-comic.cbr',
        publisher: 'Mock Publisher',
        series: 'Mock Series'
      }),
      checkComicAccess: jest.fn().mockResolvedValue(true),
      getComicsDirectories: jest.fn().mockReturnValue(['fixtures']),
      runSingleFileTagger: jest.fn().mockResolvedValue({
        status: 'tagged',
        matchedTitle: 'Mock Series #1',
        companion: { synced: true }
      }),
      formatErrorMessage: jest.fn((err) => err.message)
    };

    attachRunFileRoutes(router, deps);

    res = {
      json: jest.fn(),
      status: jest.fn(() => res)
    };
  });

  test('rejects a missing comicId without touching the database', async () => {
    await handler({ body: {}, user: { role: 'admin' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_comic_id' }));
    expect(deps.dbGet).not.toHaveBeenCalled();
    expect(deps.runSingleFileTagger).not.toHaveBeenCalled();
  });

  test('rejects an unknown comic with 404', async () => {
    deps.dbGet.mockResolvedValue(null);

    await handler({ body: { comicId: 'missing' }, user: { role: 'admin' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'comic_not_found' }));
    expect(deps.runSingleFileTagger).not.toHaveBeenCalled();
  });

  test('rejects comics outside the user access scope with 403', async () => {
    deps.checkComicAccess.mockResolvedValue(false);

    await handler({ body: { comicId: 'mock-comic-id' }, user: { userId: 'mock-user', role: 'user' } }, res);

    expect(deps.checkComicAccess).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mock-user',
      userRole: 'user',
      comicPath: 'fixtures/mock-comic.cbr',
      publisher: 'Mock Publisher',
      series: 'Mock Series',
      rootFolders: ['fixtures']
    }));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deps.runSingleFileTagger).not.toHaveBeenCalled();
  });

  test('runs the tag search for an accessible comic and forwards force', async () => {
    await handler({ body: { comicId: 'mock-comic-id', force: true }, user: { role: 'admin' } }, res);

    expect(deps.runSingleFileTagger).toHaveBeenCalledWith({
      comicId: 'mock-comic-id',
      force: true
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      status: 'tagged',
      matchedTitle: 'Mock Series #1'
    }));
  });

  test('defaults force to false', async () => {
    await handler({ body: { comicId: 'mock-comic-id' }, user: { role: 'admin' } }, res);

    expect(deps.runSingleFileTagger).toHaveBeenCalledWith({
      comicId: 'mock-comic-id',
      force: false
    });
  });

  test('maps typed service errors to their HTTP status', async () => {
    const err = new Error('A tag search is already running');
    err.code = 'file_tagger_running';
    err.statusCode = 409;
    deps.runSingleFileTagger.mockRejectedValue(err);

    await handler({ body: { comicId: 'mock-comic-id' }, user: { role: 'admin' } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      code: 'file_tagger_running',
      message: 'A tag search is already running'
    });
  });
});
