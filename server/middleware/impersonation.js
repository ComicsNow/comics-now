/**
 * Admin impersonation ("Login as user").
 *
 * The app's auth is stateless: `extractUserFromJWT` rebuilds req.user from the
 * Cloudflare Access JWT on every request. There is no session to swap, so
 * impersonation is layered on top as a signed, httpOnly cookie that only an
 * admin's own browser carries. When present AND the real identity is an admin,
 * we swap req.user to the target user for the duration of that request while
 * preserving the real admin in req.impersonator (for audit + read-only guard).
 *
 * Security properties:
 *  - The cookie is a short-lived JWT signed with a server-only secret, so it
 *    cannot be forged client-side.
 *  - The swap is honored ONLY when the underlying (real) identity resolves to
 *    an admin AND the cookie's adminUserId matches that admin. A leaked cookie
 *    on a non-admin session therefore does nothing.
 *  - req.realUser always holds the pre-swap identity so control endpoints and
 *    the read-only guard can reason about who is really acting.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'cn_imp';
const SECRET_KEY = 'impersonation_secret';
const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8h

let cachedSecret = null;

/** Load (or lazily generate + persist) the HMAC secret used to sign cookies. */
async function getSecret(dbGet, dbRun) {
  if (cachedSecret) return cachedSecret;
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [SECRET_KEY]);
  if (row && row.value) {
    cachedSecret = row.value;
    return cachedSecret;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [SECRET_KEY, secret]);
  cachedSecret = secret;
  return cachedSecret;
}

/** Minimal cookie header parser (no cookie-parser dependency). */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function signToken(dbGet, dbRun, payload) {
  const secret = await getSecret(dbGet, dbRun);
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
}

function setCookie(res, token, req = null) {
  const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : (process.env.NODE_ENV === 'production');
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Middleware factory: swaps req.user to the impersonated target when a valid
 * cookie is present on a genuine admin session. Mount immediately AFTER
 * extractUserFromJWT and BEFORE the API router.
 */
function createImpersonationMiddleware(deps) {
  const { dbGet, dbRun, log } = deps;
  return async function applyImpersonation(req, res, next) {
    req.realUser = req.user; // may be undefined on public paths
    try {
      if (!req.user || req.user.role !== 'admin') return next();
      const token = readCookie(req, COOKIE_NAME);
      if (!token) return next();

      const secret = await getSecret(dbGet, dbRun);
      let payload;
      try {
        payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      } catch (e) {
        clearCookie(res); // stale/invalid — drop it
        return next();
      }

      // The cookie must belong to THIS admin.
      if (!payload || payload.adminUserId !== req.user.userId) return next();

      const target = await dbGet(
        'SELECT userId, email, role FROM users WHERE userId = ?',
        [payload.targetUserId]
      );
      // Never impersonate a missing user or another admin.
      if (!target || target.role === 'admin') return next();

      req.impersonator = req.user; // preserve the real admin
      req.user = { userId: target.userId, email: target.email, role: target.role };
    } catch (error) {
      if (log) log('WARN', 'IMPERSONATE', `apply failed: ${error.message}`);
    }
    return next();
  };
}

/**
 * Read-only guard: while impersonating, block all state-mutating requests so
 * the target user can never observe side effects. The stop endpoint is exempt.
 */
function impersonationReadOnlyGuard(req, res, next) {
  if (!req.impersonator) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.endsWith('/impersonate/stop')) return next();
  return res.status(403).json({
    ok: false,
    readOnly: true,
    message: 'Read-only while impersonating a user. Exit impersonation to make changes.'
  });
}

module.exports = {
  createImpersonationMiddleware,
  impersonationReadOnlyGuard,
  getSecret,
  signToken,
  setCookie,
  clearCookie,
  COOKIE_NAME
};
