const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../server/services/organization', () => {
  const actual = jest.requireActual('../server/services/organization');
  return {
    ...actual,
    formatFolderPath: jest.fn(() => 'Synthetic Publisher/Synthetic Series'),
    updateComicIdentity: jest.fn().mockResolvedValue({})
  };
});

const attachMoveRoutes = require('../server/routes/admin/library/move');
const { updateComicIdentity } = require('../server/services/organization');

describe('Move route with linked originals', () => {
  let sourceDir;
  let destBaseDir;
  let destDir;
  let router;
  let deps;
  let postHandler;
  let moveLog;
  let originalPath;
  let sourceCbz;

  function comicRow(overrides = {}) {
    return {
      id: 'comic-id',
      path: sourceCbz,
      name: 'Synthetic Issue.cbz',
      metadata: JSON.stringify({
        Series: 'Synthetic Series',
        Number: '1',
        Publisher: 'Synthetic Publisher',
        Year: '2024'
      }),
      originalPath,
      ...overrides
    };
  }

  async function runMove() {
    const req = { body: { targetDirectory: destBaseDir } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await postHandler(req, res);
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    updateComicIdentity.mockResolvedValue({});

    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-move-source-'));
    destBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-move-dest-'));
    destDir = path.join(destBaseDir, 'Synthetic Publisher', 'Synthetic Series');
    fs.mkdirSync(destDir, { recursive: true });

    sourceCbz = path.join(sourceDir, 'Synthetic Issue.cbz');
    originalPath = path.join(sourceDir, 'Synthetic Issue.pdf');
    fs.writeFileSync(sourceCbz, 'cbz');
    fs.writeFileSync(originalPath, 'pdf');

    moveLog = jest.fn();
    postHandler = null;
    router = {
      post: jest.fn((route, ...args) => {
        if (route === '/api/v1/move-comics') postHandler = args[args.length - 1];
      }),
      get: jest.fn()
    };

    deps = {
      log: jest.fn(),
      dbAll: jest.fn().mockResolvedValue([comicRow()]),
      dbRun: jest.fn(),
      getComicsDirectories: () => [sourceDir, destBaseDir],
      scanLibrary: jest.fn(),
      getConfig: () => ({ comicsLocation: sourceDir }),
      moveLog,
      registerMoveClient: jest.fn(),
      unregisterMoveClient: jest.fn(),
      getMoveLogs: jest.fn(() => []),
      clearMoveLogs: jest.fn(),
      getRenameLogs: jest.fn(() => []),
      formatErrorMessage: (e, req, msg) => msg || e.message,
      createId: () => 'new-id',
      requireAdmin: (_req, _res, next) => next && next(),
      getFolderRules: () => ({
        hierarchy: ['publisher', 'series']
      })
    };

    attachMoveRoutes(router, deps);
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(destBaseDir, { recursive: true, force: true });
  });

  test('passes the companion original to the relocator with the basename preserved', async () => {
    const res = await runMove();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, moved: 1, errors: 0 }));
    expect(updateComicIdentity).toHaveBeenCalledTimes(1);
    expect(updateComicIdentity.mock.calls[0][0]).toEqual(expect.objectContaining({
      oldOriginalPath: originalPath,
      newOriginalPath: path.join(destDir, 'Synthetic Issue.pdf')
    }));
  });

  test('aborts the comic when the destination already has that original filename', async () => {
    fs.writeFileSync(path.join(destDir, 'Synthetic Issue.pdf'), 'existing');

    const res = await runMove();

    expect(updateComicIdentity).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.moved).toBe(0);
    expect(payload.errors).toBe(1);
    expect(payload.results[0].error).toMatch(/Original file already exists/);
    expect(fs.existsSync(sourceCbz)).toBe(true);
    expect(fs.existsSync(originalPath)).toBe(true);
  });

  test('clears the link and warns when the original is missing', async () => {
    fs.unlinkSync(originalPath);

    const res = await runMove();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, moved: 1 }));
    expect(updateComicIdentity.mock.calls[0][0]).toEqual(expect.objectContaining({
      oldOriginalPath: originalPath,
      newOriginalPath: null
    }));
    expect(moveLog).toHaveBeenCalledWith(expect.stringMatching(/original file missing/i));
  });

  test('leaves originalPath out of the call when the comic has no link', async () => {
    deps.dbAll.mockResolvedValue([comicRow({ originalPath: null })]);

    await runMove();

    const callArg = updateComicIdentity.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('oldOriginalPath');
    expect(callArg).not.toHaveProperty('newOriginalPath');
  });

  test('baseline move without a link still succeeds', async () => {
    deps.dbAll.mockResolvedValue([comicRow({ originalPath: null })]);

    const res = await runMove();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, moved: 1, errors: 0 }));
  });
});
