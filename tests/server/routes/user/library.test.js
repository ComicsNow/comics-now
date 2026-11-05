const fs = require('fs');
const os = require('os');
const path = require('path');
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
      getAllowedFormats: jest.fn(() => 'cbz'),
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

    it('filters search results by specific field (title, series, publisher, character)', async () => {
      const sampleRows = [
        {
          id: '1',
          name: 'Batman 001.cbz',
          path: '/media/comics/DC/Batman/01.cbz',
          publisher: 'DC Comics',
          series: 'Batman',
          metadata: JSON.stringify({ Title: 'The Court of Owls', Series: 'Batman', Publisher: 'DC Comics', Characters: 'Bruce Wayne, Nightwing', Summary: 'A Gotham story.' })
        },
        {
          id: '2',
          name: 'Jackpot 001.cbz',
          path: '/media/comics/Indie/Jackpot/01.cbz',
          publisher: 'Image',
          series: 'Jackpot',
          metadata: JSON.stringify({ Title: 'Lucky Strike', Series: 'Jackpot', Publisher: 'Image', Characters: 'Jackpot', Summary: 'Reads like Batman meets Ocean Eleven.' })
        },
        {
          id: '3',
          name: 'Detective Comics 1000.cbz',
          path: '/media/comics/DC/Detective/1000.cbz',
          publisher: 'DC Comics',
          series: 'Detective Comics',
          metadata: JSON.stringify({ Title: 'Medieval', Series: 'Detective Comics', Publisher: 'DC Comics', Characters: 'Batman, Joker', Summary: 'Anniversary issue.' })
        }
      ];

      // 1) field = 'character' with query 'batman' -> only Detective Comics 1000 (where Characters has Batman)
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'batman' });
      mockReq.query = { query: 'batman', field: 'character' };
      mockDbAll.mockResolvedValueOnce(sampleRows).mockResolvedValueOnce([]);
      await routes['GET /api/v1/search'](mockReq, mockRes);
      let results = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
      expect(results.map(r => r.id)).toEqual(['3']);

      // 2) field = 'series' with query 'batman' -> only Batman 001
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'batman' });
      mockReq.query = { query: 'batman', field: 'series' };
      mockDbAll.mockResolvedValueOnce(sampleRows).mockResolvedValueOnce([]);
      await routes['GET /api/v1/search'](mockReq, mockRes);
      results = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
      expect(results.map(r => r.id)).toEqual(['1']);

      // 3) field = 'title' with query 'court of owls' -> only Batman 001
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'court of owls' });
      mockReq.query = { query: 'court of owls', field: 'title' };
      mockDbAll.mockResolvedValueOnce(sampleRows).mockResolvedValueOnce([]);
      await routes['GET /api/v1/search'](mockReq, mockRes);
      results = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
      expect(results.map(r => r.id)).toEqual(['1']);

      // 4) field = 'publisher' with query 'image' -> only Jackpot 001
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'image' });
      mockReq.query = { query: 'image', field: 'publisher' };
      mockDbAll.mockResolvedValueOnce(sampleRows).mockResolvedValueOnce([]);
      await routes['GET /api/v1/search'](mockReq, mockRes);
      results = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
      expect(results.map(r => r.id)).toEqual(['2']);
    });

    it('sorts search results by relevance (exact series/title > prefix > word match > character > summary mention)', async () => {
      // Simulate SQLite returning rows in insertion order where Jackpot and Jimmy's Little Bastards come first
      const unorderedRows = [
        {
          id: 'jackpot-1',
          name: 'Jackpot 001.cbz',
          path: '/media/comics/AfterShock/Jackpot/01.cbz',
          publisher: 'AfterShock',
          series: 'Jackpot',
          metadata: JSON.stringify({ Title: 'Jackpot #1', Series: 'Jackpot', Number: '1', Summary: 'For fans of Batman and heist movies.' })
        },
        {
          id: 'jimmys-1',
          name: "Jimmy's Little Bastards 001.cbz",
          path: '/media/comics/AfterShock/Jimmys/01.cbz',
          publisher: 'AfterShock',
          series: "Jimmy's Little Bastards",
          metadata: JSON.stringify({ Title: "Jimmy's Little Bastards #1", Series: "Jimmy's Little Bastards", Number: '1', Summary: 'Written by Garth Ennis, who also wrote Batman: Reptilian.' })
        },
        {
          id: 'jl-1',
          name: 'Justice League 001.cbz',
          path: '/media/comics/DC/JL/01.cbz',
          publisher: 'DC Comics',
          series: 'Justice League',
          metadata: JSON.stringify({ Title: 'The Totality', Series: 'Justice League', Number: '1', Characters: 'Superman, Batman, Wonder Woman' })
        },
        {
          id: 'abs-batman-1',
          name: 'Absolute Batman 001.cbz',
          path: '/media/comics/DC/Absolute Batman/01.cbz',
          publisher: 'DC Comics',
          series: 'Absolute Batman',
          metadata: JSON.stringify({ Title: 'The Zoo', Series: 'Absolute Batman', Number: '1', Characters: 'Batman' })
        },
        {
          id: 'batman-gargoyle-1',
          name: 'Batman Gargoyle of Gotham 001.cbz',
          path: '/media/comics/DC/Batman Gargoyle/01.cbz',
          publisher: 'DC Comics',
          series: 'Batman: Gargoyle of Gotham',
          metadata: JSON.stringify({ Title: 'Book One', Series: 'Batman: Gargoyle of Gotham', Number: '1', Characters: 'Batman' })
        },
        {
          id: 'batman-2',
          name: 'Batman 002.cbz',
          path: '/media/comics/DC/Batman/02.cbz',
          publisher: 'DC Comics',
          series: 'Batman',
          metadata: JSON.stringify({ Title: 'Trust Fall', Series: 'Batman', Number: '2', Characters: 'Batman' })
        },
        {
          id: 'batman-1',
          name: 'Batman 001.cbz',
          path: '/media/comics/DC/Batman/01.cbz',
          publisher: 'DC Comics',
          series: 'Batman',
          metadata: JSON.stringify({ Title: 'Knife Trick', Series: 'Batman', Number: '1', Characters: 'Batman' })
        }
      ];

      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'batman' });
      mockReq.query = { query: 'batman', field: 'all' };
      mockDbAll.mockResolvedValueOnce(unorderedRows).mockResolvedValueOnce([]);

      await routes['GET /api/v1/search'](mockReq, mockRes);
      const results = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];

      expect(results.map(r => r.id)).toEqual([
        'batman-1',
        'batman-2',
        'batman-gargoyle-1',
        'abs-batman-1',
        'jl-1',
        'jackpot-1',
        'jimmys-1'
      ]);
    });

    it('hides rows whose format is not allowed by the settings', async () => {
      mockDeps.validateSearchQuery.mockReturnValueOnce({ valid: true, sanitized: 'green hornet' });
      mockReq.query = { query: 'green hornet' };
      mockDbAll
        .mockResolvedValueOnce([
          { id: 'cbz-1', name: 'mock-comic-001.cbz', path: '/media/comics/mock-comic-001.cbz', publisher: 'DC', series: 'Green Hornet', metadata: '{}' },
          { id: 'cbr-1', name: 'mock-comic-002.cbr', path: '/media/comics/mock-comic-002.cbr', publisher: 'DC', series: 'Green Hornet', metadata: '{}' }
        ])
        .mockResolvedValueOnce([]);

      await routes['GET /api/v1/search'](mockReq, mockRes);

      const results = mockRes.json.mock.calls[0][0];
      expect(results.map(r => r.id)).toEqual(['cbz-1']);
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

    it('hides file entries whose format is not allowed by the settings', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-formats-'));
      try {
        fs.writeFileSync(path.join(dir, 'mock-comic-001.cbz'), 'synthetic');
        fs.writeFileSync(path.join(dir, 'mock-comic-002.cbr'), 'synthetic');

        mockGetComicsDirectories.mockReturnValue([dir]);
        mockReq.user = { userId: 'test-admin', role: 'admin' };
        mockReq.params = { path: Buffer.from(dir).toString('base64') };

        await routes['GET /api/v1/folders/:path(*)?'](mockReq, mockRes);
        let payload = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
        expect(payload.comics.map(c => c.name)).toEqual(['mock-comic-001.cbz']);

        mockDeps.getAllowedFormats.mockReturnValue('both');
        await routes['GET /api/v1/folders/:path(*)?'](mockReq, mockRes);
        payload = mockRes.json.mock.calls[mockRes.json.mock.calls.length - 1][0];
        expect(payload.comics.map(c => c.name).sort()).toEqual([
          'mock-comic-001.cbz',
          'mock-comic-002.cbr'
        ]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
