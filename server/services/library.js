const fs = require('fs');
const path = require('path');
const { listPages, getEntryBuffer } = require('./archive-utils');
const sharp = require('sharp');
const { spawn } = require('child_process');

const { dbGet, dbRun, dbAll, checkComicAccess } = require('../db');
const { log } = require('../logger');
const { getConfig, getComicsDirectories, getScanIntervalMs, getLibraries } = require('../config');
const { getComicInfoFromArchive } = require('./metadata');
const { createId, safeDirName, isImage, t0, ms } = require('../utils');
const {
  THUMBNAILS_DIRECTORY,
  TEMP_DIRECTORY,
  LOGOS_DIRECTORY,
  METADATA_MARKER_FILE,
  GUIDED_VIEW_DIR
} = require('../constants');

let isScanning = false;
let scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Idle' };
let scanTimeout = null;

async function findLogoFileIn(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const prefer = files.find(n => /^logo\./i.test(n) && (isImage(n) || n.toLowerCase().endsWith('.svg')));
    if (prefer) return prefer;

    const any = files.find(n => isImage(n) || n.toLowerCase().endsWith('.svg'));
    return any || null;
  } catch {
    return null;
  }
}

const LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const logoCache = new Map();

async function resolveLogo(pubLogoDir) {
  const now = Date.now();
  const cached = logoCache.get(pubLogoDir);
  if (cached && cached.expiresAt > now) {
    return { logoFile: cached.logoFile, needsBackground: cached.needsBackground };
  }
  const logoFile = await findLogoFileIn(pubLogoDir);
  let needsBackground = false;
  if (logoFile) {
    needsBackground = await logoNeedsBackground(path.join(pubLogoDir, logoFile));
  }
  logoCache.set(pubLogoDir, { logoFile, needsBackground, expiresAt: now + LOGO_CACHE_TTL_MS });
  return { logoFile, needsBackground };
}

async function logoNeedsBackground(fullPath) {
  try {
    const image = sharp(fullPath);
    const metadata = await image.metadata();
    if (!metadata || (metadata.format || '').toLowerCase() !== 'png') {
      return false;
    }
    if (!metadata.hasAlpha) {
      return false;
    }
    const stats = await image.clone().stats();
    const alphaChannel = Array.isArray(stats?.channels) ? stats.channels[stats.channels.length - 1] : null;
    if (!alphaChannel) {
      return false;
    }
    return alphaChannel.min < 255;
  } catch (err) {
    log('ERROR', 'LOGOS', `Failed to inspect logo ${fullPath}: ${err.message}`);
    return false;
  }
}

async function extractPageBuffer(comicPath, pageName) {
  try {
    return await getEntryBuffer(comicPath, pageName);
  } catch (err) {
    log('ERROR', 'LIBRARY', `Failed to extract page ${pageName}: ${err.message}`);
    return null;
  }
}

