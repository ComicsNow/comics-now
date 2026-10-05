// Issue #10: the trustedIPs bypass trusted the TCP peer address even when the
// request arrived through a reverse proxy/tunnel (X-Forwarded-For present), so
// a local proxy made every unauthenticated request admin. Only demonstrably
// direct requests from a trusted IP may receive the local-admin bypass.

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

function makeReq({ headers = {}, socket = '203.0.113.9', path = '/api/v1/comics' } = {}) {
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

describe('trustedIPs bypass only for demonstrably-direct requests (Issue #10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.isAuthEnabled.mockReturnValue(true);     // auth-enabled mode
    config.getTrustedIPs.mockReturnValue(['127.0.0.1', '::1', '192.168.0.*']);
    process.env.NODE_ENV = 'production';
  });

  test('a local-proxy request with X-Forwarded-For is NOT auto-admin (401)', async () => {
    const req = makeReq({
      socket: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' } // real client behind proxy
    });
    const res = makeRes();
    const next = jest.fn();
    await extractUserFromJWT(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('Cf-Connecting-Ip / Forwarded also defeat the bypass (401)', async () => {
    for (const h of ['cf-connecting-ip', 'forwarded']) {
      const req = makeReq({ socket: '127.0.0.1', headers: { [h]: 'x' } });
      const res = makeRes();
      const next = jest.fn();
      await extractUserFromJWT(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    }
  });

  test('a genuinely direct request from a trusted IP is still local admin', async () => {
    const req = makeReq({ socket: '127.0.0.1', headers: {} });
    const res = makeRes();
    const next = jest.fn();
    await extractUserFromJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ userId: 'default-user', role: 'admin' });
  });

  test('a direct LAN request matching the wildcard is still local admin', async () => {
    const req = makeReq({ socket: '192.168.0.50', headers: {} });
    const res = makeRes();
    const next = jest.fn();
    await extractUserFromJWT(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ userId: 'default-user', role: 'admin' });
  });

  test('an untrusted direct IP with no JWT is unauthorized (401)', async () => {
    const req = makeReq({ socket: '198.51.100.9', headers: {} });
    const res = makeRes();
    const next = jest.fn();
    await extractUserFromJWT(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
