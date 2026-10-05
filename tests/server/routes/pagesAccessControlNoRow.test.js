const path = require('path');
const fs = require('fs');
const os = require('os');
const attachPagesRoutes = require('../../../server/routes/user/pages');

jest.mock('../../../server/services/archive-utils', () => ({
  getEntryBuffer: jest.fn()
}));
const { getEntryBuffer } = require('../../../server/services/archive-utils');

// Issue #9: /pages, /pages/image and /download used to fail OPEN for any file
// that passed isPathSafe but had no row in the comics table (added before a scan,
// skipped, or a path-string mismatch). checkComicAccess never ran, so per-user
// user_library_access rules were silently bypassed. These tests pin the contract
// that access is enforced EVEN WHEN there is no DB row.
describe('User Pages Routes - access control with no comics row (Issue #9)', () => {
  let handlers;
  let deps;
  let tempDir;
  let comicPath;

  beforeEach(() => {
    jest.clearAllMocks();
    handlers = {};
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-norow-test-'));
    comicPath = path.join(tempDir, 'unscanned.cbz');
    fs.writeFileSync(comicPath, 'dummy archive');

    const router = {
      get: jest.fn((routePath, ...args) => {
        handlers[routePath] = args[args.length - 1];
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };

    deps = {
      // No row in the table for this on-disk file.
      dbGet: jest.fn().mockResolvedValue(undefined),
      dbRun: jest.fn().mockResolvedValue(undefined),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      isPathSafe: jest.fn(() => true),
      resolvePath: jest.fn((p) => p),
      checkComicAccess: jest.fn().mockResolvedValue(false),
      getComicsDirectories: jest.fn(() => [tempDir]),
      getComicPages: jest.fn().mockResolvedValue(['p1.jpg']),
      createId: jest.fn(() => 'test-id'),
      getMimeFromExt: jest.fn(() => 'image/jpeg'),
      requireAuth: (req, res, next) => next()
    };

    attachPagesRoutes(router, deps);
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  function createMockRes() {
    const res = {
      headers: {},
      statusCode: 200,
      sentData: null,
      jsonData: null,
      writableEnded: false,
      setHeader: jest.fn((k, v) => { res.headers[k] = v; return res; }),
      status: jest.fn((code) => { res.statusCode = code; return res; }),
      json: jest.fn((d) => { res.jsonData = d; res.writableEnded = true; return res; }),
      send: jest.fn((d) => { res.sentData = d; res.writableEnded = true; return res; }),
      end: jest.fn(() => { res.writableEnded = true; return res; })
    };
    return res;
  }

  function makeReq(extraQuery = {}, role = 'user') {
    return {
      method: 'GET',
      headers: {},
      user: { userId: 'restricted', role },
      query: { path: Buffer.from(comicPath).toString('base64'), ...extraQuery }
    };
  }

  test('/pages denies a non-admin and still consults checkComicAccess when there is no row', async () => {
    const req = makeReq();
    const res = createMockRes();
    await handlers['/api/v1/comics/pages'](req, res);

    expect(deps.checkComicAccess).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(deps.getComicPages).not.toHaveBeenCalled();
  });

  test('/pages/image denies a non-admin and still consults checkComicAccess when there is no row', async () => {
    getEntryBuffer.mockResolvedValue(Buffer.from('img'));
    const req = makeReq({ page: 'p1.jpg' });
    const res = createMockRes();
    await handlers['/api/v1/comics/pages/image'](req, res);

    expect(deps.checkComicAccess).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(getEntryBuffer).not.toHaveBeenCalled();
  });

  test('/download denies a non-admin and still consults checkComicAccess when there is no row', async () => {
    const req = makeReq();
    const res = createMockRes();
    await handlers['/api/v1/comics/download'](req, res);

    expect(deps.checkComicAccess).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
  });

  test('/pages still serves when checkComicAccess allows it with no row (admin / inbox / path grant)', async () => {
    deps.checkComicAccess.mockResolvedValue(true);
    const req = makeReq({}, 'admin');
    const res = createMockRes();
    await handlers['/api/v1/comics/pages'](req, res);

    expect(deps.checkComicAccess).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({ pages: ['p1.jpg'] });
  });
});
