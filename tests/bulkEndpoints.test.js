const attachMcpTools = require('../server/routes/admin/mcp-tools');
const attachReadingLists = require('../server/routes/user/reading-lists');

describe('Bulk Endpoints Tests', () => {
  describe('Bulk Tagging and Metadata Retrieval Routes', () => {
    let router;
    let routes;
    let deps;

    beforeEach(() => {
      routes = {};
      router = {
        get: jest.fn((path, handler) => { routes[`GET ${path}`] = handler; }),
        post: jest.fn((path, handler) => { routes[`POST ${path}`] = handler; })
      };

      deps = {
        dbGet: jest.fn(),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 }),
        dbAll: jest.fn(),
        log: jest.fn(),
        formatErrorMessage: jest.fn((err) => err.message),
        getComicPages: jest.fn(),
        getMimeFromExt: jest.fn()
      };

      attachMcpTools(router, deps);
    });

    it('should batch get metadata for multiple comics', async () => {
      const handler = routes['POST /api/v1/comics/tags/batch'];
      expect(handler).toBeDefined();

      deps.dbAll.mockResolvedValue([
        {
          id: 'c1',
          name: 'Comic 1',
          path: '/path/to/c1.cbz',
          series: 'Series 1',
          publisher: 'DC',
          metadata: JSON.stringify({ Writer: 'Tom King' }),
          totalPages: 24,
          tagStatus: 'completed'
        },
        {
          id: 'c2',
          name: 'Comic 2',
          path: '/path/to/c2.cbz',
          series: 'Series 2',
          publisher: 'Marvel',
          metadata: null,
          totalPages: 32,
          tagStatus: 'pending'
        }
      ]);

      const req = { body: { comicIds: ['c1', 'c2', 'c3'] } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          count: 2,
          items: expect.arrayContaining([
            expect.objectContaining({ comicId: 'c1', series: 'Series 1', publisher: 'DC' }),
            expect.objectContaining({ comicId: 'c2', series: 'Series 2', publisher: 'Marvel' })
          ]),
          notFound: ['c3']
        })
      );
    });

    it('should bulk tag comics with shared fields and storage=db', async () => {
      const handler = routes['POST /api/v1/comics/tags/bulk'];
      expect(handler).toBeDefined();

      deps.dbGet.mockImplementation(async (sql, params) => {
        return {
          id: params[0],
          name: `Comic ${params[0]}`,
          path: `/path/to/${params[0]}.cbz`,
          series: 'Old Series',
          publisher: 'Old Pub',
          metadata: JSON.stringify({ OriginalField: 'val' })
        };
      });

      const req = {
        body: {
          comicIds: ['c1', 'c2'],
          fields: { Series: 'New Series', Publisher: 'DC Comics', Year: '2024' },
          storage: 'db'
        }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          total: 2,
          succeeded: 2,
          failed: 0
        })
      );
      expect(deps.dbRun).toHaveBeenCalledTimes(2);
    });

    it('should bulk tag comics with individual items array', async () => {
      const handler = routes['POST /api/v1/comics/tags/bulk'];
      expect(handler).toBeDefined();

      deps.dbGet.mockImplementation(async (sql, params) => {
        return {
          id: params[0],
          name: `Comic ${params[0]}`,
          path: `/path/to/${params[0]}.cbz`,
          metadata: '{}'
        };
      });

      const req = {
        body: {
          items: [
            { comicId: 'c1', fields: { Series: 'Series 1', Number: '1' }, storage: 'db' },
            { comicId: 'c2', fields: { Series: 'Series 2', Number: '2' }, storage: 'db' }
          ]
        }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          total: 2,
          succeeded: 2,
          failed: 0
        })
      );
    });
  });

  describe('Bulk Reading List Routes', () => {
    let router;
    let routes;
    let deps;

    beforeEach(() => {
      routes = {};
      router = {
        get: jest.fn((path, ...args) => { routes[`GET ${path}`] = args[args.length - 1]; }),
        post: jest.fn((path, ...args) => { routes[`POST ${path}`] = args[args.length - 1]; }),
        put: jest.fn((path, ...args) => { routes[`PUT ${path}`] = args[args.length - 1]; }),
        delete: jest.fn((path, ...args) => { routes[`DELETE ${path}`] = args[args.length - 1]; })
      };

      deps = {
        requireAuth: (req, res, next) => next(),
        dbGet: jest.fn(),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 }),
        dbAll: jest.fn().mockResolvedValue([]),
        createId: jest.fn((str) => `id-${str}`),
        formatErrorMessage: jest.fn((err) => err.message),
        validateComicId: jest.fn((id) => ({ valid: true, sanitized: id })),
        log: jest.fn()
      };

      attachReadingLists(router, deps);
    });

    it('should bulk create reading lists', async () => {
      const handler = routes['POST /api/v1/reading-lists/bulk'];
      expect(handler).toBeDefined();

      const req = {
        user: { userId: 'user-123', role: 'user' },
        body: {
          lists: [
            { name: 'List 1', description: 'Desc 1', comicIds: ['c1', 'c2'] },
            { name: 'List 2', description: 'Desc 2', comicIds: ['c3'] }
          ]
        }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          created: expect.arrayContaining([
            expect.objectContaining({ name: 'List 1', comicsAdded: 2 }),
            expect.objectContaining({ name: 'List 2', comicsAdded: 1 })
          ])
        })
      );
    });

    it('should bulk delete reading lists for user', async () => {
      const handler = routes['POST /api/v1/reading-lists/delete-bulk'];
      expect(handler).toBeDefined();

      deps.dbGet.mockImplementation(async (sql, params) => {
        if (params[0] === 'list-1' || params[0] === 'list-2') {
          return { id: params[0] };
        }
        return null;
      });

      const req = {
        user: { userId: 'user-123', role: 'user' },
        body: { listIds: ['list-1', 'list-2', 'list-99'] }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        deleted: ['list-1', 'list-2'],
        notFound: ['list-99']
      });
    });

    it('should bulk add comics across reading lists', async () => {
      const handler = routes['POST /api/v1/reading-lists/bulk-add-comics'];
      expect(handler).toBeDefined();

      deps.dbGet.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM reading_lists')) return { id: params[0] };
        if (sql.includes('MAX(sortOrder)')) return { maxOrder: 2 };
        return null;
      });

      const req = {
        user: { userId: 'user-123', role: 'user' },
        body: {
          listIds: ['list-1', 'list-2'],
          comicIds: ['c10', 'c11']
        }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          results: expect.arrayContaining([
            expect.objectContaining({ listId: 'list-1', ok: true, addedCount: 2 }),
            expect.objectContaining({ listId: 'list-2', ok: true, addedCount: 2 })
          ])
        })
      );
    });

    it('should bulk mark reading lists as read', async () => {
      const handler = routes['POST /api/v1/reading-lists/mark-read-bulk'];
      expect(handler).toBeDefined();

      deps.dbGet.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM reading_lists')) return { id: params[0] };
        if (sql.includes('FROM comics')) return { totalPages: 20 };
        return null;
      });
      deps.dbAll.mockResolvedValue([
        { comicId: 'c1' },
        { comicId: 'c2' }
      ]);

      const req = {
        user: { userId: 'user-123', role: 'user' },
        body: { listIds: ['list-1'], read: true }
      };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          results: expect.arrayContaining([
            expect.objectContaining({ listId: 'list-1', ok: true, comicsUpdated: 2 })
          ])
        })
      );
    });
  });
});
