const fs = require('fs');
const path = require('path');

// Mock the metadata service before requiring the router
jest.mock('../server/services/metadata', () => {
  const original = jest.requireActual('../server/services/metadata');
  return {
    ...original,
    writeComicInfoToCbz: jest.fn(),
  };
});

const { writeComicInfoToCbz } = require('../server/services/metadata');
const attachLibraryMgmtRoutes = require('../server/routes/admin/library-mgmt');

describe('Admin Library Management - Metadata Migration', () => {
  let router;
  let deps;
  let migrateHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    writeComicInfoToCbz.mockReset();
    writeComicInfoToCbz.mockResolvedValue();

    router = {
      post: jest.fn((path, ...args) => {
        if (path === '/api/v1/admin/metadata/migrate') {
          migrateHandler = args[args.length - 1];
        }
      }),
      get: jest.fn(),
    };

    deps = {
      log: jest.fn(),
      dbAll: jest.fn(),
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      getComicsDirectories: jest.fn(),
      scanLibrary: jest.fn(),
      getConfig: jest.fn(),
      moveLog: jest.fn(),
      registerMoveClient: jest.fn(),
      unregisterMoveClient: jest.fn(),
      getLogs: jest.fn(),
      getMoveLogs: jest.fn(),
      clearMoveLogs: jest.fn(),
      getRenameLogs: jest.fn(),
      isScanning: jest.fn(),
      formatErrorMessage: jest.fn((err) => err.message),
      isPathSafe: jest.fn(() => true),
      resolvePath: jest.fn((p) => p),
      createId: jest.fn((p) => 'id-' + path.basename(p)),
      saveMetadataToComic: jest.fn(),
      requireAdmin: jest.fn((req, res, next) => next()),
    };
  });

  it('should reject invalid migration modes', async () => {
    attachLibraryMgmtRoutes(router, deps);

    const req = { body: { mode: 'invalid-mode' } };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await migrateHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, message: 'Invalid mode' })
    );
  });

  it('should successfully migrate to sidecar mode', async () => {
    attachLibraryMgmtRoutes(router, deps);

    // Mock DB return with one CBZ and one CBR
    deps.dbAll.mockResolvedValue([
      {
        id: 'c1',
        path: '/comics/Action Comics.cbz',
        metadata: JSON.stringify({ Series: 'Action Comics', Number: '1', Publisher: 'DC' }),
      },
      {
        id: 'c2',
        path: '/comics/Detective Comics.cbr',
        metadata: JSON.stringify({ Series: 'Detective Comics', Number: '27', Publisher: 'DC' }),
      },
    ]);

    // Spy on fs methods
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const writeFileSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();

    const req = { body: { mode: 'sidecar' } };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await migrateHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, processed: 2 });

    // Verify sidecars are written to correct paths
    expect(writeFileSpy).toHaveBeenCalledWith(
      '/comics/Action Comics.ComicInfo.xml',
      expect.stringContaining('<ComicInfo'),
      'utf-8'
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      '/comics/Detective Comics.ComicInfo.xml',
      expect.stringContaining('<ComicInfo'),
      'utf-8'
    );

    // Check if legacy sidecars are unlinked
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Action Comics.xml');
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Detective Comics.xml');
  });

  it('should successfully migrate to archive mode and cleanup sidecars', async () => {
    attachLibraryMgmtRoutes(router, deps);

    deps.dbAll.mockResolvedValue([
      {
        id: 'c1',
        path: '/comics/Action Comics.cbz',
        metadata: JSON.stringify({ Series: 'Action Comics' }),
      },
      {
        id: 'c2',
        path: '/comics/Detective Comics.cbr',
        metadata: JSON.stringify({ Series: 'Detective Comics' }),
      },
    ]);

    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const req = { body: { mode: 'archive' } };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await migrateHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, processed: 2 });

    // Internal zip write called for CBZ only
    expect(writeComicInfoToCbz).toHaveBeenCalledWith('/comics/Action Comics.cbz', expect.any(String));

    // Cleanup both new and legacy sidecars
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Action Comics.ComicInfo.xml');
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Action Comics.xml');
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Detective Comics.ComicInfo.xml');
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Detective Comics.xml');
  });

  it('should successfully migrate to db mode and cleanup sidecars', async () => {
    attachLibraryMgmtRoutes(router, deps);

    deps.dbAll.mockResolvedValue([
      {
        id: 'c1',
        path: '/comics/Action Comics.cbz',
        metadata: JSON.stringify({ Series: 'Action Comics' }),
      },
    ]);

    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    const req = { body: { mode: 'db' } };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await migrateHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, processed: 1 });

    // Cleanup both new and legacy sidecars
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Action Comics.ComicInfo.xml');
    expect(unlinkSpy).toHaveBeenCalledWith('/comics/Action Comics.xml');
  });
});
