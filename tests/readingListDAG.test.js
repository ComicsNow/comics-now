const attachReadingLists = require('../server/routes/user/reading-lists');

describe('Reading List DAG Tests', () => {
  let router;
  let routes;
  let deps;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, ...args) => {
        // args can be (requireAuth, handler) or just (handler)
        const handler = args[args.length - 1];
        routes[`GET ${path}`] = handler;
      }),
      post: jest.fn((path, ...args) => {
        const handler = args[args.length - 1];
        routes[`POST ${path}`] = handler;
      }),
      put: jest.fn((path, ...args) => {
        const handler = args[args.length - 1];
        routes[`PUT ${path}`] = handler;
      }),
      delete: jest.fn((path, ...args) => {
        const handler = args[args.length - 1];
        routes[`DELETE ${path}`] = handler;
      })
    };

    deps = {
      requireAuth: (req, res, next) => next(),
      dbGet: jest.fn(),
      dbRun: jest.fn().mockResolvedValue({ changes: 1 }),
      dbAll: jest.fn().mockResolvedValue([]),
      createId: jest.fn((str) => `id-${str}`),
      formatErrorMessage: jest.fn((err) => err.message),
      validateComicId: jest.fn((id) => ({ valid: true, sanitized: id })),
      log: jest.fn(),
      checkComicAccess: jest.fn().mockResolvedValue(true),
      getComicsDirectories: jest.fn().mockReturnValue(['/comics'])
    };

    attachReadingLists(router, deps);
  });

  it('registers the GET /api/v1/reading-lists/:id/dag route', () => {
    expect(routes['GET /api/v1/reading-lists/:id/dag']).toBeDefined();
  });

  it('returns 404 when reading list does not exist', async () => {
    const handler = routes['GET /api/v1/reading-lists/:id/dag'];
    deps.dbGet.mockResolvedValue(null);

    const req = {
      params: { id: 'nonexistent-list' },
      user: { userId: 'user-1', role: 'user' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, message: 'Reading list not found' })
    );
  });

  it('returns empty nodes and edges for an empty reading list', async () => {
    const handler = routes['GET /api/v1/reading-lists/:id/dag'];
    deps.dbGet.mockResolvedValue({
      id: 'list-1',
      name: 'Empty List',
      description: 'Nothing yet',
      userId: 'user-1'
    });
    deps.dbAll.mockResolvedValue([]);

    const req = {
      params: { id: 'list-1' },
      user: { userId: 'user-1', role: 'user' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        totalIssues: 0,
        nodes: [],
        edges: [],
        seriesLanes: []
      })
    );
  });

  it('generates reading order edges, multi-series lanes, and status for crossover list', async () => {
    const handler = routes['GET /api/v1/reading-lists/:id/dag'];
    deps.dbGet.mockResolvedValue({
      id: 'list-crossover',
      name: 'Absolute Universe Crossover',
      description: 'The Absolute Saga',
      userId: 'user-1'
    });

    // 4 issues bridging across Absolute Batman and Absolute Superman
    deps.dbAll.mockResolvedValue([
      {
        comicId: 'c-batman-1',
        addedAt: 1000,
        sortOrder: 0,
        name: 'Absolute Batman #1',
        series: 'Absolute Batman',
        publisher: 'DC Comics',
        path: '/comics/Absolute Batman #1.cbz',
        thumbnailPath: 'thumb-bat-1.jpg',
        metadata: JSON.stringify({ Number: '1', Year: '2024' }),
        totalPages: 32,
        lastReadPage: 32 // Completed read
      },
      {
        comicId: 'c-superman-1',
        addedAt: 1001,
        sortOrder: 1,
        name: 'Absolute Superman #1',
        series: 'Absolute Superman',
        publisher: 'DC Comics',
        path: '/comics/Absolute Superman #1.cbz',
        thumbnailPath: 'thumb-sup-1.jpg',
        metadata: JSON.stringify({ Number: '1', Year: '2024' }),
        totalPages: 30,
        lastReadPage: 15 // In progress
      },
      {
        comicId: 'c-batman-2',
        addedAt: 1002,
        sortOrder: 2,
        name: 'Absolute Batman #2',
        series: 'Absolute Batman',
        publisher: 'DC Comics',
        path: '/comics/Absolute Batman #2.cbz',
        thumbnailPath: 'thumb-bat-2.jpg',
        metadata: JSON.stringify({ Number: '2', Year: '2024' }),
        totalPages: 28,
        lastReadPage: 0 // Unread
      },
      {
        comicId: 'c-superman-2',
        addedAt: 1003,
        sortOrder: 3,
        name: 'Absolute Superman #2',
        series: 'Absolute Superman',
        publisher: 'DC Comics',
        path: '/comics/Absolute Superman #2.cbz',
        thumbnailPath: 'thumb-sup-2.jpg',
        metadata: JSON.stringify({ Number: '2', Year: '2024' }),
        totalPages: 30,
        lastReadPage: 0 // Unread
      }
    ]);

    const req = {
      params: { id: 'list-crossover' },
      user: { userId: 'user-1', role: 'user' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];

    expect(data.ok).toBe(true);
    expect(data.totalIssues).toBe(4);
    expect(data.readCount).toBe(1);
    expect(data.inProgressCount).toBe(1);

    // Verify nodes structure
    expect(data.nodes).toHaveLength(4);
    expect(data.nodes[0]).toMatchObject({
      id: 'c-batman-1',
      step: 1,
      series: 'Absolute Batman',
      number: '1',
      readStatus: 'read',
      progressPercent: 100,
      isCore: true // Primary spine lane 0
    });
    expect(data.nodes[1]).toMatchObject({
      id: 'c-superman-1',
      step: 2,
      series: 'Absolute Superman',
      number: '1',
      readStatus: 'in-progress',
      progressPercent: 50,
      isCore: false
    });

    // Verify Reading Order edges (step 0->1, 1->2, 2->3)
    const readingOrderEdges = data.edges.filter(e => e.type === 'reading-order');
    expect(readingOrderEdges).toHaveLength(3);
    expect(readingOrderEdges[0]).toEqual({
      id: 'edge-step-0',
      from: 'c-batman-1',
      to: 'c-superman-1',
      type: 'reading-order'
    });
    expect(readingOrderEdges[1]).toEqual({
      id: 'edge-step-1',
      from: 'c-superman-1',
      to: 'c-batman-2',
      type: 'reading-order'
    });
    expect(readingOrderEdges[2]).toEqual({
      id: 'edge-step-2',
      from: 'c-batman-2',
      to: 'c-superman-2',
      type: 'reading-order'
    });

    // Verify Series Continuity Track edges
    // Batman 1 -> Batman 2 (skipped Superman 1)
    // Superman 1 -> Superman 2 (skipped Batman 2)
    const seriesEdges = data.edges.filter(e => e.type === 'series-track');
    expect(seriesEdges).toHaveLength(2);
    expect(seriesEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'c-batman-1',
          to: 'c-batman-2',
          type: 'series-track',
          series: 'Absolute Batman'
        }),
        expect.objectContaining({
          from: 'c-superman-1',
          to: 'c-superman-2',
          type: 'series-track',
          series: 'Absolute Superman'
        })
      ])
    );

    // Verify series lanes
    expect(data.seriesLanes).toHaveLength(2);
    expect(data.seriesLanes[0].lane).toBe(0);
    expect(data.seriesLanes[1].lane).toBe(1);
  });

  it('filters out comics user does not have permission to access', async () => {
    const handler = routes['GET /api/v1/reading-lists/:id/dag'];
    deps.dbGet.mockResolvedValue({
      id: 'list-restricted',
      name: 'Restricted List',
      userId: 'user-2'
    });

    deps.dbAll.mockResolvedValue([
      {
        comicId: 'allowed-1',
        addedAt: 1000,
        sortOrder: 0,
        name: 'Allowed Comic',
        series: 'Open Series',
        path: '/comics/allowed.cbz',
        totalPages: 20,
        lastReadPage: 0
      },
      {
        comicId: 'forbidden-1',
        addedAt: 1001,
        sortOrder: 1,
        name: 'Forbidden Comic',
        series: 'Secret Series',
        path: '/comics/forbidden.cbz',
        totalPages: 20,
        lastReadPage: 0
      }
    ]);

    // Deny access to forbidden-1
    deps.checkComicAccess.mockImplementation(async (userId, role, path) => {
      return !path.includes('forbidden');
    });

    const req = {
      params: { id: 'list-restricted' },
      user: { userId: 'user-2', role: 'user' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    const data = res.json.mock.calls[0][0];
    expect(data.ok).toBe(true);
    expect(data.totalIssues).toBe(1);
    expect(data.nodes[0].id).toBe('allowed-1');
  });
});
