const {
  createOriginCsrfGuard,
  outboundProxyLimiter
} = require('../../../server/middleware/rate-limits');
const { clearCookie } = require('../../../server/middleware/impersonation');

function mockReq({ method = 'POST', headers = {}, secure = false } = {}) {
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = v;
  }
  return {
    method,
    headers: lowerHeaders,
    secure,
    get(name) {
      return lowerHeaders[name.toLowerCase()];
    }
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    clearedCookies: [],
    status: jest.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((data) => {
      res.body = data;
      return res;
    }),
    clearCookie: jest.fn((name, opts) => {
      res.clearedCookies.push({ name, opts });
    })
  };
  return res;
}

describe('[H-6][H-7][L-1][L-2] Middleware Security Guards & Cookie Hardening', () => {
  test('outboundProxyLimiter is exported as an Express middleware function', () => {
    expect(typeof outboundProxyLimiter).toBe('function');
  });

  test('createOriginCsrfGuard blocks cross-origin cookie-authenticated state-changing requests with 403', () => {
    expect(typeof createOriginCsrfGuard).toBe('function');
    const guard = createOriginCsrfGuard();

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const req = mockReq({
        method,
        headers: {
          host: 'comics.example.com',
          cookie: 'cf_session=abc',
          origin: 'https://evil.attacker.com'
        }
      });
      const res = mockRes();
      const next = jest.fn();

      guard(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }

    // Also blocks cross-origin Referer when Origin absent
    const reqRef = mockReq({
      method: 'POST',
      headers: {
        host: 'comics.example.com',
        cookie: 'cf_session=abc',
        referer: 'https://evil.attacker.com/csrf.html'
      }
    });
    const resRef = mockRes();
    const nextRef = jest.fn();
    guard(reqRef, resRef, nextRef);
    expect(resRef.status).toHaveBeenCalledWith(403);
    expect(nextRef).not.toHaveBeenCalled();
  });

  test('createOriginCsrfGuard allows same-origin requests, safe methods, and Bearer requests without cookies', () => {
    const guard = createOriginCsrfGuard();

    // Safe GET request even with cross-origin Referer + cookie
    const nextGet = jest.fn();
    guard(
      mockReq({
        method: 'GET',
        headers: { host: 'comics.example.com', cookie: 'cf=1', origin: 'https://external.example' }
      }),
      mockRes(),
      nextGet
    );
    expect(nextGet).toHaveBeenCalledTimes(1);

    // Same-origin POST with cookie
    const nextSame = jest.fn();
    guard(
      mockReq({
        method: 'POST',
        headers: { host: 'comics.example.com:3000', cookie: 'cf=1', origin: 'http://comics.example.com:3000' }
      }),
      mockRes(),
      nextSame
    );
    expect(nextSame).toHaveBeenCalledTimes(1);

    // Bearer-authenticated POST without cookie
    const nextBearer = jest.fn();
    guard(
      mockReq({
        method: 'POST',
        headers: {
          host: 'comics.example.com',
          authorization: 'Bearer mock-jwt-token',
          origin: 'https://client-app.example'
        }
      }),
      mockRes(),
      nextBearer
    );
    expect(nextBearer).toHaveBeenCalledTimes(1);
  });

  test('clearCookie passes httpOnly, sameSite lax, path /, and secure flag matching request context', () => {
    const resHttp = mockRes();
    clearCookie(resHttp, { secure: false, headers: {} });
    expect(resHttp.clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false
      })
    );

    const resHttps = mockRes();
    clearCookie(resHttps, { secure: false, headers: { 'x-forwarded-proto': 'https' } });
    expect(resHttps.clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true
      })
    );
  });
});
