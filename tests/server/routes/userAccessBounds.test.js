const express = require('express');
const http = require('http');

const attachUserStoryArcsRoutes = require('../../../server/routes/user/story-arcs');
const attachReadingRoutes = require('../../../server/routes/user/reading');
const attachReadingListCrud = require('../../../server/routes/user/reading-lists/crud');
const attachReadingListItems = require('../../../server/routes/user/reading-lists/items');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

describe('[H-5] User Access Bounds on Story Arcs, Library Preferences & Reading Lists', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  test('GET /api/v1/comics/:comicId/continuity denies unauthorized comic and filters continuity issues', async () => {
    const allowedIds = new Set(['comic-ok-1', 'comic-ok-2']);
    const comicsDb = {
      'comic-ok-1': { id: 'comic-ok-1', path: '/comics/Public/1.cbz', publisher: 'DC', series: 'Public' },
      'comic-ok-2': { id: 'comic-ok-2', path: '/comics/Public/2.cbz', publisher: 'DC', series: 'Public' },
      'comic-secret': { id: 'comic-secret', path: '/comics/Private/1.cbz', publisher: 'Marvel', series: 'Private' }
    };

    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        hasArc: true,
        earlierUnread: [
          { id: 'comic-ok-2', title: 'Allowed Issue' },
          { id: 'comic-secret', title: 'Secret Issue' }
        ],
        nextIssue: { id: 'comic-secret', title: 'Secret Next' }
      })
    }));
    global.fetch = fetchMock;

    const app = express();
    app.use((req, res, next) => {
      if (req.headers['x-test-auth'] !== 'none') {
        req.user = { userId: 'u1', role: req.headers['x-test-role'] || 'user' };
      }
      next();
    });

    const router = express.Router();
    attachUserStoryArcsRoutes(router, {
      isAuthEnabled: () => true,
      getComicsDirectories: () => ['/comics'],
      dbGet: jest.fn(async (sql, params) => comicsDb[params[0]] || null),
      checkComicAccess: jest.fn(async ({ comicId }) => allowedIds.has(comicId)),
      requireAdmin: (req, res, next) => next()
    });
    app.use(router);

    const server = await startServer(app);
    try {
      const resUnauth = await origFetch(`${server.baseUrl}/api/v1/comics/comic-ok-1/continuity`, {
        headers: { 'x-test-auth': 'none' }
      });
      expect(resUnauth.status).toBe(401);

      const resForbidden = await origFetch(`${server.baseUrl}/api/v1/comics/comic-secret/continuity`);
      expect(resForbidden.status).toBe(403);

      const resOk = await origFetch(`${server.baseUrl}/api/v1/comics/comic-ok-1/continuity`);
      expect(resOk.status).toBe(200);
      const data = await resOk.json();
      expect(data.earlierUnread).toEqual([{ id: 'comic-ok-2', title: 'Allowed Issue' }]);
      expect(data.nextIssue).toBeNull();
    } finally {
      await server.close();
    }
  });

  test('POST /api/v1/user/library-preferences rejects path traversal and paths outside root directories', async () => {
    const dbRun = jest.fn(async () => ({ changes: 1 }));
    const setReadingPreference = jest.fn(async () => {});

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { userId: 'u1', role: 'user' };
      next();
    });

    const router = express.Router();
    attachReadingRoutes(router, {
      dbGet: jest.fn(),
      dbRun,
      log: jest.fn(),
      formatErrorMessage: (e) => e.message,
      validateComicId: (id) => ({ valid: true, sanitized: id }),
      requireAuth: (req, res, next) => next(),
      setReadingPreference,
      getComicsDirectories: () => ['/comics']
    });
    app.use(router);

    const server = await startServer(app);
    try {
      for (const badPath of ['/etc', '/comics-evil/Series', '/comics/../etc', '../secret']) {
        const res = await origFetch(`${server.baseUrl}/api/v1/user/library-preferences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: badPath, mangaMode: true, continuousMode: false })
        });
        expect([400, 403]).toContain(res.status);
      }
      expect(setReadingPreference).not.toHaveBeenCalled();
      expect(dbRun).not.toHaveBeenCalled();

      const resOk = await origFetch(`${server.baseUrl}/api/v1/user/library-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/comics/DC', mangaMode: true, continuousMode: false })
      });
      expect(resOk.status).toBe(200);
      expect(setReadingPreference).toHaveBeenCalledWith('u1', 'library', '/comics/DC', true, false);
    } finally {
      await server.close();
    }
  });

  test('reading-lists batch inserter filters unauthorized comicIds when auth is enabled for non-admins', async () => {
    const allowedIds = new Set(['c-allowed-1']);
    const comicsDb = {
      'c-allowed-1': { id: 'c-allowed-1', path: '/comics/Allowed/1.cbz', publisher: 'DC', series: 'Allowed' },
      'c-forbidden-1': { id: 'c-forbidden-1', path: '/comics/Secret/1.cbz', publisher: 'Marvel', series: 'Secret' }
    };
    const dbRun = jest.fn(async () => ({ changes: 1 }));
    const dbGet = jest.fn(async (sql, params) => {
      if (sql.includes('WHERE name = ?')) return null;
      if (sql.includes('FROM reading_lists')) return { id: 'list-1', userId: 'u1', name: 'My List' };
      if (sql.includes('MAX(sortOrder)')) return { maxOrder: 0 };
      if (sql.includes('FROM comics')) return comicsDb[params[0]] || null;
      return null;
    });

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { userId: 'u1', role: 'user' };
      next();
    });

    const deps = {
      requireAuth: (req, res, next) => next(),
      isAuthEnabled: () => true,
      getComicsDirectories: () => ['/comics'],
      checkComicAccess: jest.fn(async ({ comicId }) => allowedIds.has(comicId)),
      dbGet,
      dbAll: jest.fn(async () => []),
      dbRun,
      createId: () => 'list-1',
      formatErrorMessage: (e) => e.message,
      validateComicId: (id) => ({ valid: true, sanitized: id }),
      log: jest.fn()
    };

    const router = express.Router();
    attachReadingListCrud(router, deps);
    attachReadingListItems(router, deps);
    app.use(router);

    const server = await startServer(app);
    try {
      const resCreate = await origFetch(`${server.baseUrl}/api/v1/reading-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test List',
          comicIds: ['c-allowed-1', 'c-forbidden-1']
        })
      });
      expect(resCreate.status).toBe(200);

      const createInsertCalls = dbRun.mock.calls.filter(([sql]) => sql.includes('INTO reading_list_items'));
      expect(createInsertCalls.length).toBe(1);
      expect(createInsertCalls[0][1]).toContain('c-allowed-1');
      expect(createInsertCalls[0][1]).not.toContain('c-forbidden-1');

      dbRun.mockClear();

      const resAdd = await origFetch(`${server.baseUrl}/api/v1/reading-lists/list-1/comics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comicIds: ['c-allowed-1', 'c-forbidden-1'] })
      });
      expect(resAdd.status).toBe(200);

      const addInsertCalls = dbRun.mock.calls.filter(([sql]) => sql.includes('INTO reading_list_items'));
      expect(addInsertCalls.length).toBe(1);
      expect(addInsertCalls[0][1]).toContain('c-allowed-1');
      expect(addInsertCalls[0][1]).not.toContain('c-forbidden-1');
    } finally {
      await server.close();
    }
  });
});
