const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const sharp = require('sharp');
const { spawn } = require('child_process');
const archiver = require('archiver');

const { dbGet, dbRun, dbAll } = require('../db');
const { log, t0, ms } = require('../logger');
const { getConfig, getComicsDirectories, getScanIntervalMs } = require('../config');
const { getComicInfoFromZip } = require('./metadata');
const { createId, safeDirName } = require('../utils');
const {
  THUMBNAILS_DIRECTORY,
  TEMP_DIRECTORY,
  LOGOS_DIRECTORY,
  METADATA_MARKER_FILE
} = require('../constants');

let isScanning = false;
let scanProgress = { totalFiles: 0, scannedFiles: 0, status: 'Idle' };
let scanTimeout = null;

async function findLogoFileIn(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => e.name);

    const prefer = files.find(n => /^logo\.(png|jpe?g|webp|gif|svg)$/i.test(n));
    if (prefer) return prefer;

    const any = files.find(n => /\.(png|jpe?g|webp|gif|svg)$/i.test(n));
    return any || null;
  } catch {
    return null;
  }
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

async function generateThumbnail(comicPath) {
  const id = createId(comicPath);
  const filename = `${id}.jpg`;
  const full = path.join(THUMBNAILS_DIRECTORY, filename);
  if (fs.existsSync(full)) {
    log('INFO', 'THUMBNAIL', `Skip (exists): ${filename}`);
    return filename;
  }

  return new Promise((resolve) => {
    const start = t0();
    yauzl.open(comicPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        log('ERROR', 'THUMBNAIL', `Open ${path.basename(comicPath)} failed: ${err.message}`);
        return resolve(null);
      }
      let done = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (done) return;
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(entry.fileName) && !entry.fileName.startsWith('__MACOSX')) {
          done = true;
          zipfile.openReadStream(entry, (e, rs) => {
            if (e) {
              zipfile.close();
              log('ERROR', 'THUMBNAIL', `Stream error: ${e.message}`);
              return resolve(null);
            }
            const chunks = [];
            rs.on('data', c => chunks.push(c));
            rs.on('end', async () => {
              zipfile.close();
              try {
                log('INFO', 'THUMBNAIL', `Create → ${filename} (first image: ${entry.fileName})`);
                await sharp(Buffer.concat(chunks))
                  .resize({ height: 300, withoutEnlargement: true })
                  .jpeg({ quality: 80, progressive: true })
                  .toFile(full);
                log('INFO', 'THUMBNAIL', `✅ Generated: ${filename} in ${ms(start)} ms`);
                resolve(filename);
              } catch (se) {
                log('ERROR', 'THUMBNAIL', `❌ Sharp fail (${path.basename(comicPath)}): ${se.message} after ${ms(start)} ms`);
                resolve(null);
              }
            });
          });
        } else zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (!done) {
          log('ERROR', 'THUMBNAIL', `No images found in ${path.basename(comicPath)}`);
          resolve(null);
        }
      });
      zipfile.on('error', () => {
        if (!done) {
          resolve(null);
        }
      });
    });
  });
}

async function convertCbrToCbz(cbrPath) {
  return new Promise(async (resolve) => {
    const start = t0();
    log('INFO', 'CONVERT', `Converting: ${path.basename(cbrPath)}`);
    const cbzPath = cbrPath.replace(/\.cbr$/i, '.cbz');
    const tempDir = path.join(path.dirname(cbrPath), `.tmp-${createId(cbrPath)}`);
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      await fs.promises.mkdir(tempDir, { recursive: true });

      log('INFO', 'CONVERT', `Unrar → ${path.basename(cbrPath)} …`);
      await new Promise((ok, bad) => {
        const unrar = spawn('unrar', ['x', '-o+', cbrPath, `${tempDir}${path.sep}`]);
        let stderr = '';
        unrar.stderr.on('data', d => { stderr += d.toString(); });
        unrar.on('error', (err) => {
          if (err.code === 'ENOENT') {
            return bad(new Error("'unrar' command not found. Install it to enable CBR conversion."));
          }
          return bad(err);
        });
        unrar.on('close', (code) => {
          if (code !== 0) {
            const msg = stderr.trim() || `unrar exited with code ${code}`;
            return bad(new Error(msg));
          }
          ok();
        });
      });

      log('INFO', 'CONVERT', `Zip → ${path.basename(cbzPath)} …`);
      const output = fs.createWriteStream(cbzPath);
      const archive = archiver('zip', { store: true });
      archive.on('error', (err) => { throw err; });
      archive.pipe(output);
      archive.directory(tempDir, false);
      await archive.finalize();

      output.on('close', async () => {
        log('INFO', 'CONVERT', `✅ Created: ${path.basename(cbzPath)} in ${ms(start)} ms`);
        await fs.promises.unlink(cbrPath).catch(() => {});
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        resolve(cbzPath);
      });
    } catch (e) {
      log('ERROR', 'CONVERT', `❌ Failed ${path.basename(cbrPath)}: ${e.message} after ${ms(start)} ms`);
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      resolve(null);
    }
  });
}

