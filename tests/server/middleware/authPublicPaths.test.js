jest.mock('../../../server/config', () => ({
  isAuthEnabled: jest.fn(),
  getAdminEmail: jest.fn(() => 'admin@example.com'),
  getCloudflareConfig: jest.fn(() => ({})),
  getTrustedIPs: jest.fn(() => [])
}));
jest.mock('../../../server/db', () => ({
  dbRun: jest.fn().mockResolvedValue(undefined),
  dbGet: jest.fn().mockResolvedValue(undefined),
  dbAll: jest.fn().mockResolvedValue([])
}));
jest.mock('../../../server/services/readingLists', () => ({
  autoSeedNewUserReadingLists: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../server/logger', () => ({ log: jest.fn() }));

const config = require('../../../server/config');
const { extractUserFromJWT } = require('../../../server/middleware/auth');

function makeReq({ headers = {}, socket = '203.0.113.9', path = '/' } = {}) {
  return {
    path,
    headers,
    ip: socket,
    socket: { remoteAddress: socket },
    connection: { remoteAddress: socket }
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
}

describe('Public asset paths in auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.isAuthEnabled.mockReturnValue(true);
    config.getTrustedIPs.mockReturnValue([]);
    process.env.NODE_ENV = 'production';
  });

  test('allows public access to Vite bundled JS/CSS assets without JWT', async () => {
    const assets = [
      '/assets/index-DhCVyphv.js',
      '/assets/index-ANWiiFxI.css',
      '/assets/background-CZ9urAdd.png'
    ];

    for (const assetPath of assets) {
      const req = makeReq({
        path: assetPath,
        headers: { 'cf-connecting-ip': '203.0.113.5' }
      });
      const res = makeRes();
      const next = jest.fn();

      await extractUserFromJWT(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(401);
    }
  });

  test('allows public access to library logos without JWT', async () => {
    const req = makeReq({
      path: '/logos/marvel.png',
      headers: { 'cf-connecting-ip': '203.0.113.5' }
    });
    const res = makeRes();
    const next = jest.fn();

    await extractUserFromJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});
