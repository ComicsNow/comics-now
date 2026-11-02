const path = require('path');
const db = require('../../db');
const metadata = require('../metadata');
const { getConfig, getTaggerForceReprocess } = require('../../config');
const { checkFileSuccess, recordCompleteComic } = require('./persist');

const SCAN_MODES = ['default', 'unmatched', 'existing-xml', 'force'];

// Explicit mode wins, then an explicit force flag, then the persisted
// "force re-scan by default" setting (used by scheduled runs).
function resolveScanMode(options = {}) {
  const opts = options || {};
  if (opts.mode && SCAN_MODES.includes(opts.mode)) return opts.mode;
  if (opts.force !== undefined) return opts.force ? 'force' : 'default';
  return (getTaggerForceReprocess && getTaggerForceReprocess()) ? 'existing-xml' : 'default';
}

// DB-exact count of inbox comics previously recorded as no-match.
async function getScanScopeCounts() {
  try {
    const dir = getConfig().comicsLocation;
    if (!dir) return { unmatched: 0 };
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    const escapeLike = (s) => String(s).replace(/\^/g, '^^').replace(/%/g, '^%').replace(/_/g, '^_');
    const row = await db.dbGet(
      `SELECT COUNT(*) AS unmatched FROM comics
       WHERE tagStatus = 'failed'
         AND path LIKE ? ESCAPE '^'
         AND instr(substr(path, ?), ?) = 0`,
      [`${escapeLike(prefix)}%`, prefix.length + 1, path.sep]
    );
    return { unmatched: (row && row.unmatched) || 0 };
  } catch (e) {
    return { unmatched: 0 };
  }
}

async function evaluateFileGates(filePath, fileName, stats, existing, mode, publisherCodex) {
  const bypassCoreGates = (mode === 'force' || mode === 'existing-xml');
  const bypassNoMatchGate = (mode !== 'default');
  const isModified = !existing || !existing.updatedAt || Math.abs(stats.mtimeMs - existing.updatedAt) > 1000;

  // Scoped mode: only re-search comics previously recorded as no-match
  if (mode === 'unmatched' && !(existing && existing.tagStatus === 'failed')) {
    return { skip: true, reason: `➜ SKIPPED: Not previously marked no-match (${fileName})` };
  }

  // 1. If already scanned and tagged successfully, and file is not modified -> SKIP (unless forced)
  if (!bypassCoreGates && existing && !isModified && existing.tagStatus === 'successful') {
    return { skip: true, reason: `➜ SKIPPED: Already scanned and tagged (${fileName})` };
  }

  // 2. If the file on disk already contains complete metadata (Series, Publisher, Date, Number) -> ONLY skip if NOT forced
  const isAlreadyComplete = await checkFileSuccess(filePath);
  if (!bypassCoreGates && isAlreadyComplete) {
    try {
      const info = await metadata.getComicInfoFromArchive(filePath);
      await recordCompleteComic(filePath, fileName, info, existing, publisherCodex, stats);
      return { skip: true, isAlreadyComplete: true, reason: `✓ SUCCESS → Already contains complete metadata: ${fileName}` };
    } catch (err) {}
  }

  // Scoped mode: only re-scan comics that already carry a complete ComicInfo.xml
  if (mode === 'existing-xml' && !(isAlreadyComplete || (existing && existing.tagStatus === 'successful'))) {
    return { skip: true, reason: `➜ SKIPPED: No existing ComicInfo.xml (${fileName})` };
  }

  // 3. If previously scanned with no match and file has not been modified -> SKIP (unless forced)
  if (!bypassNoMatchGate && existing && !isModified && existing.tagStatus === 'failed') {
    return { skip: true, reason: `➜ SKIPPED: Previously scanned with no match (file unmodified) (${fileName})` };
  }

  return { skip: false, isAlreadyComplete };
}

module.exports = {
  SCAN_MODES,
  resolveScanMode,
  getScanScopeCounts,
  evaluateFileGates
};
