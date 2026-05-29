// A Node.js server for the Comics Now! web-based reader.
// Features: CBR→CBZ conversion, thumbnails, dynamic baseUrl injection, full API used by the SPA.
// When the rain pours, cozy up with Comics Now.

/**
 * Self-healing dependency check.
 * If a required module is missing, attempt to install it before booting.
 */
(function checkDeps() {
  // Critical modules that must be present for the app to start
  const criticalDeps = ['express', 'cors', 'helmet', 'onnxruntime-node', 'sharp', 'sqlite3'];
  let missing = false;
  for (const dep of criticalDeps) {
    try {
      require.resolve(dep);
    } catch (e) {
      missing = true;
      break;
    }
  }

  if (missing) {
    console.warn('\x1b[33m%s\x1b[0m', '--- MISSING NODE MODULES DETECTED ---');
    console.log('Required modules are missing. Attempting to install them automatically...');
    try {
      require('child_process').execSync('npm install --production', { stdio: 'inherit' });
      console.log('\x1b[32m%s\x1b[0m', '--- INSTALL COMPLETE ---');
      console.log('Dependencies have been updated. Please restart the server.');
      process.exit(0);
    } catch (err) {
      console.error('Failed to auto-install modules. Please run "npm install" manually.');
      process.exit(1);
    }
  }
})();

const express = require('express');
const cors = require('cors');
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

const { initializeDatabase, dbGet, dbRun, dbAll, closeDb } = require('./server/db');
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
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https://placehold.co"],
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

  const isAllowed = (corsConfig.allowedOrigins || []).some(allowed => {
    if (allowed === origin) return true;
    const allowedWithoutProtocol = allowed.replace(/^https?:\/\//, '');
    const originWithoutProtocol = origin.replace(/^https?:\/\//, '');
    return allowedWithoutProtocol === originWithoutProtocol;
  });

  options.origin = isAllowed ? origin : false;
  callback(null, options);
}));

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

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', 'SERVER', `Received ${signal}, shutting down…`);
    
    server.close(async () => {
      log('INFO', 'SERVER', 'HTTP server closed.');
      try {
        await closeDb();
        log('INFO', 'SERVER', 'DB closed cleanly.');
      } catch (e) {
        log('ERROR', 'SERVER', `closeDb failed: ${e.message}`);
      }
      process.exit(0);
    });

    // Fallback exit if server.close hangs
    setTimeout(() => {
      log('WARN', 'SERVER', 'Shutdown timed out, forcing exit.');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  scheduleCtRun();
  await guidedReader.initialize();

  (async () => {
    await scanLibrary();
    scheduleNextScan();
  })();
})();
