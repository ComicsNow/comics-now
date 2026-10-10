const attachMetadataRoutes = require('../server/routes/user/metadata');

describe('User Metadata Routes - External Search', () => {
  let router;
  let deps;
  let externalSearchHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    router = {
      get: jest.fn((path, ...args) => {
        if (path === '/api/v1/search/external') {
          externalSearchHandler = args[args.length - 1];
        }
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };

    deps = {
      dbGet: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((err) => err.message),
      isPathSafe: jest.fn(() => true),
      resolvePath: jest.fn((p) => p),
      checkComicAccess: jest.fn(() => true),
      getComicsDirectories: jest.fn(() => ['/comics']),
      createId: jest.fn(() => '123'),
      getComicVineApiKey: jest.fn(() => 'cv-key'),
      cvFetchJson: jest.fn(),
      COMICVINE_API_URL: 'https://comicvine.gamespot.com/api',
      stripHtml: jest.fn((html) => html),
      normalizeCvId: jest.fn((id) => id)
    };
  });

  it('should forward search requests to Blackwells and Waterstones sidecar endpoint', async () => {
    attachMetadataRoutes(router, deps);

    // Mock global fetch
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        {
          title: 'Watchmen',
          series: 'Watchmen',
          number: '1',
          publisher: 'DC Comics',
          cover_image_url: 'http://image.jpg',
          source_url: 'http://source.jpg'
        }
      ])
    });
    global.fetch = mockFetch;

    const req = {
      query: {
        source: 'blackwells',
        query: 'Watchmen'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await externalSearchHandler(req, res);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'blackwells', query: 'Watchmen' })
      })
    );
    expect(res.json).toHaveBeenCalled();
  });

  it('should return exact title for comic info without stripping it', async () => {
    let comicInfoHandler;
    router.get.mockImplementation((path, ...args) => {
      if (path === '/api/v1/comics/info') {
        comicInfoHandler = args[args.length - 1];
      }
    });

    attachMetadataRoutes(router, deps);

    deps.dbGet.mockImplementation(async (sql) => {
      if (sql.includes('SELECT metadata FROM comics')) {
        return {
          metadata: JSON.stringify({
            Title: 'Batman #45',
            Series: 'Batman',
            Number: '45'
          })
        };
      }
      return null;
    });

    const b64Path = Buffer.from('/comics/Batman 45.cbz').toString('base64');
    const req = {
      query: { path: b64Path },
      user: { userId: 'admin', role: 'admin' }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await comicInfoHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        Title: 'Batman #45',
        Series: 'Batman',
        Number: '45'
      })
    );
  });
});

