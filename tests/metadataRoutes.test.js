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

  it('should cross-enrich GCD results with ComicVine cover when GCD cover points to comics.org', async () => {
    attachMetadataRoutes(router, deps);

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        {
          title: 'Spawn #1',
          series: 'Spawn',
          number: '1',
          publisher: 'Image Comics',
          cover_image_url: 'https://files1.comics.org/img/gcd/covers_by_id/1/w400/123.jpg',
          source: 'gcd'
        }
      ])
    });
    global.fetch = mockFetch;

    deps.cvFetchJson.mockResolvedValue({
      results: [
        {
          volume: { name: 'Spawn' },
          issue_number: '1',
          image: {
            thumb_url: 'https://comicvine.gamespot.com/spawn1_thumb.jpg',
            medium_url: 'https://comicvine.gamespot.com/spawn1_medium.jpg'
          }
        }
      ]
    });

    const req = {
      query: {
        source: 'gcd',
        query: 'Spawn #1'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await externalSearchHandler(req, res);

    expect(res.json).toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0];
    expect(responseData.results[0].image.medium_url).toBe('https://comicvine.gamespot.com/spawn1_medium.jpg');
    expect(responseData.results[0].image.thumb_url).not.toContain('comics.org');
  });

  it('should dynamically proxy ComicVine cover when proxy/cover targets comics.org', async () => {
    let proxyCoverHandler;
    router.get.mockImplementation((path, ...args) => {
      if (path === '/api/v1/proxy/cover') {
        proxyCoverHandler = args[args.length - 1];
      }
    });

    attachMetadataRoutes(router, deps);

    deps.cvFetchJson.mockResolvedValue({
      results: [
        {
          volume: { name: 'Spawn' },
          issue_number: '1',
          image: {
            medium_url: 'https://comicvine.gamespot.com/spawn1_medium.jpg'
          }
        }
      ]
    });

    const mockImageBuffer = Buffer.from('fake-jpeg-image-bytes-data-more-than-100-bytes-12345678901234567890123456789012345678901234567890123456789012345678901234567890');
    const mockFetch = jest.fn().mockImplementation((url) => {
      if (url.includes('comicvine.gamespot.com')) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
        });
      }
      return Promise.resolve({ ok: false });
    });
    global.fetch = mockFetch;

    const req = {
      query: {
        url: 'https://files1.comics.org/img/gcd/covers_by_id/1/w400/123.jpg',
        series: 'Spawn',
        issue: '1'
      }
    };
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn()
    };

    await proxyCoverHandler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('should sanitize metadata in /api/v1/search/external', async () => {
    attachMetadataRoutes(router, deps);

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        {
          title: 'Batman #1',
          series: 'Batman #1 - TPB',
          number: '',
          publisher: 'DC Comics',
          cover_image_url: 'http://image.jpg'
        }
      ])
    });
    global.fetch = mockFetch;

    const req = {
      query: { source: 'all', query: 'Batman' }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await externalSearchHandler(req, res);

    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    const results = body.results;
    expect(results[0].fullMetadata.Series).toBe('Batman');
    expect(results[0].fullMetadata.Title).toBe('');
    expect(results[0].fullMetadata.Number).toBe('1');
    expect(results[0].volumeName).toBe('Batman');
    expect(results[0].issueNumber).toBe('1');
  });

  it('should sanitize metadata in /api/v1/comicvine/issue/:id', async () => {
    let issueHandler;
    router.get.mockImplementation((path, ...args) => {
      if (path === '/api/v1/comicvine/issue/:id') {
        issueHandler = args[args.length - 1];
      }
    });

    attachMetadataRoutes(router, deps);

    deps.cvFetchJson.mockResolvedValueOnce({
      results: {
        name: 'Batman #1',
        issue_number: '1',
        description: 'First issue',
        volume: { name: 'Batman (TPB)' },
        publisher: { name: 'DC Comics' }
      }
    });

    const req = { params: { id: '12345' } };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await issueHandler(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.Series).toBe('Batman');
    expect(data.Title).toBe('');
    expect(data.Number).toBe('1');
  });

  it('should sanitize metadata in /api/v1/comicvine/volume/:id', async () => {
    let volumeHandler;
    router.get.mockImplementation((path, ...args) => {
      if (path === '/api/v1/comicvine/volume/:id') {
        volumeHandler = args[args.length - 1];
      }
    });

    attachMetadataRoutes(router, deps);

    deps.cvFetchJson.mockResolvedValueOnce({
      results: {
        name: 'Batman: The Court of Owls - TPB',
        description: 'A great collection',
        publisher: { name: 'DC Comics' },
        start_year: '2012',
        count_of_issues: 7
      }
    });

    const req = { params: { id: '67890' } };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await volumeHandler(req, res);

    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    expect(data.Series).toBe('Batman: The Court of Owls');
    expect(data.Title).toBe('');
  });
});


