const fs = require('fs');
const path = require('path');
const { dbGet, dbRun } = require('../../db');
const { log } = require('../../logger');
const { getConfig } = require('../../config');
const {
  getComicInfoFromArchive,
  normalizePublisher,
  cleanDescription,
  splitVolumeSeriesAndTitle,
  isTitleSameAsSeries
} = require('../metadata');
const { createId, pMap, trimObjectStrings } = require('../../utils');
const {
  THUMBNAILS_DIRECTORY,
  METADATA_MARKER_FILE,
  GUIDED_VIEW_DIR
} = require('../../constants');

const { convertCbrToCbz, convertPdfToCbz } = require('../library-conversion');
const { getComicPages, generateThumbnail } = require('../library-pages');
const { generateVirtualMetadata } = require('../library-metadata');

/**
 * Reconciles guided-view status and sidecar paths for a comic archive.
 */
async function reconcileGuidedView(id, filePath, existing, dbComicsMap) {
  let guidedViewStatus = existing?.guidedViewStatus || 'pending';
  let guidedViewPath = existing?.guidedViewPath || null;
  const guidedViewError = existing?.guidedViewError || null;
  const sidecarPath = path.join(GUIDED_VIEW_DIR, `${id}.json`);

  if (guidedViewStatus === 'completed') {
    if (!fs.existsSync(sidecarPath)) {
      guidedViewStatus = 'pending';
      guidedViewPath = null;
    }
  } else if (fs.existsSync(sidecarPath)) {
    guidedViewStatus = 'completed';
    guidedViewPath = sidecarPath;
    log('INFO', 'SCAN', `Reconnected guided-view sidecar: ${path.basename(filePath)}`);
  } else {
    // If moved outside the app, check if a missing comic record has an existing sidecar to migrate
    const baseName = path.basename(filePath);
    for (const [oldPath, oldRec] of dbComicsMap.entries()) {
      if (path.basename(oldPath) === baseName && oldRec.id !== id && !fs.existsSync(oldPath)) {
        const oldSidecar = path.join(GUIDED_VIEW_DIR, `${oldRec.id}.json`);
        if (fs.existsSync(oldSidecar)) {
          try {
            try {
              const raw = await fs.promises.readFile(oldSidecar, 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && parsed.pages) {
                parsed.comicId = id;
                await fs.promises.writeFile(sidecarPath, JSON.stringify(parsed, null, 2), 'utf8');
                if (oldSidecar !== sidecarPath && fs.existsSync(oldSidecar)) {
                  try { await fs.promises.unlink(oldSidecar); } catch (_) {}
                }
              } else {
                await fs.promises.rename(oldSidecar, sidecarPath);
              }
            } catch (_) {
              await fs.promises.rename(oldSidecar, sidecarPath);
            }
            guidedViewStatus = 'completed';
            guidedViewPath = sidecarPath;
            log('INFO', 'SCAN', `Migrated moved comic guided-view sidecar: ${baseName}`);
            break;
          } catch (_) {}
        }
      }
    }
  }

  return { guidedViewStatus, guidedViewPath, guidedViewError };
}

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

    const ext = path.extname(filePath).toLowerCase();
    const isCbz = ext === '.cbz';
    const isCbr = ext === '.cbr';
    const isPdf = ext === '.pdf';

    if (!dirModified) {
      if (isCbz || (isCbr && (ctx.allowedFormats === 'cbr' || ctx.allowedFormats === 'both'))) {
        ctx.fileSystemComics.add(filePath);
      }
      return;
    }

    try {
      if (isCbr) {
        if (ctx.allowedFormats === 'cbr' || ctx.allowedFormats === 'both') {
          log('INFO', 'SCAN', `📄 CBR (Native): ${path.basename(filePath)}`);
        } else if (ctx.conversionRoot && path.resolve(filePath).startsWith(ctx.conversionRoot)) {
          log('INFO', 'SCAN', `Convert needed: ${file}`);
          const newCbz = await convertCbrToCbz(filePath);
          if (newCbz) { filePath = newCbz; wasConverted = true; ctx.stats.totalConverted++; }
          else { ctx.stats.errors++; return; }
        } else {
          log('INFO', 'SCAN', `Skipping CBR: ${file} (Not allowed and outside conversionRoot)`);
          return;
        }
      } else if (isPdf) {
        if (ctx.conversionRoot && path.resolve(filePath).startsWith(ctx.conversionRoot)) {
          log('INFO', 'SCAN', `PDF convert needed: ${file}`);
          const newCbz = await convertPdfToCbz(filePath);
          if (newCbz) { filePath = newCbz; wasConverted = true; ctx.stats.totalConverted++; }
          else { ctx.stats.errors++; return; }
        } else {
          log('INFO', 'SCAN', `Skipping PDF convert outside comicsLocation: ${file}`);
          return;
        }
      } else if (!isCbz) {
        return;
      }

      const finalExt = path.extname(filePath).toLowerCase();
      if (finalExt === '.cbz') {
        if (ctx.allowedFormats === 'cbr') return;
      } else if (finalExt === '.cbr') {
        if (ctx.allowedFormats === 'cbz') return;
      } else {
        return;
      }

      ctx.fileSystemComics.add(filePath);
      const id = createId(filePath);
      const existing = await dbGet('SELECT updatedAt, thumbnailPath, metadata, lastReadPage, totalPages, convertedAt, guidedViewStatus, guidedViewPath, guidedViewError, tagStatus FROM comics WHERE id = ?', [id]);
      const hasValidThumbnail = Boolean(existing?.thumbnailPath && fs.existsSync(path.join(THUMBNAILS_DIRECTORY, existing.thumbnailPath)));

      if (!ctx.force && !wasConverted && existing && existing.updatedAt === stats.mtimeMs && hasValidThumbnail) {
        return;
      }

      ctx.stats.totalSeen++;
      log('INFO', 'SCAN', `📄 Processing: ${path.basename(filePath)} (${libraryMode} mode)`);
      const lastReadPage = existing?.lastReadPage || 0;
      let totalPages = existing?.totalPages || 0;
      const convertedAt = wasConverted ? Date.now() : (existing?.convertedAt || null);

      const { guidedViewStatus, guidedViewPath, guidedViewError } = await reconcileGuidedView(id, filePath, existing, ctx.dbComicsMap);

      let thumbnailPath;
      try {
        thumbnailPath = await generateThumbnail(filePath);
        if (thumbnailPath) ctx.stats.thumbOk++; else ctx.stats.thumbFail++;
      } catch (e) {
        ctx.stats.thumbFail++;
        throw e;
      }

      const configObj = getConfig();
      const comicsLocation = configObj.comicsLocation;
      const isInboxFile = comicsLocation && filePath.startsWith(comicsLocation);
      const effectiveLibraryMode = isInboxFile ? 'metadata' : libraryMode;

      let info;
      if (effectiveLibraryMode === 'folder') {
        info = generateVirtualMetadata(filePath, libraryRootPath);
      } else {
        info = await getComicInfoFromArchive(filePath);
        const storageMode = getConfig().metadata_storage || 'archive';
        if ((storageMode === 'db' || storageMode === 'sidecar' || ext === '.cbr') && (!info || Object.keys(info).length === 0)) {
          if (existing?.metadata) {
            try {
              info = JSON.parse(existing.metadata);
              log('INFO', 'SCAN', `Preserving DB-only metadata for ${ext.toUpperCase()}: ${path.basename(filePath)}`);
            } catch {
              info = {};
            }
          }
        }
      }

      const { info: cleanInfo, series, publisher } = normalizeComicMetadata(info);
      const fileStats = wasConverted ? await fs.promises.stat(filePath) : stats;

      try {
        const pages = await getComicPages(filePath);
        if (pages.length > 0) totalPages = pages.length;
      } catch {}

      let tagStatus = wasConverted ? 'pending' : (existing?.tagStatus || 'pending');
      if (effectiveLibraryMode !== 'folder') {
        const hasSeries = ((cleanInfo.Series || '').toString().trim().length > 0) || ((cleanInfo.Title || '').toString().trim().length > 0);
        const hasPublisher = (cleanInfo.Publisher || '').toString().trim().length > 0;
        const hasDate = (cleanInfo.Year || cleanInfo.CoverDate || cleanInfo.StoreDate || cleanInfo['Cover Date'] || cleanInfo['Store Date'] || '').toString().trim().length > 0;
        const hasNumber = (cleanInfo.Number || cleanInfo.Volume || '').toString().trim().length > 0;

        if (hasSeries && hasPublisher && hasDate && hasNumber) {
          tagStatus = 'successful';
        } else {
          tagStatus = wasConverted ? 'pending' : (existing?.tagStatus || 'pending');
        }
      }

      await dbRun(
        `INSERT OR REPLACE INTO comics (id, path, thumbnailPath, updatedAt, name, series, publisher, metadata, lastReadPage, totalPages, convertedAt, guidedViewStatus, guidedViewPath, guidedViewError, libraryMode, tagStatus)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          filePath,
          thumbnailPath,
          fileStats.mtimeMs,
          path.basename(filePath),
          series,
          publisher,
          JSON.stringify(cleanInfo),
          lastReadPage,
          totalPages,
          convertedAt,
          guidedViewStatus,
          guidedViewPath,
          guidedViewError,
          effectiveLibraryMode,
          tagStatus
        ]
      );
      ctx.stats.totalInsertedOrUpdated++;
      if (!existing && guidedViewStatus === 'pending') {
        ctx.newComicIds.push(id);
      }
    } catch (e) {
      ctx.stats.errors++;
      log('ERROR', 'SCAN', `Failed to process ${path.basename(filePath)}: ${e.message}`);
    }
  }, 5);

  await dbRun('INSERT OR REPLACE INTO scan_dirs (dir, mtimeMs) VALUES (?, ?)', [dir, effectiveMtime]);
}

module.exports = {
  walkLibraryDirectory
};
