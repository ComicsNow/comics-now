const rateLimit = require('express-rate-limit');

// Rate limiting middleware to address js/missing-rate-limiting alerts
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 authentication attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts, please try again after a minute'
});

const pagesLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 1500, // Very generous to support rapid page-turning, gallery preloads, etc.
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10000, // Very generous limit for overall API usage, static files, and admin actions to handle large libraries
  standardHeaders: true,
  legacyHeaders: false
});

const outboundProxyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many outbound proxy requests, please try again shortly'
});

function createOriginCsrfGuard(options = {}) {
  const getCorsConfig = typeof options.getCorsConfig === 'function' ? options.getCorsConfig : null;
  const mutatingMethods = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

  return function originCsrfGuard(req, res, next) {
    if (!mutatingMethods.has((req.method || '').toUpperCase())) {
      return next();
    }
    const headers = req.headers || {};
    const hasCookie = Boolean(headers.cookie);
    if (!hasCookie) {
      return next();
    }
    const rawOrigin = headers.origin || headers.referer;
    if (!rawOrigin) {
      return next();
    }
    try {
      const parsedOrigin = new URL(rawOrigin);
      const originHost = (parsedOrigin.host || '').toLowerCase();
      const requestHost = (typeof req.get === 'function' ? req.get('host') : headers.host || '').toLowerCase();
      if (originHost && requestHost && originHost === requestHost) {
        return next();
      }
      const corsConf = getCorsConfig ? getCorsConfig() : null;
      if (corsConf && corsConf.enabled && Array.isArray(corsConf.allowedOrigins)) {
        if (corsConf.allowedOrigins.includes(parsedOrigin.origin)) {
          return next();
        }
      }
    } catch (_) {
      return res.status(403).json({ ok: false, error: 'Forbidden: Invalid origin header' });
    }
    return res.status(403).json({ ok: false, error: 'Forbidden: Cross-site request blocked' });
  };
}

const generalLimiterExclusions = new Set([
  '/api/v1/public/auth',
  '/api/v1/comics/pages/image',
  '/thumbnails',
  '/icons',
  '/logos'
]);

const pathJoin = (base, sub) => {
  const b = base.endsWith('/') ? base : (base + '/');
  const s = sub.startsWith('/') ? sub.substring(1) : sub;
  return b + s;
};

/**
 * Attaches rate limiters to the Express app.
 *
 * @param {import('express').Application} app
 * @param {string} baseUrl
 */
function setupRateLimits(app, baseUrl = '/') {
  app.use(pathJoin(baseUrl, 'api/v1/public/auth'), authLimiter);
  app.use(pathJoin(baseUrl, 'api/v1/comics/pages/image'), pagesLimiter);
  app.use(pathJoin(baseUrl, 'api/v1/proxy/cover'), outboundProxyLimiter);
  app.use(pathJoin(baseUrl, 'api/v1/metadata/extract-from-url'), outboundProxyLimiter);
  app.use(pathJoin(baseUrl, 'api/v1/tracker-proxy'), outboundProxyLimiter);
  app.use(pathJoin(baseUrl, 'api/v1/aria-rpc'), outboundProxyLimiter);

  app.use(baseUrl, (req, res, next) => {
    const relativePath = req.path.startsWith(baseUrl) ? req.path.slice(baseUrl.length) || '/' : req.path;
    for (const excluded of generalLimiterExclusions) {
      if (relativePath === excluded || relativePath.startsWith(excluded + '/')) {
        return next();
      }
    }
    return generalLimiter(req, res, next);
  });
}

module.exports = {
  authLimiter,
  pagesLimiter,
  generalLimiter,
  outboundProxyLimiter,
  createOriginCsrfGuard,
  setupRateLimits
};
