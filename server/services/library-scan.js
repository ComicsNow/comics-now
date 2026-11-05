const fs = require('fs');
const path = require('path');
const { dbAll, dbRun } = require('../db');
const { log } = require('../logger');
const { getConfig, getLibraries } = require('../config');
const { t0, ms, pMap } = require('../utils');
const guidedReader = require('./guided-reader');

const {
  acquireScanLock,
  releaseScanLock,
  getScanState,
  setTaggerRunningCheck
} = require('./scan/lock');

const { scheduleNextScan } = require('./scan/scheduler');
const { cleanupStaleComics, repairMissingThumbnails } = require('./scan/cleanup');
const { walkLibraryDirectory } = require('./scan/crawler');
const { buildOriginalLinkMap, backfillOriginalLinks } = require('./scan/original-links');

/**
 * Executes a full scan across all configured library folders.
 *
 * @param {boolean} [force=false] - If true, bypasses modification checks and active tagger locks
 */
async function scanLibrary(force = false) {
  if (!acquireScanLock(force)) {
    return;
  }

  const startScan = t0();
  const stats = {
    totalSeen: 0,
    totalInsertedOrUpdated: 0,
    totalConverted: 0,
    thumbOk: 0,
    thumbFail: 0,
    errors: 0,
    subDirScanErrors: 0
  };

  const config = getConfig();
  const libraries = [...getLibraries()];
  if (config.comicsLocation && !libraries.some(l => l.path === config.comicsLocation)) {
    libraries.push({
      path: config.comicsLocation,
      hierarchyMode: 'metadata'
    });
  }
  const allowedFormats = config.allowed_formats || 'cbz';
  log('INFO', 'SCAN', `Starting scan… Libraries: ${libraries.length > 0 ? libraries.map(l => `${l.path} (${l.hierarchyMode})`).join(', ') : '(none set)'} | Allowed Formats: ${allowedFormats}`);

  const fileSystemComics = new Set();
  const newComicIds = [];

  try {
    const linked = await backfillOriginalLinks({ all: dbAll, run: dbRun });
    if (linked > 0) log('INFO', 'SCAN', `Backfilled ${linked} kept-original link(s)`);
  } catch (e) {
    log('WARN', 'SCAN', `Original-link backfill failed: ${e.message}`);
  }

  const dbComics = await dbAll('SELECT id, path, thumbnailPath, guidedViewPath FROM comics');
  const dbComicsMap = new Map(dbComics.map(c => [c.path, { id: c.id, thumbnailPath: c.thumbnailPath, guidedViewPath: c.guidedViewPath }]));
  const originalLinkRows = await dbAll('SELECT path, originalPath FROM comics WHERE originalPath IS NOT NULL');
  const originalLinks = buildOriginalLinkMap(originalLinkRows);
  const conversionRoot = config.comicsLocation ? path.resolve(config.comicsLocation) : null;
  const unreachableTopDirs = [];

  const ctx = {
    config,
    allowedFormats,
    conversionRoot,
    fileSystemComics,
    newComicIds,
    dbComicsMap,
    originalLinks,
    stats,
    force
  };

  try {
    await pMap(libraries, async (lib) => {
      const dir = lib.path;
      const mode = lib.hierarchyMode || 'metadata';
      const t = t0();
      log('INFO', 'SCAN', `Walk: ${dir} (Mode: ${mode})`);
      const reachable = await fs.promises.stat(dir).then(() => true).catch(() => false);
      if (!reachable) {
        unreachableTopDirs.push(dir);
        log('ERROR', 'SCAN', `Top-level scan dir unreachable, skipping: ${dir}`);
        return;
      }
      await walkLibraryDirectory({ dir, libraryMode: mode, libraryRootPath: dir, ctx });
      log('INFO', 'SCAN', `Walk done: ${dir} in ${ms(t)} ms`);
    }, 2);

    await cleanupStaleComics({
      dbComicsMap,
      fileSystemComics,
      unreachableTopDirs,
      subDirScanErrors: stats.subDirScanErrors
    });

    const repaired = await repairMissingThumbnails();
    stats.thumbOk += repaired.thumbOk;
    stats.thumbFail += repaired.thumbFail;
  } catch (e) {
    log('ERROR', 'SCAN', `Scan error: ${e.message}`);
  }

  releaseScanLock();
  log('INFO', 'SCAN', `Scan complete in ${ms(startScan)} ms. Seen: ${stats.totalSeen}, Upserted: ${stats.totalInsertedOrUpdated}, Converted: ${stats.totalConverted}, Thumbs: ${stats.thumbOk} ok / ${stats.thumbFail} fail, Errors: ${stats.errors}`);

  // Notify guided reader so it can auto-process new comics if that setting is enabled.
  try {
    guidedReader.onLibraryScanComplete(newComicIds).catch(err =>
      log('ERROR', 'GUIDED', `onLibraryScanComplete failed: ${err.message}`)
    );
  } catch (err) {
    log('ERROR', 'GUIDED', `Could not notify guided reader: ${err.message}`);
  }
}

function scheduleNextLibraryScan() {
  scheduleNextScan(scanLibrary);
}

module.exports = {
  scanLibrary,
  scheduleNextScan: scheduleNextLibraryScan,
  isScanning: getScanState,
  setTaggerRunningCheck
};
