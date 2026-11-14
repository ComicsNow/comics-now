const fs = require('fs');
const os = require('os');
const path = require('path');

const { getComicInfoFromArchive } = require('../../../server/services/metadata/archive');
const attachGeminiRoutes = require('../../../server/routes/admin/gemini');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createMockRouter() {
  const routes = {};
  return {
    get: jest.fn((p, h) => { routes[`GET ${p}`] = h; }),
    post: jest.fn((p, h) => { routes[`POST ${p}`] = h; }),
    routes,
  };
}

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('[M-3] ComicInfo XML XXE & 2MB cap + [M-4] config file permissions', () => {
  const cleanupDirs = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop(), { recursive: true, force: true });
    }
  });

  test('getComicInfoFromArchive rejects XML containing DOCTYPE or ENTITY declarations', async () => {
    const dir = makeTempDir('archive-xxe-');
    cleanupDirs.push(dir);
    const cbzPath = path.join(dir, 'sample.cbz');
    const sidecarPath = path.join(dir, 'sample.ComicInfo.xml');

    fs.writeFileSync(cbzPath, '');
    fs.writeFileSync(
      sidecarPath,
      '<?xml version="1.0"?><!DOCTYPE ComicInfo [ <!ENTITY test "val"> ]><ComicInfo><Title>BlockedXXE</Title></ComicInfo>',
      'utf8'
    );

    const parsed = await getComicInfoFromArchive(cbzPath);
    expect(parsed).toEqual({});

    fs.writeFileSync(
      sidecarPath,
      '<!entity x SYSTEM "file:///etc/passwd"><ComicInfo><Title>BlockedEntity</Title></ComicInfo>',
      'utf8'
    );
    const parsedLower = await getComicInfoFromArchive(cbzPath);
    expect(parsedLower).toEqual({});
  });

  test('getComicInfoFromArchive rejects ComicInfo.xml larger than 2MB', async () => {
    const dir = makeTempDir('archive-size-');
    cleanupDirs.push(dir);
    const cbzPath = path.join(dir, 'oversized.cbz');
    const sidecarPath = path.join(dir, 'oversized.ComicInfo.xml');

    fs.writeFileSync(cbzPath, '');
    const padding = 'A'.repeat(2 * 1024 * 1024 + 100);
    fs.writeFileSync(
      sidecarPath,
      `<ComicInfo><Title>Oversized</Title><Summary>${padding}</Summary></ComicInfo>`,
      'utf8'
    );

    const parsed = await getComicInfoFromArchive(cbzPath);
    expect(parsed).toEqual({});
  });

  test('admin gemini config route writes config file with 0o600 permissions', async () => {
    const dir = makeTempDir('gemini-perm-');
    cleanupDirs.push(dir);
    const cfgPath = path.join(dir, 'config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ geminiTermsAccepted: false }), { mode: 0o644 });

    const router = createMockRouter();
    attachGeminiRoutes(router, {
      config: {},
      getConfig: () => ({}),
      dbGet: async () => null,
      dbRun: async () => {},
      paths: { CONFIG_FILE: cfgPath },
    });

    const handler = router.routes['POST /api/v1/gemini/config'];
    expect(typeof handler).toBe('function');

    const res = createMockRes();
    await handler(
      {
        body: {
          geminiTermsAccepted: true,
          geminiModel: 'gemini-3.5-flash-lite',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fs.statSync(cfgPath).mode & 0o777).toBe(0o600);
  });
});
