// A Node.js server for the Comics Now! web-based reader.
// Features: CBR→CBZ conversion, thumbnails, dynamic baseUrl injection, full API used by the SPA.
// When the rain pours, cozy up with Comics Now.

// Fail fast (non-zero exit) if a critical module is missing, with a clear
// "run npm ci" message. See server/startup/check-critical-deps.js (Issue #7).
require('./server/startup/check-critical-deps').checkCriticalDeps();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');

const {
  LOGOS_DIRECTORY,
  ICONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
  PAGE_CACHE_DIRECTORY
} = require('./server/constants');
const { initPageCache } = require('./server/services/page-cache');
const { cleanupStaleRarTempDirs } = require('./server/services/archive-utils');

const {
  loadConfigFromDisk,
  getConfig,
  getComicsDirectories,
  getPublicLibraries,
  getScanIntervalMinutes,
  getCorsConfig,
  isAuthEnabled,
  getAuthConfig
} = require('./server/config');

const { log } = require('./server/logger');
const { initializeDatabase, dbGet, dbRun, dbAll, closeDb } = require('./server/db');
const { loadSettings } = require('./server/settings');
const { scanLibrary, scheduleNextScan } = require('./server/services/library');
const { scheduleCtRun } = require('./server/services/tagger');
const { startTaggerWorker } = require('./server/services/tagger-process');
const guidedReader = require('./server/services/guided-reader');

const { createStaticRouter } = require('./server/routes/static');
const { createConfiguredApiRouter } = require('./server/bootstrap/api-router');
const { setupGracefulShutdown } = require('./server/lifecycle');
const { setupRateLimits } = require('./server/middleware/rate-limits');

const {
  extractUserFromJWT,
  initJwksClient
} = require('./server/middleware/auth');
const {
  createImpersonationMiddleware,
  impersonationReadOnlyGuard
} = require('./server/middleware/impersonation');

const dbReady = initializeDatabase();

(async () => {
  await loadConfigFromDisk();

  if (isAuthEnabled()) {
    initJwksClient();
  }

  const app = express();
  const bootConfig = getConfig();
  if (bootConfig.trustProxy !== undefined) {
    app.set('trust proxy', bootConfig.trustProxy);
  }

  // 10mb limit for bulk operations without 413 rejection
  app.use(express.json({ limit: '10mb' }));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https:", "data:", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https://placehold.co", "blob:", "https:"],
        "upgrade-insecure-requests": null,
      },
    },
  }));

  // CORS middleware - standardized using the 'cors' package
  app.use(cors((req, callback) => {
    const corsConfig = getCorsConfig();
    const origin = req.header('Origin');

    const options = {
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cf-Access-Jwt-Assertion']
    };

    if (!corsConfig.enabled || !origin) {
      options.origin = false;
      return callback(null, options);
    }

    const isAllowed = (corsConfig.allowedOrigins || []).some(allowed => allowed === origin);
    options.origin = isAllowed ? origin : false;
    callback(null, options);
  }));

  const config = getConfig();
  const baseUrl = config.baseUrl || '/';

  // Apply rate limiting before routes and authentication
  setupRateLimits(app, baseUrl);

  // Apply authentication middleware globally
  app.use(baseUrl, extractUserFromJWT);

  // Admin impersonation guards
  app.use(baseUrl, createImpersonationMiddleware({ dbGet, dbRun, log }));
  app.use(baseUrl, impersonationReadOnlyGuard);

  // Main API router
  const apiRouter = createConfiguredApiRouter();
  app.use(baseUrl, apiRouter);

  // Optional local extensions (no-op if absent)
  try {
    const { installGeminiTagger } = require('./server/services/gemini-tagger');
    installGeminiTagger({
      app,
      config,
      db: { dbGet, dbRun, dbAll, closeDb },
      paths: require('./server/constants'),
      services: {
        metadata: require('./server/services/metadata'),
        tagger: require('./server/services/tagger'),
        library: require('./server/services/library')
      },
      log
    });
  } catch (err) {
    log('WARN', 'GEMINI', `Gemini tagger initialization note: ${err.message}`);
  }

  // Static routes
  const staticRouter = createStaticRouter({
    getConfig,
    getComicsDirectories,
    getPublicLibraries
  });
  app.use(baseUrl, staticRouter);

  const PORT = process.env.PORT || config.port || 3000;

  await dbReady;
  await loadSettings();

  [
    LOGOS_DIRECTORY,
    ICONS_DIRECTORY,
    THUMBNAILS_DIRECTORY,
    PAGE_CACHE_DIRECTORY
  ].forEach((dir) => {
    try {
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log('INFO', 'SERVER', `Ensured dir: ${dir}`);
      }
    } catch (e) {
      log('WARN', 'SERVER', `Could not ensure directory ${dir}: ${e.message}`);
    }
  });

  // Prime the on-disk WebP page cache (creates dir + prunes any over-cap leftovers).
  await initPageCache();

  try {
    const removed = cleanupStaleRarTempDirs();
    if (removed > 0) log('INFO', 'SERVER', `Removed ${removed} stale RAR temp dir(s)`);
  } catch (e) {
    log('WARN', 'SERVER', `RAR temp cleanup failed: ${e.message}`);
  }

  const server = app.listen(PORT, () => {
    log('INFO', 'SERVER', `Server is running on http://localhost:${PORT}`);
    log('INFO', 'SERVER', `App is available at http://localhost:${PORT}${baseUrl}`);
    log('INFO', 'SERVER', `Scan interval = ${getScanIntervalMinutes()} minutes`);

    const authConfig = getAuthConfig();
    if (authConfig.enabled) {
      log('INFO', 'AUTH', `Authentication: ENABLED (Admin: ${authConfig.adminEmail})`);
    } else {
      log('INFO', 'AUTH', `Authentication: DISABLED (Open access)`);
    }
  });

  setupGracefulShutdown(server);

  try {
    await startTaggerWorker();
  } catch (err) {
    log('WARN', 'SERVER', `Failed to initialize tagger worker on boot: ${err.message}`);
  }

  scheduleCtRun();
  await guidedReader.initialize();

  (async () => {
    await scanLibrary();
    scheduleNextScan();
  })();
})();