function getComicPages(comicPath) {
  return new Promise((resolve) => {
    yauzl.open(comicPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return resolve([]);
      const images = [];
      zipfile.readEntry();
      zipfile.on('entry', entry => {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(entry.fileName) && !entry.fileName.startsWith('__MACOSX')) {
          images.push(entry.fileName);
        }
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        images.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        resolve(images);
      });
      zipfile.on('error', () => resolve([]));
    });
  });
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

  const directories = getComicsDirectories();
  const config = getConfig();
  log('INFO', 'SCAN', `Starting scan… Directories: ${directories.length > 0 ? directories.join(', ') : '(none set)'}`);
  const fileSystemComics = new Set();
  const dbComics = await dbAll('SELECT path, thumbnailPath FROM comics');
  const dbComicsMap = new Map(dbComics.map(c => [c.path, c.thumbnailPath]));
  const conversionRoot = config.comicsLocation ? path.resolve(config.comicsLocation) : null;

  const walkDir = async (dir) => {
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
      for (const p of dbComicsMap.keys()) {
        if (p.startsWith(dir)) fileSystemComics.add(p);
      }
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

      if (stats.isDirectory()) { await walkDir(filePath); continue; }
      if (!dirModified) continue;

      try {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.cbr') {
          if (conversionRoot && path.resolve(filePath).startsWith(conversionRoot)) {
            log('INFO', 'SCAN', `Convert needed: ${file}`);
            const newCbz = await convertCbrToCbz(filePath);
            if (newCbz) { filePath = newCbz; wasConverted = true; totalConverted++; }
            else { errors++; continue; }
          } else {
            log('INFO', 'SCAN', `Skipping convert outside comicsLocation: ${file}`);
            continue;
          }
        }
        if (path.extname(filePath).toLowerCase() !== '.cbz') continue;

        totalSeen++;
        log('INFO', 'SCAN', `📄 CBZ: ${path.basename(filePath)}`);
        fileSystemComics.add(filePath);
        const id = createId(filePath);
        const existing = await dbGet('SELECT lastReadPage, totalPages, convertedAt FROM comics WHERE id = ?', [id]);
        const lastReadPage = existing?.lastReadPage || 0;
        let totalPages = existing?.totalPages || 0;
        const convertedAt = wasConverted ? Date.now() : (existing?.convertedAt || null);

        let thumbnailPath;
        try {
          thumbnailPath = await generateThumbnail(filePath);
          if (thumbnailPath) thumbOk++; else thumbFail++;
        } catch (e) {
          thumbFail++;
          throw e;
        }
        const info = await getComicInfoFromZip(filePath);
        const publisher = info.Publisher || 'Unknown Publisher';
        const series = info.Series || 'Unknown Series';
        const newStats = await fs.promises.stat(filePath);

        try {
          const pages = await getComicPages(filePath);
          if (pages.length > 0) totalPages = pages.length;
        } catch {}

        await dbRun(
          `INSERT OR REPLACE INTO comics (id, path, thumbnailPath, updatedAt, name, series, publisher, metadata, lastReadPage, totalPages, convertedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            convertedAt
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
    for (const dir of directories) {
      const t = t0();
      log('INFO', 'SCAN', `Walk: ${dir}`);
      await walkDir(dir);
      log('INFO', 'SCAN', `Walk done: ${dir} in ${ms(t)} ms`);
    }

    const toDelete = Array.from(dbComicsMap.keys()).filter(p => !fileSystemComics.has(p));
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
  } catch (e) {
    log('ERROR', 'SCAN', `Scan error: ${e.message}`);
  }
  isScanning = false;
  scanProgress.status = 'Idle';
  log('INFO', 'SCAN', `Scan complete in ${ms(startScan)} ms. Seen: ${totalSeen}, Upserted: ${totalInsertedOrUpdated}, Converted: ${totalConverted}, Thumbs: ${thumbOk} ok / ${thumbFail} fail, Errors: ${errors}`);
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
  // Get all comics and their per-user progress/status
  const rows = await dbAll('SELECT * FROM comics');
  log('INFO', 'SERVER', `Build library for UI with ${rows.length} rows for user ${userId}`);

  // Get per-user progress for all comics in one query
  const userProgress = await dbAll(
    'SELECT comicId, lastReadPage, totalPages FROM user_comic_status WHERE userId = ?',
    [userId]
  );

  // Create a map for quick lookup
  const progressMap = {};
  for (const p of userProgress) {
    progressMap[p.comicId] = { lastReadPage: p.lastReadPage, totalPages: p.totalPages };
  }

  const lib = {};
  const directories = getComicsDirectories();

  for (const r of rows) {
    const rootDir = (directories.find(d => r.path.startsWith(d)) || 'Library');
    if (!lib[rootDir]) lib[rootDir] = { publishers: {} };
    if (!lib[rootDir].publishers[r.publisher]) {
      lib[rootDir].publishers[r.publisher] = { logoUrl: null, logoNeedsBackground: false, series: {} };
    }
    if (!lib[rootDir].publishers[r.publisher].series[r.series]) {
      lib[rootDir].publishers[r.publisher].series[r.series] = [];
    }

    let metadata = {};
    try {
      metadata = JSON.parse(r.metadata || '{}');
    } catch {
      metadata = {};
    }

    // Use per-user progress if available, otherwise default to 0
    const progress = progressMap[r.id] || { lastReadPage: 0, totalPages: r.totalPages || 0 };
    lib[rootDir].publishers[r.publisher].series[r.series].push({
      id: r.id,
      name: r.name,
      path: r.path,
      thumbnailPath: r.thumbnailPath || null,
      progress,
      updatedAt: r.updatedAt || null,
      convertedAt: r.convertedAt || null,
      metadata,
      series: r.series,
      mangaMode: r.mangaMode === 1 || r.mangaMode === true
    });
  }

  for (const rootDir in lib) {
    for (const publisherName in lib[rootDir].publishers) {
      const folderName = safeDirName(publisherName);
      const pubLogoDir = path.join(LOGOS_DIRECTORY, folderName);

      try {
        await fs.promises.mkdir(pubLogoDir, { recursive: true });
      } catch (e) {
        log('ERROR', 'SERVER', `Failed to ensure logo dir ${pubLogoDir}: ${e.message}`);
      }

      const logoFile = await findLogoFileIn(pubLogoDir);

      if (logoFile) {
        const fullLogoPath = path.join(pubLogoDir, logoFile);
        const needsBackground = await logoNeedsBackground(fullLogoPath);
        lib[rootDir].publishers[publisherName].logoUrl =
          `logos/${encodeURIComponent(folderName)}/${encodeURIComponent(logoFile)}`;
        lib[rootDir].publishers[publisherName].logoNeedsBackground = needsBackground;
      } else {
        lib[rootDir].publishers[publisherName].logoUrl = null;
        lib[rootDir].publishers[publisherName].logoNeedsBackground = false;
      }
    }
  }

  for (const configuredDir of directories) {
    if (!lib[configuredDir]) {
      lib[configuredDir] = { publishers: {} };
    }
  }

  return lib;
}

module.exports = {
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  generateThumbnail,
  isScanning: () => isScanning
};
