// Issue #6: X-Test-User-* headers must only be honored in the test harness,
// not in production images (where auth-disabled otherwise lets any client
// impersonate an arbitrary userId).

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

describe('X-Test-User headers are gated to the test harness (Issue #6)', () => {
  const ORIG = process.env.NODE_ENV;
  const ORIG_FLAG = process.env.ALLOW_TEST_USER_HEADERS;

  beforeEach(() => {
    jest.clearAllMocks();
    config.isAuthEnabled.mockReturnValue(false); // auth-disabled mode
  });
  afterEach(() => {
    process.env.NODE_ENV = ORIG;
    if (ORIG_FLAG === undefined) delete process.env.ALLOW_TEST_USER_HEADERS;
    else process.env.ALLOW_TEST_USER_HEADERS = ORIG_FLAG;
  });

  test('in production, X-Test-User-* headers are ignored (falls back to default admin)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_TEST_USER_HEADERS;
    const req = makeReq({ headers: {
      'x-test-user-id': 'victim', 'x-test-user-role': 'admin', 'x-test-user-email': 'victim@test.local'
    } });
    const next = jest.fn();
    await extractUserFromJWT(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('default-user');
    expect(req.user).not.toMatchObject({ userId: 'victim' });
  });

  test('under NODE_ENV=test, the headers are still honored for the suite', async () => {
    process.env.NODE_ENV = 'test';
    const req = makeReq({ headers: { 'x-test-user-id': 'tester', 'x-test-user-role': 'user' } });
    const next = jest.fn();
    await extractUserFromJWT(req, makeRes(), next);

    expect(req.user).toMatchObject({ userId: 'tester', role: 'user' });
  });
});
