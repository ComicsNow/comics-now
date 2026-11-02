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
  setupRateLimits
};
