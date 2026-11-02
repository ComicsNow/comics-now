const attachMetadataRoutes = require('../server/routes/user/metadata');
const geminiMetadataService = require('../server/services/gemini-metadata');

jest.mock('../server/services/gemini-metadata', () => ({
  synthesizeMetadataWithGemini: jest.fn(),
  STRICT_MODEL: 'gemini-3.5-flash-lite'
}));

describe('User Metadata Routes - POST /api/v1/metadata/synthesize', () => {
  let router;
  let deps;
  let synthesizeHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    router = {
      get: jest.fn(),
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/metadata/synthesize') {
          synthesizeHandler = args[args.length - 1];
        }
      }),
      put: jest.fn(),
      delete: jest.fn()
    };

    deps = {
      dbGet: jest.fn(),
      dbAll: jest.fn(),
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

  it('registers the POST /api/v1/metadata/synthesize route', () => {
    attachMetadataRoutes(router, deps);
    expect(synthesizeHandler).toBeDefined();
    expect(typeof synthesizeHandler).toBe('function');
  });

  it('rejects with 400 if sources array is missing or contains fewer than 2 items', async () => {
    attachMetadataRoutes(router, deps);

    const req = {
      body: { sources: [{ source: 'comicvine', title: 'Batman #1' }] },
      user: { userId: 'default-user', role: 'admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await synthesizeHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/at least 2 sources/i)
      })
    );
  });

  it('synthesizes deterministically without calling Gemini when Gemini API key is not configured', async () => {
    attachMetadataRoutes(router, deps);

    // Mock dbGet to return no geminiApiKey
    deps.dbGet.mockResolvedValue(null);
    deps.dbAll.mockResolvedValue([{ publisher: 'DC Comics' }]);

    const req = {
      body: {
        sources: [
          {
            source: 'comicvine',
            title: 'Batman #1',
            fullMetadata: {
              Series: 'Batman',
              Number: '1',
              Publisher: 'DC Comics',
              Writer: 'Scott Snyder',
              Summary: 'Short summary.'
            }
          },
          {
            source: 'metron',
            title: 'Batman (2011) #1',
            fullMetadata: {
              Series: 'Batman',
              Title: 'The Court of Owls',
              Number: '1',
              Penciller: 'Greg Capullo',
              Colorist: 'FCO Plascencia',
              Characters: 'Bruce Wayne, Dick Grayson',
              Summary: 'Batman investigates a brutal murder in Gotham City that points to an ancient conspiracy known as the Court of Owls.'
            }
          }
        ]
      },
      user: { userId: 'default-user', role: 'admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await synthesizeHandler(req, res);
    expect(geminiMetadataService.synthesizeMetadataWithGemini).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        mode: 'deterministic',
        metadata: expect.objectContaining({
          Series: 'Batman',
          Title: 'The Court of Owls',
          Number: '1',
          Publisher: 'DC Comics',
          Writer: 'Scott Snyder',
          Penciller: 'Greg Capullo',
          Colorist: 'FCO Plascencia',
          Characters: 'Bruce Wayne, Dick Grayson'
        })
      })
    );
  });

  it('synthesizes deterministically across staged sources and does not call Gemini when geminiCoverMatchEnabled is false in settings', async () => {
    attachMetadataRoutes(router, deps);

    deps.dbGet.mockImplementation(async (sql) => {
      if (sql.includes('geminiApiKey')) return { value: JSON.stringify('test-gemini-key') };
      if (sql.includes('geminiCoverMatchEnabled')) return { value: 'false' };
      return null;
    });
    deps.dbAll.mockResolvedValue([{ publisher: 'DC Comics' }]);

    const req = {
      body: {
        sources: [
          {
            source: 'comicvine',
            name: 'Absolute Batman #1',
            fullMetadata: {
              Series: 'Absolute Batman',
              Number: '1',
              Publisher: 'DC',
              Writer: 'Scott Snyder',
              CoverDate: '2024-10-09',
              Characters: 'Batman'
            }
          },
          {
            source: 'lcg',
            name: 'Absolute Batman #1',
            fullMetadata: {
              Series: 'Absolute Batman',
              Title: 'The Zoo',
              Number: '1',
              Penciller: 'Nick Dragotta',
              Colorist: 'Frank Martin',
              Characters: 'Alfred Pennyworth, Black Mask',
              Summary: 'Without the mansion, without the money, without the butler... what is left is the Absolute Dark Knight!'
            }
          }
        ]
      },
      user: { userId: 'default-user', role: 'admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await synthesizeHandler(req, res);
    expect(geminiMetadataService.synthesizeMetadataWithGemini).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        mode: 'deterministic',
        metadata: expect.objectContaining({
          Series: 'Absolute Batman',
          Title: 'The Zoo',
          Number: '1',
          Publisher: 'DC Comics',
          Writer: 'Scott Snyder',
          Penciller: 'Nick Dragotta',
          Colorist: 'Frank Martin',
          Characters: 'Batman, Alfred Pennyworth, Black Mask'
        })
      })
    );
  });

  it('synthesizes metadata across multiple staged sources using Gemini Flash and returns normalized result', async () => {
    attachMetadataRoutes(router, deps);

    // Mock settings lookup for apiKey and model
    deps.dbGet.mockImplementation(async (sql) => {
      if (sql.includes('geminiApiKey')) return { value: JSON.stringify('test-gemini-key') };
      if (sql.includes('geminiModel')) return { value: JSON.stringify('gemini-3.5-flash-lite') };
      return null;
    });

    // Mock publisher codex lookup
    deps.dbAll.mockResolvedValue([
      { publisher: 'DC Comics' },
      { publisher: 'Marvel' }
    ]);

    const mockSynthesized = {
      Series: 'Batman',
      Title: 'The Court of Owls',
      Number: '1',
      Publisher: 'DC Comics',
      Writer: 'Scott Snyder',
      Penciller: 'Greg Capullo',
      Summary: 'Batman investigates a brutal murder in Gotham City.'
    };
    geminiMetadataService.synthesizeMetadataWithGemini.mockResolvedValue(mockSynthesized);

    const stagedSources = [
      {
        source: 'comicvine',
        name: 'Batman #1',
        volumeName: 'Batman',
        issueNumber: '1',
        publisher: 'DC Comics',
        fullMetadata: {
          Series: 'Batman',
          Number: '1',
          Publisher: 'DC Comics',
          Writer: 'Scott Snyder',
          Summary: 'Batman investigates a brutal murder.'
        }
      },
      {
        source: 'metron',
        name: 'Batman #1',
        volumeName: 'Batman (2011)',
        issueNumber: '1',
        publisher: 'DC',
        fullMetadata: {
          Series: 'Batman',
          Title: 'The Court of Owls',
          Number: '1',
          Penciller: 'Greg Capullo',
          StoryArc: 'Court of Owls'
        }
      }
    ];

    const req = {
      body: {
        sources: stagedSources,
        filename: 'Batman 001 (2011).cbz',
        existingMeta: { Series: 'Batman' }
      },
      user: { userId: 'default-user', role: 'admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await synthesizeHandler(req, res);

    expect(geminiMetadataService.synthesizeMetadataWithGemini).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-gemini-key',
        model: 'gemini-3.5-flash-lite',
        filename: 'Batman 001 (2011).cbz',
        publisherCodex: ['DC Comics', 'Marvel'],
        allCandidates: expect.arrayContaining([
          expect.objectContaining({ source: 'comicvine' }),
          expect.objectContaining({ source: 'metron' })
        ])
      })
    );

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        metadata: mockSynthesized
      })
    );
  });

  it('filters out redundant lowercase and snake_case duplicate keys from synthesized response', async () => {
    attachMetadataRoutes(router, deps);

    deps.dbGet.mockImplementation(async (sql) => {
      if (sql.includes('geminiApiKey')) return { value: JSON.stringify('test-gemini-key') };
      return null;
    });

    // Mock dual-cased output like server/services/gemini-metadata.js returns
    const dualCasedOutput = {
      Series: 'The Phantom Stranger Omnibus',
      Title: '',
      Number: '1',
      Publisher: 'DC Comics',
      Writer: 'John Broome',
      Summary: 'The greatest adventures.',
      Year: '2023',
      Month: '8',
      Day: '29',
      CoverDate: '2023-08',
      // Redundant lowercase/snake_case duplicates:
      series: 'The Phantom Stranger Omnibus',
      title: '',
      number: '1',
      issue: '1',
      issue_number: '1',
      issue_title: '',
      publisher: 'DC Comics',
      writer: 'John Broome',
      description: 'The greatest adventures.',
      summary: 'The greatest adventures.',
      year: '2023',
      month: '8',
      day: '29',
      cover_date: '2023-08',
      publish_date: '2023-08'
    };
    geminiMetadataService.synthesizeMetadataWithGemini.mockResolvedValue(dualCasedOutput);

    const req = {
      body: {
        sources: [
          { source: 'comicvine', title: 'Phantom Stranger #1' },
          { source: 'metron', title: 'Phantom Stranger Omnibus' }
        ],
        filename: 'The Phantom Stranger Omnibus.cbz'
      },
      user: { userId: 'default-user', role: 'admin' }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await synthesizeHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        metadata: expect.objectContaining({
          Series: 'The Phantom Stranger Omnibus',
          Number: '1',
          Publisher: 'DC Comics',
          Writer: 'John Broome'
        })
      })
    );

    const returnedMetadata = res.json.mock.calls[0][0].metadata;
    // None of the lowercase duplicate keys should be present
    expect(returnedMetadata.series).toBeUndefined();
    expect(returnedMetadata.title).toBeUndefined();
    expect(returnedMetadata.number).toBeUndefined();
    expect(returnedMetadata.issue).toBeUndefined();
    expect(returnedMetadata.issue_number).toBeUndefined();
    expect(returnedMetadata.publisher).toBeUndefined();
    expect(returnedMetadata.writer).toBeUndefined();
    expect(returnedMetadata.description).toBeUndefined();
    expect(returnedMetadata.summary).toBeUndefined();
    expect(returnedMetadata.cover_date).toBeUndefined();
    expect(returnedMetadata.publish_date).toBeUndefined();
  });
});
