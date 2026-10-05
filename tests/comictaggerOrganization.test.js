const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DEFAULT_NAMING_RULES,
  DEFAULT_FOLDER_RULES,
  formatComicFilename,
  formatFolderPath,
  generateVirtualMetadataFromHierarchy,
  updateComicIdentity
} = require('../server/services/organization');

describe('Tag Comics Now! Naming & Folder Organization Services', () => {
  describe('formatComicFilename', () => {
    const sampleMetadata = {
      Series: 'Animal Castle',
      Title: 'Winter of the Animals',
      Publisher: 'Ablaze',
      Year: '2022',
      Number: '2',
      PageCount: 32,
      Writer: 'Xavier Dorison',
      Volume: '1'
    };

    test('formats filename correctly with default tokens', () => {
      const filename = formatComicFilename(sampleMetadata, DEFAULT_NAMING_RULES, '.cbz');
      expect(filename).toBe('02 Animal Castle - Winter of the Animals [Ablaze] (2022) #32.cbz');
    });

    test('reorders tokens according to custom configuration', () => {
      const customRules = {
        tokens: [
          { id: 'publisher', enabled: true, mandatory: true },
          { id: 'series', enabled: true, mandatory: true },
          { id: 'number', enabled: true, mandatory: false },
          { id: 'year', enabled: true, mandatory: false }
        ]
      };
      const filename = formatComicFilename(sampleMetadata, customRules, '.cbz');
      expect(filename).toBe('[Ablaze] Animal Castle 02 (2022).cbz');
    });

    test('omits disabled tokens from filename', () => {
      const customRules = {
        tokens: [
          { id: 'series', enabled: true, mandatory: true },
          { id: 'number', enabled: true, mandatory: false },
          { id: 'title', enabled: false, mandatory: false },
          { id: 'pages', enabled: false, mandatory: false },
          { id: 'publisher', enabled: false, mandatory: false },
          { id: 'year', enabled: false, mandatory: false }
        ]
      };
      const filename = formatComicFilename(sampleMetadata, customRules, '.cbz');
      expect(filename).toBe('Animal Castle 02.cbz');
    });

    test('throws or returns error when mandatory token is missing', () => {
      const incompleteMetadata = {
        Series: 'Animal Castle',
        Publisher: 'Ablaze'
        // Missing Year
      };
      const rules = {
        tokens: [
          { id: 'series', enabled: true, mandatory: true },
          { id: 'publisher', enabled: true, mandatory: true },
          { id: 'year', enabled: true, mandatory: true }
        ]
      };
      expect(() => {
        formatComicFilename(incompleteMetadata, rules, '.cbz');
      }).toThrow(/Missing mandatory field: year/i);
    });

    test('sanitizes illegal path characters (slashes, colons)', () => {
      const messyMetadata = {
        Series: 'Batman/Superman: World\'s Finest',
        Publisher: 'DC Comics',
        Year: '2023',
        Number: '1'
      };
      const rules = {
        tokens: [
          { id: 'series', enabled: true, mandatory: true },
          { id: 'publisher', enabled: true, mandatory: false }
        ]
      };
      const filename = formatComicFilename(messyMetadata, rules, '.cbz');
      expect(filename).not.toContain('/');
      expect(filename).toBe('Batman-Superman: World\'s Finest [DC Comics].cbz');
    });
  });

  describe('formatFolderPath', () => {
    const sampleMetadata = {
      Publisher: 'Ablaze Publishing',
      Writer: 'Xavier Dorison',
      Series: 'Animal Castle',
      Volume: '1',
      Year: '2022'
    };

    test('formats default 2-level folder hierarchy (publisher/series)', () => {
      const folderPath = formatFolderPath(sampleMetadata, DEFAULT_FOLDER_RULES);
      expect(folderPath).toBe(path.join('Ablaze Publishing', 'Animal Castle'));
    });

    test('formats 3-level folder hierarchy (publisher/writer/series)', () => {
      const customRules = {
        hierarchy: ['publisher', 'writer', 'series']
      };
      const folderPath = formatFolderPath(sampleMetadata, customRules);
      expect(folderPath).toBe(path.join('Ablaze Publishing', 'Xavier Dorison', 'Animal Castle'));
    });

    test('formats 1-level folder hierarchy (series only)', () => {
      const customRules = {
        hierarchy: ['series']
      };
      const folderPath = formatFolderPath(sampleMetadata, customRules);
      expect(folderPath).toBe('Animal Castle');
    });

    test('uses safe defaults when metadata values are missing', () => {
      const customRules = {
        hierarchy: ['publisher', 'writer', 'series']
      };
      const folderPath = formatFolderPath({}, customRules);
      expect(folderPath).toBe(path.join('Unknown Publisher', 'Unknown Writer', 'Unknown Series'));
    });
  });

  describe('generateVirtualMetadataFromHierarchy', () => {
    test('extracts metadata for 3-level hierarchy (publisher/writer/series)', () => {
      const libraryRoot = '/comics';
      const filePath = '/comics/Ablaze/Xavier Dorison/Animal Castle/issue_01.cbz';
      const folderRules = {
        hierarchy: ['publisher', 'writer', 'series']
      };

      const meta = generateVirtualMetadataFromHierarchy(filePath, libraryRoot, folderRules);
      expect(meta.Publisher).toBe('Ablaze');
      expect(meta.Writer).toBe('Xavier Dorison');
      expect(meta.Series).toBe('Animal Castle');
      expect(meta.Number).toBe('1');
    });

    test('gracefully handles fewer directory levels than hierarchy', () => {
      const libraryRoot = '/comics';
      const filePath = '/comics/Animal Castle/issue_02.cbz';
      const folderRules = {
        hierarchy: ['publisher', 'writer', 'series']
      };

      const meta = generateVirtualMetadataFromHierarchy(filePath, libraryRoot, folderRules);
      // With only 1 directory level, it should map to series or root gracefully without crashing
      expect(meta.Series).toBe('Animal Castle');
      expect(meta.Number).toBe('2');
    });
  });

  describe('updateComicIdentity (Move & Rename sidecar & cover link integrity)', () => {
    let tmpDir;
    let oldComicPath;
    let oldSidecarPath;
    let oldThumbPath;
    let oldGvPath;
    let thumbnailsDir;
    let guidedViewDir;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-mgmt-test-'));
      const comicsDir = path.join(tmpDir, 'comics');
      thumbnailsDir = path.join(tmpDir, 'thumbnails');
      guidedViewDir = path.join(tmpDir, 'metadata', 'guided_view');

      fs.mkdirSync(comicsDir, { recursive: true });
      fs.mkdirSync(thumbnailsDir, { recursive: true });
      fs.mkdirSync(guidedViewDir, { recursive: true });

      oldComicPath = path.join(comicsDir, 'OldComic.cbz');
      oldSidecarPath = path.join(comicsDir, 'OldComic.ComicInfo.xml');
      fs.writeFileSync(oldComicPath, 'dummy cbz content');
      fs.writeFileSync(oldSidecarPath, '<ComicInfo><Series>Old</Series></ComicInfo>');

      oldThumbPath = path.join(thumbnailsDir, 'old-id-123.jpg');
      fs.writeFileSync(oldThumbPath, 'dummy jpg content');

      oldGvPath = path.join(guidedViewDir, 'old-id-123.json');
      fs.writeFileSync(oldGvPath, JSON.stringify({ pages: {} }));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    });

    test('moves comic, sidecar ComicInfo.xml, renames thumbnail and guided view sidecar, and updates DB', async () => {
      const newDir = path.join(tmpDir, 'comics', 'Ablaze', 'Animal Castle');
      fs.mkdirSync(newDir, { recursive: true });
      const newComicPath = path.join(newDir, '02 Animal Castle [Ablaze] (2022).cbz');
      const oldId = 'old-id-123';
      const newId = 'new-id-456';
      const newName = '02 Animal Castle [Ablaze] (2022).cbz';

      const mockDbRun = jest.fn().mockResolvedValue({ changes: 1 });

      await updateComicIdentity({
        dbRun: mockDbRun,
        oldId,
        newId,
        oldPath: oldComicPath,
        newPath: newComicPath,
        newName,
        thumbnailsDir,
        guidedViewDir
      });

      // Check comic moved
      expect(fs.existsSync(oldComicPath)).toBe(false);
      expect(fs.existsSync(newComicPath)).toBe(true);

      // Check sidecar moved and renamed to match new comic basename
      const newSidecarPath = path.join(newDir, '02 Animal Castle [Ablaze] (2022).ComicInfo.xml');
      expect(fs.existsSync(oldSidecarPath)).toBe(false);
      expect(fs.existsSync(newSidecarPath)).toBe(true);

      // Check thumbnail renamed
      const newThumbPath = path.join(thumbnailsDir, 'new-id-456.jpg');
      expect(fs.existsSync(oldThumbPath)).toBe(false);
      expect(fs.existsSync(newThumbPath)).toBe(true);

      // Check guided view sidecar renamed
      const newGvPath = path.join(guidedViewDir, 'new-id-456.json');
      expect(fs.existsSync(oldGvPath)).toBe(false);
      expect(fs.existsSync(newGvPath)).toBe(true);

      // Check DB queries called for comic, progress, bookmarks, reading lists
      expect(mockDbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE comics SET id = ?'),
        expect.arrayContaining([newId, newComicPath, newName, 'new-id-456.jpg'])
      );
      expect(mockDbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE progress SET comicId = ?'),
        [newId, oldId]
      );
      expect(mockDbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reading_list_items SET comicId = ?'),
        [newId, oldId]
      );
    });
  });

  describe('Batch Operations Safety Confirmation Phrase Validation', () => {
    const attachRenameRoutes = require('../server/routes/admin/rename');
    const attachLibraryMgmtRoutes = require('../server/routes/admin/library-mgmt');

    const mockRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

    test('rename-cbz requires confirmation ONLY for a whole-library (libraryPath) scope', async () => {
      let renameHandler;
      const router = {
        post: jest.fn((url, ...args) => {
          if (url === '/api/v1/rename-cbz') renameHandler = args[args.length - 1];
        }),
        get: jest.fn()
      };
      const deps = {
        getConfig: () => ({ comicsLocation: '/comics' }),
        getComicsDirectories: () => ['/library-a'],
        formatErrorMessage: (e, req, msg) => msg || e.message
      };
      attachRenameRoutes(router, deps);

      // Whole-library scope, missing confirmation → rejected.
      const resNoConfirm = mockRes();
      await renameHandler({ body: { libraryPath: '/library-a' } }, resNoConfirm);
      expect(resNoConfirm.status).toHaveBeenCalledWith(400);
      expect(resNoConfirm.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false, message: expect.stringMatching(/i want to do this/i)
      }));

      // Whole-library scope, wrong confirmation → rejected.
      const resWrong = mockRes();
      await renameHandler({ body: { libraryPath: '/library-a', confirmation: 'yes please' } }, resWrong);
      expect(resWrong.status).toHaveBeenCalledWith(400);

      // Unknown library path → rejected (never reaches confirmation).
      const resBadLib = mockRes();
      await renameHandler({ body: { libraryPath: '/not-a-library', confirmation: 'i want to do this' } }, resBadLib);
      expect(resBadLib.status).toHaveBeenCalledWith(400);
      expect(resBadLib.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/unknown library/i) }));

      // Inbox scope (no libraryPath): confirmation NOT required — must not be a
      // confirmation rejection (it 404s here only because the mock dir is absent).
      const resInbox = mockRes();
      await renameHandler({ body: {} }, resInbox);
      expect(resInbox.json).not.toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringMatching(/i want to do this/i)
      }));
    });

    test('move-comics requires confirmation ONLY for a whole-library (libraryPath) scope', async () => {
      let moveHandler;
      const router = {
        post: jest.fn((url, ...args) => {
          if (url === '/api/v1/move-comics') moveHandler = args[args.length - 1];
        }),
        get: jest.fn()
      };
      const deps = {
        getConfig: () => ({ comicsLocation: '/comics' }),
        getComicsDirectories: () => ['/library-a'],
        requireAdmin: (req, res, next) => next(),
        formatErrorMessage: (e, req, msg) => msg || e.message
      };
      attachLibraryMgmtRoutes(router, deps);

      // Whole-library scope, missing confirmation → rejected.
      const resNoConfirm = mockRes();
      await moveHandler({ body: { libraryPath: '/library-a' } }, resNoConfirm);
      expect(resNoConfirm.status).toHaveBeenCalledWith(400);
      expect(resNoConfirm.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: false, message: expect.stringMatching(/i want to do this/i)
      }));

      // Whole-library scope, wrong confirmation → rejected.
      const resWrong = mockRes();
      await moveHandler({ body: { libraryPath: '/library-a', confirmation: 'I want to do this' } }, resWrong);
      expect(resWrong.status).toHaveBeenCalledWith(400);

      // Inbox scope (no libraryPath): confirmation NOT required.
      const resInbox = mockRes();
      await moveHandler({ body: {} }, resInbox);
      expect(resInbox.json).not.toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringMatching(/i want to do this/i)
      }));
    });
  });

  describe('Tag Comics Now! Naming & Folder Rules Endpoints', () => {
    const attachComicTaggerRoutes = require('../server/routes/admin/comictagger');
    let router;
    let deps;
    let handlers = {};

    beforeEach(() => {
      handlers = {};
      router = {
        get: jest.fn((url, ...args) => { handlers[`GET ${url}`] = args[args.length - 1]; }),
        post: jest.fn((url, ...args) => { handlers[`POST ${url}`] = args[args.length - 1]; })
      };
      deps = {
        getNamingRules: jest.fn(() => DEFAULT_NAMING_RULES),
        setNamingRules: jest.fn(),
        getFolderRules: jest.fn(() => DEFAULT_FOLDER_RULES),
        setFolderRules: jest.fn(),
        saveSetting: jest.fn().mockResolvedValue(),
        formatErrorMessage: (e, req, msg) => msg || e.message
      };
      attachComicTaggerRoutes(router, deps);
    });

    test('GET /api/v1/tag-comics-now/naming-rules returns current naming rules', async () => {
      const handler = handlers['GET /api/v1/tag-comics-now/naming-rules'];
      expect(handler).toBeDefined();

      const res = { json: jest.fn() };
      await handler({}, res);

      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        rules: DEFAULT_NAMING_RULES
      });
    });

    test('POST /api/v1/tag-comics-now/naming-rules saves new rules', async () => {
      const handler = handlers['POST /api/v1/tag-comics-now/naming-rules'];
      expect(handler).toBeDefined();

      const newRules = { tokens: [{ id: 'series', enabled: true, mandatory: true }] };
      const res = { json: jest.fn() };
      await handler({ body: { rules: newRules } }, res);

      expect(deps.setNamingRules).toHaveBeenCalledWith(newRules);
      expect(deps.saveSetting).toHaveBeenCalledWith('namingRules', newRules);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('POST /api/v1/tag-comics-now/naming-preview generates a live preview filename', async () => {
      const handler = handlers['POST /api/v1/tag-comics-now/naming-preview'];
      expect(handler).toBeDefined();

      const req = {
        body: {
          metadata: { Series: 'Animal Castle', Number: '2', Publisher: 'Ablaze', Year: '2022' },
          rules: DEFAULT_NAMING_RULES
        }
      };
      const res = { json: jest.fn() };
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        ok: true,
        filename: '02 Animal Castle [Ablaze] (2022).cbz'
      }));
    });
  });
});

