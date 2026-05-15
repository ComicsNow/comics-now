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
  SCRIPTS_DIRECTORY
} = require('./server/constants');

const {
  loadConfigFromDisk,
  getConfig,
  getComicsDirectories,
  getLibraries,
  getPublicLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath,
  addLibrary,
  removeLibrary,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getComicsLocation,
  setComicsLocation,
  getAllowedFormats,
  setAllowedFormats,
  getMetadataStorage,
  setMetadataStorage,
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
  clearMoveLogs,
  guidedLog,
  registerGuidedClient,
  unregisterGuidedClient,
  getGuidedLogs,
  clearGuidedLogs
} = require('./server/logger');

const { initializeDatabase, dbGet, dbRun, dbAll } = require('./server/db');
const { loadSettings, saveSetting } = require('./server/settings');
const {
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  extractPageBuffer,
  generateVirtualMetadata,
  isScanning
} = require('./server/services/library');
const { scheduleCtRun, runComicTagger, applyUserSelection, skipCurrentMatch, getPendingMatch } = require('./server/services/comictagger');
const guidedReader = require('./server/services/guided-reader');
const { saveMetadataToComic, getComicInfoFromArchive } = require('./server/services/metadata');
const {
  cvFetchJson,
  normalizeCvId,
  COMICVINE_API_URL
} = require('./server/services/comicvine');
const { createApiRouter } = require('./server/routes');
const { createStaticRouter } = require('./server/routes/static');
const { createId, getMimeFromExt, t0, ms, stripHtml, sanitizeHtml } = require('./server/utils');

// Import auth middleware
const {
  extractUserFromJWT,
  requireAdmin,
  requireAuth,
  initJwksClient
} = require('./server/middleware/auth');

const dbReady = initializeDatabase();
loadConfigFromDisk();

if (isAuthEnabled()) {
  initJwksClient();
}

const app = express();
app.use(express.json());

app.use(helmet({
  contentSecurityPolicy: false,
  hsts: false,
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

  // Allow same-origin requests (no origin header)
  // This is needed for Service Worker requests from the same origin
  if (!origin) {
    isAllowed = true;
  } else {
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
    // For same-origin requests without origin header, don't set CORS headers
    // (they're not needed and could cause issues)
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cf-Access-Jwt-Assertion');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
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
  registerGuidedClient,
  unregisterGuidedClient,
  getGuidedLogs,
  clearGuidedLogs,
  guidedReader,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getLibraries,
  getPathFromLibraryId,
  getLibraryIdFromPath,
  addLibrary,
  removeLibrary,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getComicsLocation,
  setComicsLocation,
  getAllowedFormats,
  setAllowedFormats,
  getMetadataStorage,
  setMetadataStorage,
  getComicsDirectories,
  getConfig,
  saveSetting,
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  extractPageBuffer,
  generateVirtualMetadata,
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
  getComicInfoFromArchive,
  cvFetchJson,
  normalizeCvId,
  stripHtml,
  sanitizeHtml,
  COMICVINE_API_URL,
  SCRIPTS_DIRECTORY,
  createId,
  getMimeFromExt,
  t0,
  ms,
  requireAdmin,
  requireAuth,
  isAuthEnabled
});

const staticRouter = createStaticRouter({
  getConfig,
  getComicsDirectories,
  getPublicLibraries
});

const config = getConfig();
const baseUrl = config.baseUrl || '/';

// Apply authentication middleware globally
app.use(baseUrl, extractUserFromJWT);

app.use(baseUrl, apiRouter);
app.use(baseUrl, staticRouter);

(async () => {
  const PORT = process.env.PORT || config.port || 3000;

  await dbReady;
  await loadSettings();

  [
    LOGOS_DIRECTORY,
    ICONS_DIRECTORY,
    THUMBNAILS_DIRECTORY
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

  // Also try to ensure library directories, but expect failure if they are system-wide
  getComicsDirectories().forEach(dir => {
    try {
      if (dir && !fs.existsSync(dir)) {
        // Only try to create if it's likely a relative or user-writable path
        if (!dir.startsWith('/') || dir.startsWith(ROOT_DIR)) {
          fs.mkdirSync(dir, { recursive: true });
          log('INFO', 'SERVER', `Ensured library dir: ${dir}`);
        }
      }
    } catch (e) {
      // Quietly ignore library directory creation failures - they likely already exist or are read-only
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
  await guidedReader.initialize();

  (async () => {
    await scanLibrary();
    scheduleNextScan();
  })();
})();
