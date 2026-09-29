const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const attachPagesRoutes = require('../../../server/routes/user/pages');
const { setCustomCacheDir } = require('../../../server/services/page-cache');

jest.mock('../../../server/services/archive-utils', () => ({
  getEntryBuffer: jest.fn()
}));

const { getEntryBuffer } = require('../../../server/services/archive-utils');

describe('User Pages Route - WebP Downscaling & Caching', () => {
  let router;
  let imageHandler;
  let deps;
  let tempDir;
  let fakeComicPath;
  let sampleImageBuffer;

  beforeAll(async () => {
    // Generate a 2000x2000 test JPEG
    sampleImageBuffer = await sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: { r: 255, g: 100, b: 50 }
      }
    }).jpeg().toBuffer();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-webp-test-'));
    setCustomCacheDir(path.join(tempDir, 'cache'));
    fakeComicPath = path.join(tempDir, 'test_comic.cbz');
    fs.writeFileSync(fakeComicPath, 'dummy archive');

    router = {
      get: jest.fn((routePath, ...args) => {
        if (routePath === '/api/v1/comics/pages/image') {
          imageHandler = args[args.length - 1];
        }
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn()
    };

    deps = {
      dbGet: jest.fn().mockResolvedValue({ id: 'comic-1', publisher: 'DC', series: 'Batman' }),
      dbRun: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e) => e.message),
      isPathSafe: jest.fn(() => true),
      resolvePath: jest.fn((p) => p),
      checkComicAccess: jest.fn().mockResolvedValue(true),
      getComicsDirectories: jest.fn(() => [tempDir]),
      getComicPages: jest.fn(),
      createId: jest.fn(() => 'test-id'),
      getMimeFromExt: jest.fn((p) => (p.endsWith('.gif') ? 'image/gif' : 'image/jpeg')),
      requireAuth: (req, res, next) => next()
    };

    attachPagesRoutes(router, deps);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  function createMockRes() {
    const res = {
      headers: {},
      statusCode: 200,
      sentData: null,
      writableEnded: false,
      setHeader: jest.fn((k, v) => {
        res.headers[k] = v;
      }),
      status: jest.fn((code) => {
        res.statusCode = code;
        return res;
      }),
      send: jest.fn((data) => {
        res.sentData = data;
        res.writableEnded = true;
        return res;
      }),
      end: jest.fn(() => {
        res.writableEnded = true;
        return res;
      })
    };
    return res;
  }

  function makeReq(query, role = 'user') {
    return {
      user: { userId: 1, role },
      query: {
        path: Buffer.from(fakeComicPath).toString('base64'),
        ...query
      }
    };
  }

  test('serves original format when w parameter is not provided', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: '01.jpg' });
    const res = createMockRes();

    await imageHandler(req, res);

    expect(res.headers['Content-Type']).toBe('image/jpeg');
    expect(res.sentData).toEqual(sampleImageBuffer);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);
  });

  test('transcodes to WebP and resizes when w=1600 is provided', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: '01.jpg', w: '1600' });
    const res = createMockRes();

    await imageHandler(req, res);

    expect(res.headers['Content-Type']).toBe('image/webp');
    expect(res.headers['Cache-Control']).toContain('immutable');

    const meta = await sharp(res.sentData).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1600);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);
  });

  test('fmt=webp (no w) transcodes to WebP at ORIGINAL resolution (for guided-view coordinate accuracy)', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: '01.jpg', fmt: 'webp' });
    const res = createMockRes();
    await imageHandler(req, res);

    expect(res.headers['Content-Type']).toBe('image/webp');
    const meta = await sharp(res.sentData).metadata();
    expect(meta.format).toBe('webp');
    // NOT resized — original 2000x2000 preserved so natural dims == coordinate space.
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(2000);
  });

  test('fmt=webp caches separately and is served from cache on repeat', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);
    const req = makeReq({ page: '01.jpg', fmt: 'webp' });

    const res1 = createMockRes();
    await imageHandler(req, res1);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);

    const res2 = createMockRes();
    await imageHandler(req, res2);
    expect(res2.headers['Content-Type']).toBe('image/webp');
    expect(res2.sentData).toEqual(res1.sentData);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);
  });

  test('does not upscale images smaller than the requested width', async () => {
    const smallBuf = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: { r: 10, g: 20, b: 30 } }
    }).jpeg().toBuffer();
    getEntryBuffer.mockResolvedValue(smallBuf);

    const req = makeReq({ page: 'small.jpg', w: '1600' });
    const res = createMockRes();
    await imageHandler(req, res);

    const meta = await sharp(res.sentData).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(1200);
  });

  test('serves cached WebP on subsequent requests without re-extracting', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: '01.jpg', w: '1600' });

    const res1 = createMockRes();
    await imageHandler(req, res1);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);

    const res2 = createMockRes();
    await imageHandler(req, res2);

    expect(res2.headers['Content-Type']).toBe('image/webp');
    expect(res2.sentData).toEqual(res1.sentData);
    expect(getEntryBuffer).toHaveBeenCalledTimes(1);
  });

  test('dedupes concurrent transcodes of the same page (single sharp run)', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: '01.jpg', w: '1600' });
    const res1 = createMockRes();
    const res2 = createMockRes();

    // Fire both before either resolves.
    await Promise.all([imageHandler(req, res1), imageHandler(req, res2)]);

    expect(res1.headers['Content-Type']).toBe('image/webp');
    expect(res2.headers['Content-Type']).toBe('image/webp');
    expect(res1.sentData).toEqual(res2.sentData);
  });

  test('skips transcode for animated GIFs and serves the original', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const req = makeReq({ page: 'anim.gif', w: '1600' });
    const res = createMockRes();
    await imageHandler(req, res);

    expect(res.headers['Content-Type']).not.toBe('image/webp');
    expect(res.headers['Content-Type']).toBe('image/gif');
    expect(res.sentData).toEqual(sampleImageBuffer);
  });

  test('falls back to original bytes (HTTP 200) when transcode fails', async () => {
    const corrupt = Buffer.from('this is definitely not a valid image');
    getEntryBuffer.mockResolvedValue(corrupt);

    const req = makeReq({ page: 'broken.jpg', w: '1600' });
    const res = createMockRes();
    await imageHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/jpeg');
    expect(res.sentData).toEqual(corrupt);
    expect(deps.log).toHaveBeenCalled();
  });

  test('returns 404 when the page is missing from the archive', async () => {
    getEntryBuffer.mockResolvedValue(null);

    const req = makeReq({ page: 'ghost.jpg', w: '1600' });
    const res = createMockRes();
    await imageHandler(req, res);

    expect(res.statusCode).toBe(404);
  });

  test('enforces access control: unauthorized user receives 403 even if cached', async () => {
    getEntryBuffer.mockResolvedValue(sampleImageBuffer);

    const reqAuth = makeReq({ page: '01.jpg', w: '1600' });
    const res1 = createMockRes();
    await imageHandler(reqAuth, res1);
    expect(res1.headers['Content-Type']).toBe('image/webp');

    deps.checkComicAccess.mockResolvedValueOnce(false);
    const reqUnauth = makeReq({ page: '01.jpg', w: '1600' }, 'user');
    reqUnauth.user.userId = 2;
    const res2 = createMockRes();
    await imageHandler(reqUnauth, res2);

    expect(res2.statusCode).toBe(403);
    expect(res2.sentData).toBeNull();
  });
});
