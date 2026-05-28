const attachRenameRoutes = require('../server/routes/admin/rename');
const fs = require('fs');

describe('Admin Rename Route', () => {
  let router;
  let deps;
  let postHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    router = {
      post: jest.fn((path, handler) => {
        if (path === '/api/v1/rename-cbz') {
          postHandler = handler;
        }
      }),
      get: jest.fn(),
    };

    deps = {
      log: jest.fn(),
      getConfig: jest.fn(() => ({ comicsLocation: '/comics' })),
      renameLog: jest.fn(),
      registerRenameClient: jest.fn(),
      unregisterRenameClient: jest.fn(),
      getRenameLogs: jest.fn(() => []),
      clearRenameLogs: jest.fn(),
      scanLibrary: jest.fn(),
      formatErrorMessage: jest.fn((err) => err.message),
      dbAll: jest.fn(),
      dbRun: jest.fn(),
      createId: jest.fn((p) => 'mock-id-' + p),
      getComicInfoFromArchive: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should successfully rename a comic with "Cover Date" in metadata', async () => {
    attachRenameRoutes(router, deps);

    // Mock existsSync and renameSync
    const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (p === '/comics') return true;
      if (p === '/comics/Justice League.cbz') return true;
      return false; // new path does not exist, safe to rename
    });
    const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation(() => {});

    // Mock database output containing 'Cover Date' instead of CoverDate
    deps.dbAll.mockResolvedValue([
      {
        id: '123',
        path: '/comics/Justice League.cbz',
        name: 'Justice League.cbz',
        metadata: JSON.stringify({
          Series: 'Justice League: The Omega Act',
          Number: '1',
          Publisher: 'DC Comics',
          'Cover Date': '2025-12-01'
        })
      }
    ]);

    const req = {
      body: {}
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await postHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      processed: 1,
      renamed: 1,
      errors: 0,
      results: [
        {
          file: 'Justice League.cbz',
          success: true,
          newName: '01 Justice League: The Omega Act [DC Comics] (2025).cbz',
          output: 'Renamed to: 01 Justice League: The Omega Act [DC Comics] (2025).cbz'
        }
      ]
    }));

    expect(renameSpy).toHaveBeenCalledWith(
      '/comics/Justice League.cbz',
      '/comics/01 Justice League: The Omega Act [DC Comics] (2025).cbz'
    );
  });
});