async function generateThumbnail(comicPath) {
  const id = createId(comicPath);
  const filename = `${id}.jpg`;
  const full = path.join(THUMBNAILS_DIRECTORY, filename);
  if (fs.existsSync(full)) {
    log('INFO', 'THUMBNAIL', `Skip (exists): ${filename}`);
    return filename;
  }

  const start = t0();
  let pages;
  try {
    pages = await getComicPages(comicPath);
  } catch (error) {
    log('ERROR', 'THUMBNAIL', `Failed to read pages from ${path.basename(comicPath)}: ${error.message}`);
    return null;
  }
  if (!pages || pages.length === 0) {
    log('ERROR', 'THUMBNAIL', `No images found in ${path.basename(comicPath)}`);
    return null;
  }

  const firstPage = pages[0];
  const buffer = await extractPageBuffer(comicPath, firstPage);
  
  if (!buffer) {
    log('ERROR', 'THUMBNAIL', `Failed to extract first page ${firstPage} from ${path.basename(comicPath)}`);
    return null;
  }

  try {
    log('INFO', 'THUMBNAIL', `Create → ${filename} (first page: ${firstPage})`);
    await sharp(buffer)
      .resize({ height: 300, withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toFile(full);
    
    log('INFO', 'THUMBNAIL', `✅ Generated: ${filename} in ${ms(start)} ms`);
    return filename;
  } catch (err) {
    log('ERROR', 'THUMBNAIL', `❌ Sharp fail (${path.basename(comicPath)}): ${err.message} after ${ms(start)} ms`);
    return null;
  }
}

async function convertCbrToCbz(cbrPath) {
  return new Promise((resolve) => {
    const start = t0();
    log('INFO', 'CONVERT', `Converting: ${path.basename(cbrPath)}`);
    const cbzPath = cbrPath.replace(/\.cbr$/i, '.cbz');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'convert_cbr_to_cbz.sh');
    const cbrDir = path.dirname(cbrPath);

    // Run the bash script from the directory containing the CBR file
    const conversionProcess = spawn(scriptPath, [cbrPath], {
      cwd: cbrDir,
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      timeout: 30 * 60 * 1000 // 30 minute timeout
    });

    let stdout = '';
    let stderr = '';
    let lastLog = Date.now();

    conversionProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;

      // Log progress every 5 seconds
      if (Date.now() - lastLog > 5000) {
        log('INFO', 'CONVERT', `Progress: ${path.basename(cbrPath)}`);
        lastLog = Date.now();
      }
    });

    conversionProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    conversionProcess.on('error', (err) => {
      if (err.code === 'ENOENT') {
        log('ERROR', 'CONVERT', `Conversion script not found: ${scriptPath}`);
        return resolve(null);
      }
      log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: ${err.message} after ${ms(start)} ms`);
      resolve(null);
    });

    conversionProcess.on('close', (code) => {
      if (code === 0) {
        // Check if CBZ file was created
        if (fs.existsSync(cbzPath)) {
          log('INFO', 'CONVERT', `✅ Created: ${path.basename(cbzPath)} in ${ms(start)} ms`);
          resolve(cbzPath);
        } else {
          log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: CBZ file not created after ${ms(start)} ms`);
          resolve(null);
        }
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
        log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: ${errorMsg} after ${ms(start)} ms`);
        resolve(null);
      }
    });
  });
}

async function convertPdfToCbz(pdfPath) {
  return new Promise((resolve) => {
    const start = t0();
    log('INFO', 'CONVERT', `Converting PDF: ${path.basename(pdfPath)}`);
    const cbzPath = pdfPath.replace(/\.pdf$/i, '.cbz');
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'pdf2cbz.sh');
    const pdfDir = path.dirname(pdfPath);

    // Run the bash script from the directory containing the PDF file
    const conversionProcess = spawn(scriptPath, [pdfPath], {
      cwd: pdfDir,
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      timeout: 30 * 60 * 1000 // 30 minute timeout
    });

    let stdout = '';
    let stderr = '';
    let lastLog = Date.now();

    conversionProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;

      // Log progress every 5 seconds
      if (Date.now() - lastLog > 5000) {
        log('INFO', 'CONVERT', `Progress: ${path.basename(pdfPath)}`);
        lastLog = Date.now();
      }
    });

    conversionProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    conversionProcess.on('error', (err) => {
      if (err.code === 'ENOENT') {
        log('ERROR', 'CONVERT', `Conversion script not found: ${scriptPath}`);
        return resolve(null);
      }
      log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: ${err.message} after ${ms(start)} ms`);
      resolve(null);
    });

    conversionProcess.on('close', (code) => {
      if (code === 0) {
        // Check if CBZ file was created
        if (fs.existsSync(cbzPath)) {
          log('INFO', 'CONVERT', `✅ Created: ${path.basename(cbzPath)} in ${ms(start)} ms`);
          resolve(cbzPath);
        } else {
          log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: CBZ file not created after ${ms(start)} ms`);
          resolve(null);
        }
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Script exited with code ${code}`;
        log('ERROR', 'CONVERT', `❌ Failed ${path.basename(pdfPath)}: ${errorMsg} after ${ms(start)} ms`);
        resolve(null);
      }
    });
  });
}

async function getComicPages(comicPath) {
  try {
    return await listPages(comicPath);
  } catch (err) {
    log('ERROR', 'LIBRARY', `Failed to list pages for ${path.basename(comicPath)}: ${err.message}`);
    return [];
  }
}

