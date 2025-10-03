// A Node.js server for the Comics Now! web-based reader.
// Features: CBR→CBZ conversion, thumbnails, dynamic baseUrl injection, full API used by the SPA.
// When the rain pours, cozy up with Comics Now.

const express = require('express');
const helmet = require('helmet');
const fs = require('fs');

const {
  LOGOS_DIRECTORY,
  ICONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
  TEMP_DIRECTORY,
  SCREENSHOTS_DIRECTORY,
  SCRIPTS_DIRECTORY
} = require('./server/constants');

const {
  loadConfigFromDisk,
  getConfig,
  getComicsDirectories,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getCorsConfig,
  isAuthEnabled,
  getAuthConfig
} = require('./server/config');

const {
  log,
  ctLog,
  registerCtClient,
  unregisterCtClient,
  getLogs,
  getCtLogs,
  renameLog,
  registerRenameClient,
  unregisterRenameClient,
  getRenameLogs,
  clearRenameLogs,
  moveLog,
  registerMoveClient,
  unregisterMoveClient,
  getMoveLogs,
  clearMoveLogs
} = require('./server/logger');

const { initializeDatabase, dbGet, dbRun, dbAll } = require('./server/db');
const { loadSettings, saveSetting } = require('./server/settings');
const {
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  isScanning
} = require('./server/services/library');
const { scheduleCtRun, runComicTagger, applyUserSelection, skipCurrentMatch, getPendingMatch } = require('./server/services/comictagger');
const { saveMetadataToComic } = require('./server/services/metadata');
const {
  cvFetchJson,
  normalizeCvId,
  stripHtml,
  COMICVINE_API_URL
} = require('./server/services/comicvine');
const { createApiRouter } = require('./server/routes/api');
const { createStaticRouter } = require('./server/routes/static');
const { createId, getMimeFromExt } = require('./server/utils');

// Import auth middleware
const {
  extractUserFromJWT,
  requireAdmin,
  requireAuth,
  initJwksClient
} = require('./server/middleware/auth');

initializeDatabase();
loadConfigFromDisk();

// Initialize JWKS client if auth is enabled
if (isAuthEnabled()) {
  console.log('✓ Authentication enabled - Cloudflare Zero Trust mode');
  initJwksClient();
} else {
  console.log('ℹ️  Authentication disabled - Open access mode');
}

const app = express();
app.use(express.json());

// Security headers middleware
// Disable CSP (would break inline scripts) and HSTS (would break local HTTP access)
app.use(helmet({
  contentSecurityPolicy: false,  // Keep inline scripts working
  hsts: false,                   // Keep HTTP local access working (IP bypass)
}));

// CORS middleware - configured via config.json
app.use((req, res, next) => {
  const corsConfig = getCorsConfig();

  // If CORS is disabled, skip
  if (!corsConfig.enabled) {
    return next();
  }

  const origin = req.headers.origin;
  const allowedOrigins = corsConfig.allowedOrigins || [];

  // Check if origin is allowed
  let isAllowed = false;
  if (origin) {
    isAllowed = allowedOrigins.some(allowed => {
      // Exact match
      if (allowed === origin) return true;

      // Protocol-agnostic match (e.g., allow both http and https)
      const allowedWithoutProtocol = allowed.replace(/^https?:\/\//, '');
      const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
      return allowedWithoutProtocol === originWithoutProtocol;
    });
  }

  // If origin is allowed, set CORS headers
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cf-Access-Jwt-Assertion');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

const apiRouter = createApiRouter({
  log,
  ctLog,
  registerCtClient,
  unregisterCtClient,
  getLogs,
  getCtLogs,
  renameLog,
  registerRenameClient,
  unregisterRenameClient,
  getRenameLogs,
  clearRenameLogs,
  moveLog,
  registerMoveClient,
  unregisterMoveClient,
  getMoveLogs,
  clearMoveLogs,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getComicsDirectories,
  getConfig,
  saveSetting,
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  isScanning,
  dbGet,
  dbRun,
  dbAll,
  runComicTagger,
  scheduleCtRun,
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch,
  saveMetadataToComic,
  cvFetchJson,
  normalizeCvId,
  stripHtml,
  COMICVINE_API_URL,
  SCRIPTS_DIRECTORY,
  createId,
  getMimeFromExt,
  requireAdmin,
  requireAuth,
  isAuthEnabled
});

const staticRouter = createStaticRouter({
  getConfig,
  getComicsDirectories
});

const config = getConfig();
const baseUrl = config.baseUrl || '/';

// Apply authentication middleware globally
app.use(baseUrl, extractUserFromJWT);

app.use(baseUrl, apiRouter);
app.use(baseUrl, staticRouter);

(async () => {
  const PORT = process.env.PORT || config.port || 3000;

  await loadSettings();

  [
    LOGOS_DIRECTORY,
    ICONS_DIRECTORY,
    THUMBNAILS_DIRECTORY,
    TEMP_DIRECTORY,
    SCREENSHOTS_DIRECTORY,
    ...getComicsDirectories()
  ].forEach((dir) => {
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log('INFO', 'SERVER', `Ensured dir: ${dir}`);
    }
  });

  app.listen(PORT, () => {
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

  scheduleCtRun();

  (async () => {
    await scanLibrary();
    scheduleNextScan();
  })();
})();
