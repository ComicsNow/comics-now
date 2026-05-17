const express = require('express');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const { promisify } = require('util');

const { writeComicInfoToCbz, buildComicInfoXml } = require('../../services/metadata');
const { safeDirName } = require('../../utils');

/**
 * Admin Library Management Routes
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    log,
    dbAll,
    dbGet,
    dbRun,
    getComicsDirectories,
    scanLibrary,
    getConfig,
    moveLog,
    registerMoveClient,
    unregisterMoveClient,
    getLogs,
    getMoveLogs,
    clearMoveLogs,
    getRenameLogs,
    isScanning,
    formatErrorMessage,
    isPathSafe,
    resolvePath,
    createId,
    saveMetadataToComic,
    requireAdmin
  } = deps;

  router.post('/api/v1/scan', requireAdmin, async (req, res) => {
    if (isScanning()) return res.json({ ok: true, message: 'Scan already in progress' });
    try {
      if (req.body && req.body.full) {
        await dbRun('DELETE FROM scan_dirs');
      }
      scanLibrary();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Scan failed') });
    }
  });

  router.post('/api/v1/admin/metadata/migrate', requireAdmin, async (req, res) => {
    const { mode } = req.body;
    if (!['archive', 'db'].includes(mode)) {
      return res.status(400).json({ ok: false, message: 'Invalid mode' });
    }

    log('INFO', 'META', `🚀 Starting metadata migration to mode: ${mode}`);

    try {
      const comics = await dbAll('SELECT id, path, metadata FROM comics');
      let processed = 0;

      for (const comic of comics) {
        const comicPath = comic.path;
        if (!fs.existsSync(comicPath)) continue;

        const metadata = comic.metadata ? JSON.parse(comic.metadata) : {};
        const ext = path.extname(comicPath).toLowerCase();
        const sidecarPath = comicPath.replace(/\.(cbz|cbr)$/i, '.xml');

        try {
          if (mode === 'archive') {
            if (ext === '.cbz') {
              // Always write DB metadata to internal CBZ when migrating to 'archive' mode
              const metadataXml = buildComicInfoXml(metadata);
              if (metadataXml) {
                await writeComicInfoToCbz(comicPath, metadataXml);
              }
              // Cleanup sidecar if it exists
              if (fs.existsSync(sidecarPath)) {
                fs.unlinkSync(sidecarPath);
              }
            }
            // CBR: No action (CBR uses database exclusively)
          } else if (mode === 'db') {
            // Delete any .xml sidecars for both CBZ and CBR
            if (fs.existsSync(sidecarPath)) {
              fs.unlinkSync(sidecarPath);
            }
          }
        } catch (err) {
          log('ERROR', 'META', `Failed to migrate ${path.basename(comicPath)}: ${err.message}`);
        }

        processed++;
        if (processed % 100 === 0) {
          log('INFO', 'META', `Migration progress: ${processed}/${comics.length}`);
        }
      }

      log('INFO', 'META', `✅ Metadata migration complete. Processed ${processed} comics.`);
      res.json({ ok: true, processed });
    } catch (e) {
      log('ERROR', 'META', `Migration failed: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Migration failed') });
    }
  });

  router.post('/api/v1/comics/info', requireAdmin, async (req, res) => {

    try {
      const pB64 = req.query.path || '';
      const rawPath = Buffer.from(pB64, 'base64').toString('utf-8');
      const cbzPath = resolvePath(rawPath);
      if (!cbzPath) {
        return res.status(400).json({ ok: false, message: 'No path (missing ?path=)' });
      }

      // Security: Validate path is within allowed directories
      if (!isPathSafe(cbzPath)) {
        return res.status(403).json({ ok: false, message: 'Access denied' });
      }

      const metadata = req.body || {};
      const id = createId(cbzPath);

      log('INFO', 'META', `📥 Save metadata request for: ${cbzPath} (id=${id})`);
      log('INFO', 'META', `📦 Payload: ${JSON.stringify(metadata)}`);

      // Get current libraryMode to decide if we should write back to disk
      const comicRow = await dbGet('SELECT libraryMode FROM comics WHERE id = ?', [id]);
      const libraryMode = comicRow ? comicRow.libraryMode : 'metadata';

      await dbRun('UPDATE comics SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), id]);
      log('INFO', 'META', `💾 DB updated for ${path.basename(cbzPath)}`);

      if (!fs.existsSync(cbzPath)) {
        log('ERROR', 'META', `❌ CBZ not found on disk: ${cbzPath}`);
        return res.status(404).json({ ok: false, message: 'CBZ not found on disk' });
      }

      if (libraryMode === 'folder') {
        log('INFO', 'META', `📂 ComicInfo.xml write-back skipped (Folder Mode) for ${path.basename(cbzPath)}`);
        return res.json({ ok: true, writeBack: 'skipped' });
      }

      try {
        await saveMetadataToComic(cbzPath, metadata);
        log('INFO', 'META', `📂 ComicInfo.xml written back into ${path.basename(cbzPath)}`);
      } catch (e) {
        log('ERROR', 'META', `❌ Write-back failed for ${path.basename(cbzPath)}: ${e.message}`);
        return res.status(200).json({ ok: true, writeBack: false, error: formatErrorMessage(e, req, 'Metadata write-back failed') });
      }

      log('INFO', 'META', `✅ Metadata save complete for ${path.basename(cbzPath)}`);

      return res.json({ ok: true, writeBack: true });
    } catch (e) {
      log('ERROR', 'META', `❌ POST /comics/info error: ${e.message}`);
      return res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save metadata') });
    }
  });

  router.get('/api/v1/comics-directories', requireAdmin, (req, res) => {
    try {
      const directories = getComicsDirectories();
      if (!directories || directories.length === 0) {
        return res.status(500).json({ ok: false, message: 'No comics directories configured' });
      }

      const payload = directories.map(dir => ({
        path: dir,
        name: path.basename(dir),
        fullPath: dir
      }));

      res.json({ ok: true, directories: payload });
    } catch (error) {
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to list directories') });
    }
  });

  router.post('/api/v1/move-comics', requireAdmin, async (req, res) => {
    try {
      const config = getConfig();
      const yesDir = path.join(config.comicsLocation, 'yes');

      if (!fs.existsSync(yesDir)) {
        return res.status(404).json({ ok: false, message: 'Yes directory not found' });
      }

      const directories = getComicsDirectories();
      if (!directories || directories.length === 0) {
        return res.status(500).json({ ok: false, message: 'No comics directories configured' });
      }

      let destBaseDir;
      if (req.body.targetDirectory) {
        if (!directories.includes(req.body.targetDirectory)) {
          return res.status(400).json({ ok: false, message: 'Invalid target directory' });
        }
        destBaseDir = req.body.targetDirectory;
      } else {
        destBaseDir = directories[0];
      }

      log('INFO', 'MOVE', `Starting comic move operation from ${yesDir} to ${destBaseDir}`);
      moveLog(`Starting move operation to ${destBaseDir}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';
      const files = (await fs.promises.readdir(yesDir)).filter(file => {
        const ext = file.toLowerCase();
        if (ext.endsWith('.cbz')) return allowedFormats === 'cbz' || allowedFormats === 'both';
        if (ext.endsWith('.cbr')) return allowedFormats === 'cbr' || allowedFormats === 'both';
        return false;
      });

      if (files.length === 0) {
        moveLog('No files found to move');
        return res.json({ ok: true, message: 'No files found to move', processed: 0, moved: 0 });
      }

      moveLog(`Found ${files.length} file(s) to process`);

      let processed = 0;
      let moved = 0;
      let errors = 0;
      const results = [];

      for (const file of files) {
        try {
          const filePath = path.join(yesDir, file);
          processed++;
          moveLog(`[${processed}/${files.length}] Processing: ${file}`);

          const { getComicInfoFromArchive } = deps;
          const info = await getComicInfoFromArchive(filePath);

          if (!info || Object.keys(info).length === 0) {
            moveLog(`✗ Error: ${file} - No valid ComicInfo.xml metadata found`);
            results.push({ file, success: false, error: 'No valid ComicInfo.xml metadata found' });
            errors++;
            continue;
          }

          const publisher = safeDirName(info.Publisher || 'Unknown Publisher');

          const destDir = path.join(destBaseDir, publisher);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          const destPath = path.join(destDir, file);
          if (fs.existsSync(destPath)) {
            moveLog(`✗ Error: ${file} - File already exists at destination`);
            results.push({ file, success: false, error: 'File already exists at destination' });
            errors++;
            continue;
          }

          try {
            fs.renameSync(filePath, destPath);
          } catch (renameErr) {
            if (renameErr.code === 'EXDEV') {
              fs.copyFileSync(filePath, destPath);
              fs.unlinkSync(filePath);
            } else {
              throw renameErr;
            }
          }
          moved++;
          moveLog(`✓ Moved: ${publisher}/${file}`);
          results.push({ file, success: true, destination: destPath });
          log('INFO', 'MOVE', `Moved ${file} to ${destPath}`);

        } catch (error) {
          errors++;
          moveLog(`✗ Error: ${file} - ${error.message}`);
          results.push({ file, success: false, error: error.message });
          log('ERROR', 'MOVE', `Failed to process ${file}: ${error.message}`);
        }
      }

      moveLog(`\n✓ Complete: Processed ${processed}, Moved ${moved}, Errors ${errors}`);

      if (moved > 0) {
        log('INFO', 'MOVE', 'Triggering library scan due to moved files');
        scanLibrary();
      }

      res.json({
        ok: true,
        message: 'Move operation complete',
        processed,
        moved,
        errors,
        results
      });

    } catch (error) {
      log('ERROR', 'MOVE', `Move operation failed: ${error.message}`);
      moveLog(`✗ Operation failed: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Move operation failed') });
    }
  });

  // Move output stream endpoint
  router.get('/api/v1/move/stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering
    
    registerMoveClient(res);

    // Initial keep-alive
    res.write(':ok\n\n');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Send history
    getMoveLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unregisterMoveClient(res);
    });
  });

  // Clear move output
  router.post('/api/v1/move/clear', requireAdmin, (req, res) => {
    clearMoveLogs();
    res.json({ ok: true });
  });

  // Combined error log for rename + move operations
  router.get('/api/v1/operation-errors', requireAdmin, (req, res) => {
    const renameErrors = getRenameLogs()
      .filter(e => e.message && e.message.startsWith('✗'))
      .map(e => ({ ...e, source: 'rename' }));
    const moveErrors = getMoveLogs()
      .filter(e => e.message && e.message.startsWith('✗'))
      .map(e => ({ ...e, source: 'move' }));
    const combined = [...renameErrors, ...moveErrors]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ ok: true, errors: combined });
  });

  // Get library tree structure for access control
  router.get('/api/v1/library-tree', requireAdmin, async (req, res) => {
    try {
      // Get unique publisher/series combinations to build the hierarchy
      const comics = await dbAll(`
        SELECT MIN(path) as path, publisher, series
        FROM comics
        GROUP BY publisher, series
      `);

      // Get root folders from config
      const rootFolders = getComicsDirectories();

      // Helper: determine which root folder a comic belongs to
      const getRootFolder = (comicPath) => {
        for (const folder of rootFolders) {
          if (comicPath.startsWith(folder)) {
            return folder;
          }
        }
        return 'Unknown';
      };

      // Build hierarchical tree: root_folder -> publisher -> series
      // Series is the lowest level for access control (comics not included)
      const tree = {};

      for (const comic of comics) {
        const rootFolder = getRootFolder(comic.path);
        const pub = comic.publisher || 'Unknown Publisher';
        const ser = comic.series || 'Unknown Series';

        // Initialize structure
        if (!tree[rootFolder]) {
          tree[rootFolder] = {};
        }
        if (!tree[rootFolder][pub]) {
          tree[rootFolder][pub] = {};
        }
        if (!tree[rootFolder][pub][ser]) {
          tree[rootFolder][pub][ser] = true; // Just mark that series exists, don't store comics
        }
      }

      res.json({ ok: true, tree });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to fetch library tree: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch library tree') });
    }
  });

  router.get('/api/v1/logs', requireAdmin, (req, res) => {
    const { level = 'ALL', category = 'ALL' } = req.query;
    const entries = getLogs().filter(l =>
      (level === 'ALL' || l.level === level) &&
      (category === 'ALL' || l.category === category)
    );
    res.json(entries);
  });
};
