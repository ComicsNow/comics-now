const path = require('path');
const fs = require('fs');
const os = require('os');
const { Writable } = require('stream');
const attachPagesRoutes = require('../../../server/routes/user/pages');

describe('Guided-view sidecar route - revalidation caching', () => {
  let tempDir;
  let sidecarPath;
  let getHandler;
  let deps;
  let row;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-cache-test-'));
    sidecarPath = path.join(tempDir, 'sidecar.json');
    fs.writeFileSync(sidecarPath, JSON.stringify({ comicId: 'comic-1', type: 'western', pages: {} }));

    row = {
      id: 'comic-1',
      path: path.join(tempDir, 'comic.cbz'),
      publisher: 'DC',
      series: 'Batman',
      guidedViewStatus: 'completed',
      guidedViewPath: sidecarPath
    };

    const router = {
      get: jest.fn((routePath, ...args) => {
        if (routePath === '/api/v1/comics/:id/guided-view') {
          getHandler = args[args.length - 1];
        }
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };

    deps = {
      dbGet: jest.fn(async () => row),
      dbRun: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      isPathSafe: jest.fn(() => true),
      resolvePath: jest.fn((p) => p),
      checkComicAccess: jest.fn().mockResolvedValue(true),
      getComicsDirectories: jest.fn(() => [tempDir]),
      getComicPages: jest.fn(),
      createId: jest.fn(() => 'test-id'),
      getMimeFromExt: jest.fn(() => 'application/json'),
      requireAuth: (req, res, next) => next()
    };

    attachPagesRoutes(router, deps);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createMockRes() {
    const chunks = [];
    const res = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    res.headers = {};
    res.statusCode = 200; // like a fresh ServerResponse
    res.jsonBody = null;
    res.setHeader = jest.fn((name, value) => {
      res.headers[name.toLowerCase()] = value;
    });
    res.status = jest.fn((code) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn((obj) => {
      res.jsonBody = obj;
      res.end();
      return res;
    });
    res.chunks = chunks;
    res.text = () => Buffer.concat(chunks).toString('utf8');
    res.done = new Promise((resolve) => res.on('finish', resolve));
    return res;
  }

  function req(headers = {}) {
    return { params: { id: 'comic-1' }, headers, user: { userId: 'u1', role: 'user' }, query: {} };
  }

  test('serves the sidecar with a revalidating ETag and Last-Modified', async () => {
    const res = createMockRes();
    await getHandler(req(), res);
    await res.done;

    expect(res.statusCode).toBe(200);
    const stat = fs.statSync(sidecarPath);
    expect(res.headers['etag']).toBe(`W/"${stat.size}-${Math.round(stat.mtimeMs)}"`);
    expect(res.headers['last-modified']).toBe(stat.mtime.toUTCString());
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.text())).toEqual({ comicId: 'comic-1', type: 'western', pages: {} });
  });

  test('returns 304 on a matching If-None-Match without a body', async () => {
    const stat = fs.statSync(sidecarPath);
    const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;

    const res = createMockRes();
    await getHandler(req({ 'if-none-match': etag }), res);
    await res.done;

    expect(res.statusCode).toBe(304);
    expect(res.text()).toBe('');
  });

  test('a rewritten sidecar produces a new ETag so the old one no longer matches', async () => {
    const res1 = createMockRes();
    await getHandler(req(), res1);
    await res1.done;
    const firstEtag = res1.headers['etag'];

    fs.writeFileSync(sidecarPath, JSON.stringify({ comicId: 'comic-1', type: 'western', pages: { a: {} } }));

    const res2 = createMockRes();
    await getHandler(req({ 'if-none-match': firstEtag }), res2);
    await res2.done;

    expect(res2.statusCode).toBe(200);
    expect(res2.headers['etag']).not.toBe(firstEtag);
  });

  test('still 404s when the guided view is not completed or the file is missing', async () => {
    row.guidedViewStatus = 'pending';
    let res = createMockRes();
    await getHandler(req(), res);
    expect(res.statusCode).toBe(404);

    row.guidedViewStatus = 'completed';
    fs.unlinkSync(sidecarPath);
    res = createMockRes();
    await getHandler(req(), res);
    expect(res.statusCode).toBe(404);
  });
});