/**
 * Generates virtual metadata from folder structure and filename.
 * Used for libraries in 'folder' mode.
 */
function generateVirtualMetadata(filePath, libraryRootPath) {
  const relativePath = path.relative(libraryRootPath, filePath);
  const pathParts = relativePath.split(path.sep);
  const rootDirName = path.basename(libraryRootPath);

  // Publisher: Immediate subfolder of library root, or root folder name if at root
  let publisher = rootDirName;
  if (pathParts.length > 1) {
    publisher = pathParts[0];
  }

  // Series: Name of the parent folder of the comic file
  const parentDir = path.dirname(filePath);
  let series = rootDirName;
  if (path.normalize(parentDir) !== path.normalize(libraryRootPath)) {
    series = path.basename(parentDir);
  }

  const fileName = path.basename(filePath);
  const title = path.parse(fileName).name;

  // Issue: Attempt to parse a number from the filename
  let issue = "";
  
  // Try to find #123 or No. 123 first as they are very specific
  const specificMatch = title.match(/(?:#|No\.?)\s*(\d+)/i);
  if (specificMatch) {
    issue = specificMatch[1];
  } else {
    // Try to find a number at the end of the string (ignoring trailing whitespace)
    const endMatch = title.trim().match(/(\d+)$/);
    if (endMatch) {
      issue = endMatch[1];
    } else {
      // Fallback: standalone number
      const standaloneMatch = title.match(/(?:\D|^)(\d+)(?:\D|$)/);
      if (standaloneMatch) {
        issue = standaloneMatch[1];
      } else {
        // Absolute fallback: first number found
        const anyMatch = title.match(/(\d+)/);
        if (anyMatch) {
          issue = anyMatch[1];
        }
      }
    }
  }

  return {
    Publisher: publisher,
    Series: series,
    Title: title,
    Number: issue
  };
}

async function scanLibrary() {
  if (isScanning) {
    log('INFO', 'SCAN', 'Already scanning; skip.');
    return;
  }
  isScanning = true;

  try {
    if (fs.existsSync(TEMP_DIRECTORY)) {
      const now = Date.now();
      const entries = await fs.promises.readdir(TEMP_DIRECTORY);
      for (const entry of entries) {
        const tmpPath = path.join(TEMP_DIRECTORY, entry);
        let stats;
        try { stats = await fs.promises.stat(tmpPath); } catch { continue; }
        if (now - stats.mtimeMs > 86400000) {
          await fs.promises.rm(tmpPath, { recursive: true, force: true }).catch(() => {});
        }
      }
    }
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
    for (const file of files) {
      if (file.startsWith('.')) continue;
      let filePath = path.join(dir, file);
      let wasConverted = false;
      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) { await walkDir(filePath, libraryMode, libraryRootPath); continue; }
      
      const ext = path.extname(filePath).toLowerCase();
      const isCbz = ext === '.cbz';
      const isCbr = ext === '.cbr';
      const isPdf = ext === '.pdf';

      if (!dirModified) {
        if (isCbz || (isCbr && (allowedFormats === 'cbr' || allowedFormats === 'both'))) {
          fileSystemComics.add(filePath);
        }
        continue;
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
            else { errors++; continue; }
          } else {
            log('INFO', 'SCAN', `Skipping CBR: ${file} (Not allowed and outside conversionRoot)`);
            continue;
          }
        } else if (isPdf) {
          if (conversionRoot && path.resolve(filePath).startsWith(conversionRoot)) {
            log('INFO', 'SCAN', `PDF convert needed: ${file}`);
            const newCbz = await convertPdfToCbz(filePath);
            if (newCbz) { filePath = newCbz; wasConverted = true; totalConverted++; }
            else { errors++; continue; }
          } else {
            log('INFO', 'SCAN', `Skipping PDF convert outside comicsLocation: ${file}`);
            continue;
          }
        } else if (!isCbz) {
          continue;
        }

        // Final check if this specific format is allowed
        const finalExt = path.extname(filePath).toLowerCase();
        if (finalExt === '.cbz') {
          if (allowedFormats === 'cbr') continue; // Only CBR allowed
        } else if (finalExt === '.cbr') {
          if (allowedFormats === 'cbz') continue; // Only CBZ allowed
        } else {
          continue;
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
        if (guidedViewStatus !== 'completed') {
          const sidecarPath = path.join(GUIDED_VIEW_DIR, `${id}.json`);
          if (fs.existsSync(sidecarPath)) {
            guidedViewStatus = 'completed';
            guidedViewPath = sidecarPath;
            log('INFO', 'SCAN', `Reconnected guided-view sidecar: ${path.basename(filePath)}`);
          }
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
    }

    await dbRun('INSERT OR REPLACE INTO scan_dirs (dir, mtimeMs) VALUES (?, ?)', [dir, effectiveMtime]);
  };

  try {
    for (const lib of libraries) {
      const dir = lib.path;
      const mode = lib.hierarchyMode || 'metadata';
      const t = t0();
      log('INFO', 'SCAN', `Walk: ${dir} (Mode: ${mode})`);
      const reachable = await fs.promises.stat(dir).then(() => true).catch(() => false);
      if (!reachable) {
        unreachableTopDirs.push(dir);
        log('ERROR', 'SCAN', `Top-level scan dir unreachable, skipping: ${dir}`);
        continue;
      }
      await walkDir(dir, mode, dir);
      log('INFO', 'SCAN', `Walk done: ${dir} in ${ms(t)} ms`);
    }

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

async function buildLibrary(userId = 'default-user') {
  // Get user role to determine access level
  const user = await dbGet('SELECT role FROM users WHERE userId = ?', [userId]);
  const userRole = user?.role || 'user';

  // Get all comics and their per-user progress/status
  const rows = await dbAll('SELECT * FROM comics');
  log('INFO', 'SERVER', `Build library for UI with ${rows.length} rows for user ${userId} (role: ${userRole})`);

  // Get per-user progress and continuous mode for all comics in one query
  const userProgress = await dbAll(
    'SELECT comicId, lastReadPage, totalPages, continuousMode FROM user_comic_status WHERE userId = ?',
    [userId]
  );

  // Create maps for quick lookup
  const progressMap = {};
  const continuousModeMap = {};
  for (const p of userProgress) {
    progressMap[p.comicId] = { lastReadPage: p.lastReadPage, totalPages: p.totalPages };
    // continuousMode: 1 = true, null/0 = false (null means use default)
    if (p.continuousMode !== null && p.continuousMode !== undefined) {
      continuousModeMap[p.comicId] = p.continuousMode === 1;
    }
  }

  // User-level default for continuous mode — applied to any comic that has no
  // explicit per-comic preference recorded in user_comic_status.
  const continuousDefaultRow = await dbGet(
    `SELECT continuousModeDefault FROM user_settings WHERE userId = ? AND key = 'continuousMode'`,
    [userId]
  );
  const continuousDefault = !!(continuousDefaultRow && continuousDefaultRow.continuousModeDefault === 1);

  // Load all manga mode preferences for this user
  const { getMangaPrefMaps, resolveMangaMode } = require('../db');
  const prefMaps = await getMangaPrefMaps(userId);

  const lib = {};
  const directories = getComicsDirectories();
  const libraryConfigs = require('../config').getLibraries();

  // Pre-fetch access list once for the whole library build
  const accessList = userRole === 'admin' ? [] : await dbAll(
    `SELECT accessType, accessValue, direct_access, child_access
     FROM user_library_access
     WHERE userId = ? AND (direct_access = 1 OR child_access = 1)`,
    [userId]
  );

  for (const r of rows) {
    // Access control: Check if user has access to this comic using hierarchical access control
    // Admin has access to everything
    // For non-admin, check hierarchical access: root_folder -> publisher -> series
    const hasAccess = await checkComicAccess(
      userId,
      userRole,
      r.path,
      r.publisher,
      r.series,
      directories,
      r.id,
      accessList
    );

    if (!hasAccess) {
      continue; // User doesn't have access to this comic, skip it
    }

    // User has access to this comic, include it in the library
    const absoluteRootDir = directories.find(d => r.path.startsWith(d));
    const rootDirKey = require('../config').getLibraryIdFromPath(absoluteRootDir) || 'Library';

    if (!lib[rootDirKey]) {
      const config = libraryConfigs.find(c => c.path === absoluteRootDir);
      lib[rootDirKey] = { 
        publishers: {},
        hierarchyMode: config ? config.hierarchyMode : 'metadata'
      };
    }
    if (!lib[rootDirKey].publishers[r.publisher]) {
      lib[rootDirKey].publishers[r.publisher] = { logoUrl: null, logoNeedsBackground: false, series: {} };
    }
    if (!lib[rootDirKey].publishers[r.publisher].series[r.series]) {
      lib[rootDirKey].publishers[r.publisher].series[r.series] = [];
    }

    let fullMetadata = {};
    try {
      fullMetadata = JSON.parse(r.metadata || '{}');
    } catch {
      fullMetadata = {};
    }

    // Only include minimal metadata fields needed for display
    // Full metadata can be fetched via /api/v1/comics/info when needed
    const metadata = {
      Number: fullMetadata.Number || fullMetadata.Issue || fullMetadata.IssueNumber || fullMetadata.SortNumber || fullMetadata.AlternateNumber || '',
      Series: fullMetadata.Series || fullMetadata.SeriesName || fullMetadata.AlternateSeries || '',
      Title: fullMetadata.Title || fullMetadata.DisplayTitle || fullMetadata.SortName || fullMetadata.FullTitle || fullMetadata.StoryTitle || ''
    };

    // Use per-user progress if available, otherwise default to 0
    const progress = progressMap[r.id] || { lastReadPage: 0, totalPages: r.totalPages || 0 };

    // Apply hierarchical manga mode preference
    const mangaMode = resolveMangaMode(r.id, r.series, r.publisher, r.path, prefMaps, directories);

    // Per-comic preference wins; otherwise fall back to the user's default.
    const continuousMode = continuousModeMap[r.id] !== undefined ? continuousModeMap[r.id] : continuousDefault;

    // Redact absolute path: Replace absolute root with library ID
    const relativePath = path.relative(absoluteRootDir, r.path);
    const redactedPath = path.join(rootDirKey, relativePath);

    lib[rootDirKey].publishers[r.publisher].series[r.series].push({
      id: r.id,
      name: r.name,
      path: redactedPath,
      thumbnailPath: r.thumbnailPath || null,
      progress,
      updatedAt: r.updatedAt || null,
      convertedAt: r.convertedAt || null,
      metadata,
      series: r.series,
      publisher: r.publisher,
      mangaMode: mangaMode,
      continuousMode: continuousMode,
      guidedViewStatus: r.guidedViewStatus || 'pending',
      libraryMode: r.libraryMode,
      guidedMode: !!r.guidedMode, bubbleMode: !!r.bubbleMode,
      hotZoomMode: !!r.hotZoomMode, mangaBubbleHotMode: !!r.mangaBubbleHotMode,
      landscapeMode: !!r.landscapeMode,
      fullImageMode: !!r.fullImageMode
    });
  }

  for (const rootDir in lib) {
    for (const publisherName in lib[rootDir].publishers) {
      const folderName = safeDirName(publisherName);
      const pubLogoDir = path.join(LOGOS_DIRECTORY, folderName);
      const { logoFile, needsBackground } = await resolveLogo(pubLogoDir);

      if (logoFile) {
        lib[rootDir].publishers[publisherName].logoUrl =
          `logos/${encodeURIComponent(folderName)}/${encodeURIComponent(logoFile)}`;
        lib[rootDir].publishers[publisherName].logoNeedsBackground = needsBackground;
      } else {
        // Use default blank logo when no publisher logo exists
        lib[rootDir].publishers[publisherName].logoUrl = 'logos/6373148-blank.png';
        lib[rootDir].publishers[publisherName].logoNeedsBackground = false;
      }
    }
  }

  return lib;
}

module.exports = {
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  extractPageBuffer,
  generateVirtualMetadata,
  isScanning: () => isScanning
};
