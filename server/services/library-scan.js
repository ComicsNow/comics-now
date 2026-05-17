const fs = require('fs');
const path = require('path');
const { dbGet, dbRun, dbAll } = require('../db');
const { log } = require('../logger');
const { getConfig, getScanIntervalMs, getLibraries } = require('../config');
const { getComicInfoFromArchive } = require('./metadata');
const { createId, t0, ms, pMap } = require('../utils');
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

async function scanLibrary() {
  if (isScanning) {
    log('INFO', 'SCAN', 'Already scanning; skip.');
    return;
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

  const libraries = getLibraries();
  const config = getConfig();
  const allowedFormats = config.allowed_formats || 'cbz';
  log('INFO', 'SCAN', `Starting scan… Libraries: ${libraries.length > 0 ? libraries.map(l => `${l.path} (${l.hierarchyMode})`).join(', ') : '(none set)'} | Allowed Formats: ${allowedFormats}`);
  const fileSystemComics = new Set();
  const dbComics = await dbAll('SELECT path, thumbnailPath FROM comics');
  const dbComicsMap = new Map(dbComics.map(c => [c.path, c.thumbnailPath]));
  const conversionRoot = config.comicsLocation ? path.resolve(config.comicsLocation) : null;
  const unreachableTopDirs = [];

  const walkDir = async (dir, libraryMode, libraryRootPath) => {
    if (!fs.existsSync(dir)) {
      log('ERROR', 'SCAN', `Missing dir: ${dir}`);
      return;
    }

    let dirStat;
    try {
      dirStat = await fs.promises.stat(dir);
    } catch {
      log('ERROR', 'SCAN', `Missing dir: ${dir}`);
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

    const files = await fs.promises.readdir(dir);
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

        totalSeen++;
        log('INFO', 'SCAN', `📄 Processing: ${path.basename(filePath)} (${libraryMode} mode)`);
        fileSystemComics.add(filePath);
        const id = createId(filePath);
        const existing = await dbGet('SELECT metadata, lastReadPage, totalPages, convertedAt, guidedViewStatus, guidedViewPath, guidedViewError FROM comics WHERE id = ?', [id]);
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

        // Get metadata: either from Zip or from folder structure
        let info;
        if (libraryMode === 'folder') {
          info = generateVirtualMetadata(filePath, libraryRootPath);
        } else {
          info = await getComicInfoFromArchive(filePath);
          
          // For CBR: preserve DB-only metadata if internal archive is empty
          if (ext === '.cbr' && (!info || Object.keys(info).length === 0)) {
            if (existing?.metadata) {
              try {
                info = JSON.parse(existing.metadata);
                log('INFO', 'SCAN', `Preserving DB-only metadata for CBR: ${path.basename(filePath)}`);
              } catch {
                info = {};
              }
            }
          }
        }

        const publisher = info.Publisher || 'Unknown Publisher';
        const series = info.Series || 'Unknown Series';
        const newStats = await fs.promises.stat(filePath);

        try {
          const pages = await getComicPages(filePath);
          if (pages.length > 0) totalPages = pages.length;
        } catch {}

        await dbRun(
          `INSERT OR REPLACE INTO comics (id, path, thumbnailPath, updatedAt, name, series, publisher, metadata, lastReadPage, totalPages, convertedAt, guidedViewStatus, guidedViewPath, guidedViewError, libraryMode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            filePath,
            thumbnailPath,
            newStats.mtimeMs,
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
            libraryMode
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

    // Safety guard: never wipe comics when any top-level scan dir was unreachable.
    const toDelete = Array.from(dbComicsMap.keys()).filter(p => !fileSystemComics.has(p));

    if (unreachableTopDirs.length > 0) {
      log('ERROR', 'SCAN', `Aborting stale-comic cleanup: ${unreachableTopDirs.length} top-level dir(s) unreachable: ${unreachableTopDirs.join(', ')}. Would have deleted ${toDelete.length} comics.`);
    } else {
      for (const p of toDelete) {
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
