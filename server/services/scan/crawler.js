const fs = require('fs');
const path = require('path');
const { dbGet, dbRun } = require('../../db');
const { log } = require('../../logger');
const {
  normalizePublisher,
  cleanDescription,
  splitVolumeSeriesAndTitle,
  isTitleSameAsSeries
} = require('../metadata');
const { pMap, trimObjectStrings } = require('../../utils');
const { METADATA_MARKER_FILE } = require('../../constants');
const { processScannedFile } = require('./file-processor');

/**
 * Normalizes metadata extracted from archive or folder hierarchy.
 */
function normalizeComicMetadata(info) {
  const cleanInfo = trimObjectStrings(info || {});
  if (cleanInfo.Publisher) {
    cleanInfo.Publisher = normalizePublisher(cleanInfo.Publisher);
  }
  if (cleanInfo.Summary) {
    cleanInfo.Summary = cleanDescription(cleanInfo.Summary);
  }
  const publisher = normalizePublisher(cleanInfo.Publisher || 'Unknown Publisher');
  let series = (cleanInfo.Series || cleanInfo.Title || 'Unknown Series').trim();
  let title = (cleanInfo.Title || '').trim();
  const volSplit = splitVolumeSeriesAndTitle(series, title);
  if (volSplit.series && volSplit.number) {
    series = volSplit.series;
    cleanInfo.Series = volSplit.series;
    cleanInfo.Title = volSplit.title;
    if (!cleanInfo.Number || cleanInfo.Number === '1' || cleanInfo.Number === '01') {
      cleanInfo.Number = volSplit.number;
    }
    if (!cleanInfo.Volume) {
      cleanInfo.Volume = volSplit.volume;
    }
  }
  if (!cleanInfo.Number && cleanInfo.Volume) {
    cleanInfo.Number = cleanInfo.Volume;
  }
  if (cleanInfo.Title && (isTitleSameAsSeries(cleanInfo.Title, cleanInfo.Series) || (!cleanInfo.Series && isTitleSameAsSeries(cleanInfo.Title, '')))) {
    cleanInfo.Title = '';
  }
  return { info: cleanInfo, series, publisher };
}

/**
 * Recursively walks a library directory and indexes comics into SQLite.
 */
async function walkLibraryDirectory({ dir, libraryMode, libraryRootPath, ctx }) {
  if (!fs.existsSync(dir)) {
    log('ERROR', 'SCAN', `Missing dir: ${dir}`);
    ctx.stats.subDirScanErrors++;
    return;
  }

  let dirStat;
  try {
    dirStat = await fs.promises.stat(dir);
  } catch {
    log('ERROR', 'SCAN', `Missing dir: ${dir}`);
    ctx.stats.subDirScanErrors++;
    return;
  }

  let effectiveMtime = dirStat.mtimeMs;
  try {
    const markerStat = await fs.promises.stat(path.join(dir, METADATA_MARKER_FILE));
    if (markerStat.isFile()) {
      effectiveMtime = Math.max(effectiveMtime, markerStat.mtimeMs);
    }
  } catch {}

  const cached = await dbGet('SELECT mtimeMs FROM scan_dirs WHERE dir = ?', [dir]);
  const dirModified = !cached || effectiveMtime > cached.mtimeMs;

  if (!dirModified) {
    log('INFO', 'SCAN', `Skipping unchanged dir: ${dir}`);
  }

  let files = [];
  try {
    files = await fs.promises.readdir(dir);
  } catch (e) {
    log('ERROR', 'SCAN', `Failed to read dir ${dir}: ${e.message}`);
    ctx.stats.subDirScanErrors++;
    return;
  }

  await pMap(files, async (file) => {
    const fileName = typeof file === 'string' ? file : (file?.name || String(file || ''));
    if (!fileName || fileName.startsWith('.')) return;
    let filePath = path.join(dir, fileName);
    let wasConverted = false;
    let originalSourcePath = null;
    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch {
      return;
    }

    if (stats.isDirectory()) {
      await walkLibraryDirectory({ dir: filePath, libraryMode, libraryRootPath, ctx });
      return;
    }

    await processScannedFile({
      filePath,
      stats,
      dirModified,
      libraryMode,
      libraryRootPath,
      ctx,
      normalizeComicMetadata
    });
  }, 5);

  await dbRun('INSERT OR REPLACE INTO scan_dirs (dir, mtimeMs) VALUES (?, ?)', [dir, effectiveMtime]);
}

module.exports = {
  walkLibraryDirectory
};
