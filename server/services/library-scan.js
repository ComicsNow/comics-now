const fs = require('fs');
const path = require('path');
const { dbGet, dbRun, dbAll } = require('../db');
const { log } = require('../logger');
const { getConfig, getScanIntervalMs, getLibraries } = require('../config');
const { getComicInfoFromArchive, normalizePublisher, cleanDescription, splitVolumeSeriesAndTitle } = require('./metadata');
const { createId, t0, ms, pMap, trimObjectStrings } = require('../utils');
const {
  THUMBNAILS_DIRECTORY,
  METADATA_MARKER_FILE,
  GUIDED_VIEW_DIR
} = require('../constants');

const { convertCbrToCbz, convertPdfToCbz } = require('./library-conversion');
const { getComicPages, generateThumbnail } = require('./library-pages');
const { generateVirtualMetadata } = require('./library-metadata');

let isScanning = false;
let scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Idle' };
let scanTimeout = null;

async function scanLibrary(force = false) {
  if (isScanning) {
    log('INFO', 'SCAN', 'Already scanning; skip.');
    return;
  }
  if (!force) {
    try {
      const tagger = require('./tagger');
      if (tagger.isTaggerRunning && tagger.isTaggerRunning()) {
        log('INFO', 'SCAN', 'Scan skipped: Tag Comics Now is actively running.');
        return;
      }
    } catch (_) {}
  }
  isScanning = true;

  try {
    // ... no temp cleanup needed
  } catch (err) {
    log('ERROR', 'SCAN', `Temp cleanup failed: ${err.message}`);
  }

  const startScan = t0();
  let totalSeen = 0, totalInsertedOrUpdated = 0, totalConverted = 0, thumbOk = 0, thumbFail = 0, errors = 0;
  scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Starting' };

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
  const dbComics = await dbAll('SELECT path, thumbnailPath FROM comics');
  const dbComicsMap = new Map(dbComics.map(c => [c.path, c.thumbnailPath]));
  const conversionRoot = config.comicsLocation ? path.resolve(config.comicsLocation) : null;
  const unreachableTopDirs = [];
  let subDirScanErrors = 0;

  const walkDir = async (dir, libraryMode, libraryRootPath) => {
    if (!fs.existsSync(dir)) {
      log('ERROR', 'SCAN', `Missing dir: ${dir}`);
      subDirScanErrors++;
      return;
    }

    let dirStat;
    try {
      dirStat = await fs.promises.stat(dir);
    } catch {
      log('ERROR', 'SCAN', `Missing dir: ${dir}`);
      subDirScanErrors++;
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
      subDirScanErrors++;
      return;
    }
    await pMap(files, async (file) => {
      if (file.startsWith('.')) return;
      let filePath = path.join(dir, file);
      let wasConverted = false;
      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch {
        return;
      }

      if (stats.isDirectory()) {
        await walkDir(filePath, libraryMode, libraryRootPath);
        return;
      }
      
      const ext = path.extname(filePath).toLowerCase();
      const isCbz = ext === '.cbz';
      const isCbr = ext === '.cbr';
      const isPdf = ext === '.pdf';

      if (!dirModified) {
        if (isCbz || (isCbr && (allowedFormats === 'cbr' || allowedFormats === 'both'))) {
          fileSystemComics.add(filePath);
        }
        return;
      }

      try {
        if (isCbr) {
          // If CBR is explicitly allowed, skip conversion and add as is
          if (allowedFormats === 'cbr' || allowedFormats === 'both') {
            log('INFO', 'SCAN', `📄 CBR (Native): ${path.basename(filePath)}`);
          } else if (conversionRoot && path.resolve(filePath).startsWith(conversionRoot)) {
            log('INFO', 'SCAN', `Convert needed: ${file}`);
            const newCbz = await convertCbrToCbz(filePath);
            if (newCbz) { filePath = newCbz; wasConverted = true; totalConverted++; }
            else { errors++; return; }
          } else {
            log('INFO', 'SCAN', `Skipping CBR: ${file} (Not allowed and outside conversionRoot)`);
            return;
          }
        } else if (isPdf) {
          if (conversionRoot && path.resolve(filePath).startsWith(conversionRoot)) {
            log('INFO', 'SCAN', `PDF convert needed: ${file}`);
            const newCbz = await convertPdfToCbz(filePath);
            if (newCbz) { filePath = newCbz; wasConverted = true; totalConverted++; }
            else { errors++; return; }
          } else {
            log('INFO', 'SCAN', `Skipping PDF convert outside comicsLocation: ${file}`);
            return;
          }
        } else if (!isCbz) {
          return;
        }

        // Final check if this specific format is allowed
        const finalExt = path.extname(filePath).toLowerCase();
        if (finalExt === '.cbz') {
          if (allowedFormats === 'cbr') return; // Only CBR allowed
        } else if (finalExt === '.cbr') {
          if (allowedFormats === 'cbz') return; // Only CBZ allowed
        } else {
          return;
        }

        fileSystemComics.add(filePath);
        const id = createId(filePath);
        const existing = await dbGet('SELECT updatedAt, thumbnailPath, metadata, lastReadPage, totalPages, convertedAt, guidedViewStatus, guidedViewPath, guidedViewError, tagStatus FROM comics WHERE id = ?', [id]);
        const hasValidThumbnail = Boolean(existing?.thumbnailPath && fs.existsSync(path.join(THUMBNAILS_DIRECTORY, existing.thumbnailPath)));

        if (!force && !wasConverted && existing && existing.updatedAt === stats.mtimeMs && hasValidThumbnail) {
          return;
        }

        totalSeen++;
        log('INFO', 'SCAN', `📄 Processing: ${path.basename(filePath)} (${libraryMode} mode)`);
        const lastReadPage = existing?.lastReadPage || 0;
        let totalPages = existing?.totalPages || 0;
        const convertedAt = wasConverted ? Date.now() : (existing?.convertedAt || null);

        // Reconcile guided-view fields: prefer existing DB values; otherwise
        // detect an orphan sidecar JSON on disk and link it back.
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
        }

        let thumbnailPath;
        try {
          thumbnailPath = await generateThumbnail(filePath);
          if (thumbnailPath) thumbOk++; else thumbFail++;
        } catch (e) {
          thumbFail++;
          throw e;
        }

        const configObj = getConfig();
        const comicsLocation = configObj.comicsLocation;
        const isInboxFile = comicsLocation && filePath.startsWith(comicsLocation);
        const effectiveLibraryMode = isInboxFile ? 'metadata' : libraryMode;

        // Get metadata: either from Zip or from folder structure
        let info;
        if (effectiveLibraryMode === 'folder') {
          info = generateVirtualMetadata(filePath, libraryRootPath);
        } else {
          info = await getComicInfoFromArchive(filePath);
          // For CBR, DB-only, or sidecar storage mode: preserve DB-only metadata if internal archive is empty
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

        info = trimObjectStrings(info || {});
        if (info.Publisher) {
          info.Publisher = normalizePublisher(info.Publisher);
        }
        if (info.Summary) {
          info.Summary = cleanDescription(info.Summary);
        }
        const publisher = normalizePublisher(info.Publisher || 'Unknown Publisher');
        let series = (info.Series || info.Title || 'Unknown Series').trim();
        let title = (info.Title || '').trim();
        const volSplit = splitVolumeSeriesAndTitle(series, title);
        if (volSplit.series && volSplit.number) {
          series = volSplit.series;
          info.Series = volSplit.series;
          info.Title = volSplit.title;
          if (!info.Number || info.Number === '1' || info.Number === '01') {
            info.Number = volSplit.number;
          }
          if (!info.Volume) {
            info.Volume = volSplit.volume;
          }
        }
        const fileStats = wasConverted ? await fs.promises.stat(filePath) : stats;

        try {
          const pages = await getComicPages(filePath);
          if (pages.length > 0) totalPages = pages.length;
        } catch {}

        let tagStatus = wasConverted ? 'pending' : (existing?.tagStatus || 'pending');
        if (effectiveLibraryMode !== 'folder') {
          const hasSeries = ((info.Series || '').toString().trim().length > 0) || ((info.Title || '').toString().trim().length > 0);
          const hasPublisher = (info.Publisher || '').toString().trim().length > 0;
          const hasDate = (info.Year || info.CoverDate || info.StoreDate || info['Cover Date'] || info['Store Date'] || '').toString().trim().length > 0;
          const hasNumber = (info.Number || '').toString().trim().length > 0;

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
            JSON.stringify(info),
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
        totalInsertedOrUpdated++;
      } catch (e) {
        errors++;
        log('ERROR', 'SCAN', `Failed to process ${path.basename(filePath)}: ${e.message}`);
      }
    }, 5);

    await dbRun('INSERT OR REPLACE INTO scan_dirs (dir, mtimeMs) VALUES (?, ?)', [dir, effectiveMtime]);
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
      await walkDir(dir, mode, dir);
      log('INFO', 'SCAN', `Walk done: ${dir} in ${ms(t)} ms`);
    }, 2); // Concurrency 2 for top-level libraries to avoid too much IO thrashing

    // Safety guard: never wipe comics when any scan dir was unreachable or encountered errors.
    const toDelete = Array.from(dbComicsMap.keys()).filter(p => !fileSystemComics.has(p));

    if (unreachableTopDirs.length > 0 || subDirScanErrors > 0) {
      log('ERROR', 'SCAN', `Aborting stale-comic cleanup: ${unreachableTopDirs.length} top-level dir(s) unreachable, ${subDirScanErrors} subfolder error(s). Would have deleted ${toDelete.length} comics.`);
    } else {
      for (const p of toDelete) {
        // Critical safeguard: verify file is actually gone from filesystem before deleting from DB
        if (fs.existsSync(p)) {
          log('WARN', 'SCAN', `Safeguard: preserving comic that exists on disk but was missed in scan: ${path.basename(p)}`);
          continue;
        }
        const thumb = dbComicsMap.get(p);
        log('INFO', 'SCAN', `Removing missing comic: ${path.basename(p)}`);
        await dbRun('DELETE FROM comics WHERE path = ?', [p]);
        if (thumb) {
          const full = path.join(THUMBNAILS_DIRECTORY, thumb);
          if (fs.existsSync(full)) {
            await fs.promises.unlink(full).catch(() => {});
            log('INFO', 'SCAN', `Deleted orphan thumbnail: ${thumb}`);
          }
        }
      }
    }

    // Repair any comics in database that lack a thumbnail or whose thumbnail file was lost
    try {
      const missingThumbs = await dbAll(
        "SELECT id, path, thumbnailPath FROM comics WHERE thumbnailPath IS NULL OR thumbnailPath = ''"
      );
      for (const item of missingThumbs) {
        if (fs.existsSync(item.path)) {
          const gen = await generateThumbnail(item.path);
          if (gen) {
            await dbRun("UPDATE comics SET thumbnailPath = ? WHERE id = ?", [gen, item.id]);
            thumbOk++;
            log('INFO', 'THUMBNAIL', `Restored missing thumbnail for: ${path.basename(item.path)}`);
          } else {
            thumbFail++;
          }
        }
      }
    } catch (repairErr) {
      log('ERROR', 'SCAN', `Error repairing missing thumbnails: ${repairErr.message}`);
    }
  } catch (e) {
    log('ERROR', 'SCAN', `Scan error: ${e.message}`);
  }
  isScanning = false;
  scanProgress.status = 'Idle';
  log('INFO', 'SCAN', `Scan complete in ${ms(startScan)} ms. Seen: ${totalSeen}, Upserted: ${totalInsertedOrUpdated}, Converted: ${totalConverted}, Thumbs: ${thumbOk} ok / ${thumbFail} fail, Errors: ${errors}`);

  // Notify guided reader so it can auto-process new comics if that setting is enabled.
  // Lazy require avoids a circular dependency at module-load time.
  try {
    const guidedReader = require('./guided-reader');
    guidedReader.onLibraryScanComplete().catch(err =>
      log('ERROR', 'GUIDED', `onLibraryScanComplete failed: ${err.message}`)
    );
  } catch (err) {
    log('ERROR', 'GUIDED', `Could not notify guided reader: ${err.message}`);
  }
}

function scheduleNextScan() {
  if (scanTimeout) clearTimeout(scanTimeout);
  const interval = getScanIntervalMs();
  scanTimeout = setTimeout(async () => {
    await scanLibrary();
    scheduleNextScan();
  }, interval);
}

module.exports = {
  scanLibrary,
  scheduleNextScan,
  isScanning: () => isScanning
};
