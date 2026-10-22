const {
  fetchUrlAsMarkdown,
  buildUrlMetadataPrompt,
  extractMetadataFromUrl,
  isSafeWebUrl
} = require('../server/services/url-metadata-extractor');
const attachMetadataRoutes = require('../server/routes/user/metadata');

describe('URL Metadata Extractor Service & Route (TDD)', () => {
  describe('Service: url-metadata-extractor', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('SSRF Protection (isSafeWebUrl)', () => {
      test('permits legitimate public HTTP and HTTPS comic URLs', () => {
        expect(isSafeWebUrl('https://leagueofcomicgeeks.com/comic/12345/batman-1')).toBe(true);
        expect(isSafeWebUrl('http://comicvine.gamespot.com/batman/4000-12345/')).toBe(true);
        expect(isSafeWebUrl('https://marvel.fandom.com/wiki/Amazing_Spider-Man_Vol_1_1')).toBe(true);
      });

      test('rejects loopback and local hostnames', () => {
        expect(isSafeWebUrl('http://127.0.0.1/secret')).toBe(false);
        expect(isSafeWebUrl('http://127.0.0.1:3000/api/v1/comics')).toBe(false);
        expect(isSafeWebUrl('http://localhost/admin')).toBe(false);
        expect(isSafeWebUrl('http://localhost:8000/')).toBe(false);
        expect(isSafeWebUrl('http://sub.localhost/')).toBe(false);
        expect(isSafeWebUrl('http://0.0.0.0/')).toBe(false);
        expect(isSafeWebUrl('http://[::1]/')).toBe(false);
      });

      test('rejects cloud metadata link-local endpoints', () => {
        expect(isSafeWebUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(isSafeWebUrl('http://169.254.169.254:80/computeMetadata/v1/')).toBe(false);
      });

      test('rejects non-HTTP schemes and invalid URLs', () => {
        expect(isSafeWebUrl('file:///etc/passwd')).toBe(false);
        expect(isSafeWebUrl('ftp://ftp.example.com/dump')).toBe(false);
        expect(isSafeWebUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeWebUrl('not a url')).toBe(false);
        expect(isSafeWebUrl(null)).toBe(false);
        expect(isSafeWebUrl('')).toBe(false);
      });

      test('fetchUrlAsMarkdown rejects unsafe SSRF URLs without network calls', async () => {
        const fetchSpy = jest.fn();
        global.fetch = fetchSpy;

        await expect(fetchUrlAsMarkdown('http://169.254.169.254/latest/meta-data/'))
          .rejects.toThrow(/restricted URL/i);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    test('fetchUrlAsMarkdown requests clean Markdown from r.jina.ai', async () => {
      const mockMarkdown = '# Batman (2016) #1\n**Writer:** Tom King\n**Artist:** David Finch\n**Publisher:** DC Comics';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => mockMarkdown
      });

      const result = await fetchUrlAsMarkdown('https://leagueofcomicgeeks.com/comic/12345/batman-1');
      expect(result).toBe(mockMarkdown);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://r.jina.ai/https://leagueofcomicgeeks.com/comic/12345/batman-1',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/plain, text/markdown'
          })
        })
      );
    });

    test('buildUrlMetadataPrompt includes filename, markdown content, and publisher codex', () => {
      const prompt = buildUrlMetadataPrompt({
        url: 'https://dc.fandom.com/wiki/Batman_Vol_3_1',
        markdownContent: '# Batman #1\nGotham City is under attack...',
        filename: 'Batman 001 (2016).cbz',
        publisherCodex: ['DC Comics', 'Marvel', 'Image']
      });

      expect(prompt).toContain('Batman 001 (2016).cbz');
      expect(prompt).toContain('Gotham City is under attack');
      expect(prompt).toContain('DC Comics');
      expect(prompt).toContain('ComicInfo');
    });

    test('extractMetadataFromUrl parses Gemini response and normalizes canonical ComicInfo fields', async () => {
      const fakeGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    Series: 'Batman',
                    Number: '1',
                    Title: 'I Am Gotham Part 1',
                    Publisher: 'DC Comics',
                    Writer: 'Tom King',
                    Penciller: 'David Finch',
                    Inker: 'Matt Banning',
                    Colorist: 'Jordie Bellaire',
                    Letterer: 'John Workman',
                    CoverArtist: 'David Finch',
                    Summary: 'No one escapes Gotham intact.',
                    Year: 2016,
                    Month: 6,
                    CoverDate: '2016-06-15',
                    Characters: 'Batman, Duke Thomas, Commissioner Gordon',
                    Teams: 'Bat-Family',
                    StoryArc: 'I Am Gotham',
                    StoryArcNumber: '1'
                  })
                }
              ]
            }
          }
        ]
      };

      global.fetch = jest.fn()
        // 1st call: Jina reader fetch
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '# Batman #1 Reviews and Credits'
        })
        // 2nd call: Gemini generateContent
        .mockResolvedValueOnce({
          ok: true,
          json: async () => fakeGeminiResponse
        });

      const result = await extractMetadataFromUrl({
        url: 'https://leagueofcomicgeeks.com/comic/12345/batman-1',
        filename: 'Batman 001 (2016).cbz',
        publisherCodex: ['DC Comics', 'Marvel'],
        apiKey: 'test-gemini-key'
      });

      expect(result.Series).toBe('Batman');
      expect(result.Number).toBe('1');
      expect(result.Title).toBe('I Am Gotham Part 1');
      expect(result.Publisher).toBe('DC Comics');
      expect(result.Writer).toBe('Tom King');
      expect(result.Penciller).toBe('David Finch');
      expect(result.Characters).toContain('Batman');
      expect(result.Web).toBe('https://leagueofcomicgeeks.com/comic/12345/batman-1');
    });

    test('extractMetadataFromUrl clears Title if it is identical to Series (Redundant Title Rule)', async () => {
      const fakeGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    Series: 'Detective Comics',
                    Number: '27',
                    Title: 'Detective Comics',
                    Publisher: 'DC Comics'
                  })
                }
              ]
            }
          }
        ]
      };

      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => 'Detective Comics 27 text'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => fakeGeminiResponse
        });

      const result = await extractMetadataFromUrl({
        url: 'https://example.com/det27',
        filename: 'Detective Comics 027.cbz',
        apiKey: 'test-key'
      });

      expect(result.Series).toBe('Detective Comics');
      expect(result.Title).toBe('');
    });
  });

  describe('Route: POST /api/v1/metadata/extract-from-url', () => {
    let router;
    let deps;
    let extractHandler;

    beforeEach(() => {
      router = {
        get: jest.fn(),
        post: jest.fn((path, ...args) => {
          if (path === '/api/v1/metadata/extract-from-url') {
            extractHandler = args[args.length - 1];
          }
        })
      };

      deps = {
        dbGet: jest.fn().mockImplementation((sql) => {
          if (sql.includes("key = 'geminiApiKey'")) return { value: JSON.stringify('test-gemini-key') };
          if (sql.includes("key = 'geminiCoverDailyCap'")) return { value: '450' };
          if (sql.includes("key = '_ext_cover_reset'")) return { value: '2026-10-22' };
          if (sql.includes("key = '_ext_cover_requests'")) return { value: '5' };
          return null;
        }),
        dbRun: jest.fn().mockResolvedValue({ changes: 1 }),
        dbAll: jest.fn().mockResolvedValue([{ publisher: 'DC Comics' }, { publisher: 'Marvel' }]),
        log: jest.fn(),
        formatErrorMessage: jest.fn((e) => e.message),
        isPathSafe: jest.fn(() => true),
        resolvePath: jest.fn((p) => p),
        checkComicAccess: jest.fn(() => true),
        getComicsDirectories: jest.fn(() => ['/comics']),
        createId: jest.fn(() => '123'),
        getComicVineApiKey: jest.fn(() => 'cv-key'),
        cvFetchJson: jest.fn(),
        COMICVINE_API_URL: 'https://comicvine.gamespot.com/api',
        stripHtml: jest.fn((h) => h),
        normalizeCvId: jest.fn((id) => id)
      };

      attachMetadataRoutes(router, deps);
    });

    test('registers POST /api/v1/metadata/extract-from-url route', () => {
      expect(extractHandler).toBeDefined();
      expect(typeof extractHandler).toBe('function');
    });

    test('returns 400 if url is missing', async () => {
      const req = { body: {}, user: { userId: 'default-user', role: 'admin' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await extractHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/url is required/i) })
      );
    });

    test('returns 400 if url targets an unsafe SSRF target', async () => {
      const req = {
        body: { url: 'http://169.254.169.254/latest/meta-data/' },
        user: { userId: 'default-user', role: 'admin' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await extractHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/restricted URL target/i) })
      );
    });

    test('returns 400 if Gemini API key is missing', async () => {
      deps.dbGet.mockResolvedValueOnce(null); // no key in db
      const req = { body: { url: 'https://example.com/comic/1' }, user: { userId: 'default-user', role: 'admin' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await extractHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/gemini api key is not configured/i) })
      );
    });

    test('returns 200 with extracted metadata on successful extraction and increments quota count', async () => {
      const urlExtractorService = require('../server/services/url-metadata-extractor');
      const geminiQuota = require('../server/services/gemini-quota');
      const incrementSpy = jest.spyOn(geminiQuota, 'incrementDailyUsage');

      jest.spyOn(urlExtractorService, 'extractMetadataFromUrl').mockResolvedValueOnce({
        Series: 'Batman',
        Number: '1',
        Publisher: 'DC Comics',
        Writer: 'Tom King',
        Web: 'https://leagueofcomicgeeks.com/comic/123/batman-1'
      });

      const req = {
        body: {
          url: 'https://leagueofcomicgeeks.com/comic/123/batman-1',
          filename: 'Batman 001.cbz'
        },
        user: { userId: 'default-user', role: 'admin' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await extractHandler(req, res);
      expect(incrementSpy).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          metadata: expect.objectContaining({
            Series: 'Batman',
            Number: '1',
            Publisher: 'DC Comics'
          })
        })
      );
    });

    test('returns 429 when Gemini daily quota cap is reached', async () => {
      const geminiQuota = require('../server/services/gemini-quota');
      jest.spyOn(geminiQuota, 'incrementDailyUsage').mockResolvedValueOnce({
        allowed: false,
        count: 450
      });

      const req = {
        body: {
          url: 'https://leagueofcomicgeeks.com/comic/123/batman-1',
          filename: 'Batman 001.cbz'
        },
        user: { userId: 'default-user', role: 'admin' }
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await extractHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/Daily Gemini API request cap.*reached/i)
        })
      );
    });
  });

  describe('Frontend: Tag from URL UI Integration', () => {
    const fs = require('fs');
    const path = require('path');
    const vm = require('vm');
    const { JSDOM } = require('jsdom');

    function loadClientScript(filepath, sandbox) {
      const fileContent = fs.readFileSync(filepath, 'utf8');
      const cleanContent = fileContent
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/\bexport\s+/g, '')
        + '\nwindow.renderMetadataDisplay = renderMetadataDisplay;\nwindow.createUrlTaggerBox = createUrlTaggerBox;\n';
      const script = new vm.Script(cleanContent);
      vm.createContext(sandbox);
      script.runInContext(sandbox);
      return sandbox;
    }

    test('renders Tag from Web URL box for admin users', () => {
      const dom = new JSDOM('<!DOCTYPE html><html><body><form id="metadata-form"></form></body></html>');
      const document = dom.window.document;
      const form = document.getElementById('metadata-form');

      const sandbox = {
        window: {
          syncManager: { userRole: 'admin' },
          currentMetadata: {},
          metadataForm: form
        },
        document,
        console,
        state: {
          syncManager: { userRole: 'admin' },
          metadataHasUnsavedChanges: false,
          metadataForm: form
        },
        escapeHtml: (s) => String(s || '')
      };

      loadClientScript(path.join(__dirname, '../public/js/metadata.js'), sandbox);
      sandbox.window.renderMetadataDisplay({ Series: 'Batman', Number: '1' }, true);

      const tagContainer = form.querySelector('#tag-from-url-container');
      expect(tagContainer).not.toBeNull();

      const urlInput = form.querySelector('#tag-url-input');
      expect(urlInput).not.toBeNull();

      const extractBtn = form.querySelector('#tag-url-btn');
      expect(extractBtn).not.toBeNull();
      expect(extractBtn.textContent).toContain('Extract & Apply');
    });
  });
});
