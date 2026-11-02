const attachLibraryRoutes = require('../../../../server/routes/user/library');

describe('server/routes/user/library routes and access control', () => {
  let router;
  let routes;
  let mockDeps;
  let mockDbAll;
  let mockDbGet;
  let mockBuildLibrary;
  let mockGetComicsDirectories;
  let mockCheckComicAccess;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    routes = {};
    router = {
      get: jest.fn((path, ...middlewares) => {
        routes[`GET ${path}`] = middlewares[middlewares.length - 1];
      })
    };

    mockDbAll = jest.fn().mockResolvedValue([]);
    mockDbGet = jest.fn().mockResolvedValue({ role: 'user' });
    mockBuildLibrary = jest.fn().mockResolvedValue({ publishers: [] });
    mockGetComicsDirectories = jest.fn().mockReturnValue(['/media/comics']);
    mockCheckComicAccess = jest.fn().mockResolvedValue(true);

    mockDeps = {
      log: jest.fn(),
      dbGet: mockDbGet,
      dbAll: mockDbAll,
      formatErrorMessage: (e, req, fallback) => fallback,
      buildLibrary: mockBuildLibrary,
      getComicsDirectories: mockGetComicsDirectories,
      getLibraryIdFromPath: jest.fn(p => 'Library'),
      resolvePath: jest.fn(p => p),
      generateVirtualMetadata: jest.fn((p, r) => ({ Publisher: 'DC', Series: 'Batman' })),
      checkComicAccess: mockCheckComicAccess,
      getReadingPrefMaps: jest.fn().mockResolvedValue({}),
      resolveReadingModes: jest.fn().mockReturnValue({ mangaMode: false, continuousMode: false }),
      validateSearchQuery: jest.fn(q => ({ valid: true, sanitized: q })),
      requireAuth: (req, res, next) => next()
    };

    mockReq = {
      query: {},
      params: {},
      user: { userId: 'test-user', role: 'user' }
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    attachLibraryRoutes(router, mockDeps);
  });

  describe('GET /api/v1/comics', () => {
    it('returns built library for user', async () => {
      mockBuildLibrary.mockResolvedValueOnce({ publishers: [{ name: 'DC' }] });
      await routes['GET /api/v1/comics'](mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({ publishers: [{ name: 'DC' }] });
      expect(mockBuildLibrary).toHaveBeenCalledWith('test-user');
    });

    it('handles errors gracefully by returning empty object', async () => {
      mockBuildLibrary.mockRejectedValueOnce(new Error('DB failure'));
      await routes['GET /api/v1/comics'](mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({});
      expect(mockDeps.log).toHaveBeenCalledWith('ERROR', 'LIST', expect.stringContaining('Failed to list library'));
    });
  });

  describe('GET /api/v1/search', () => {
    it('rejects invalid search queries with 400', async () => {
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: false, error: 'Bad query' });
      mockReq.query = { query: 'bad***' };
      await routes['GET /api/v1/search'](mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Bad query' });
    });

    it('returns empty list if search query is empty', async () => {
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: '' });
      mockReq.query = { query: '' };
      await routes['GET /api/v1/search'](mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith([]);
    });

    it('filters search results through access control', async () => {
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'batman' });
      mockReq.query = { query: 'batman' };
      mockDbAll
        .mockResolvedValueOnce([   // comics search results
          { id: '1', name: 'Batman 01.cbz', path: '/media/comics/DC/Batman/01.cbz', publisher: 'DC', series: 'Batman' },
          { id: '2', name: 'Secret 01.cbz', path: '/media/comics/Secret/01.cbz', publisher: 'Secret', series: 'Secret' }
        ])
        .mockResolvedValueOnce([]); // user access list

      mockCheckComicAccess
        .mockResolvedValueOnce(true)   // id: 1 has access
        .mockResolvedValueOnce(false);  // id: 2 no access

      await routes['GET /api/v1/search'](mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: '1', name: 'Batman 01.cbz' })
        ])
      );
      const results = mockRes.json.mock.calls[0][0];
      expect(results.length).toBe(1);
    });
  });

  describe('GET /api/v1/folders/:path(*)?', () => {
    it('returns root directories when path is root or empty', async () => {
      mockReq.params = { path: 'root' };
      await routes['GET /api/v1/folders/:path(*)?'](mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          path: 'root',
          folders: expect.any(Array)
        })
      );
    });

    it('rejects unsafe paths with 403', async () => {
      const encoded = Buffer.from('/etc/shadow').toString('base64');
      mockReq.params = { path: encoded };
      await routes['GET /api/v1/folders/:path(*)?'](mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, message: 'Access denied' }));
    });
  });
});
