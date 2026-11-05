const fs = require('fs');
const path = require('path');
const { THUMBNAILS_DIRECTORY, GUIDED_VIEW_DIR } = require('../../../constants');
const { formatFolderPath, updateComicIdentity, planOriginalMove } = require('../../../services/organization');
const { getFolderRules } = require('../../../config');

module.exports = function attachMoveRoutes(router, deps) {
  const {
    log,
    dbAll,
    dbRun,
    getComicsDirectories,
    scanLibrary,
    getConfig,
    moveLog,
    registerMoveClient,
    unregisterMoveClient,
    getMoveLogs,
    clearMoveLogs,
    getRenameLogs,
    formatErrorMessage,
    createId,
    requireAdmin
  } = deps;

  router.post('/api/v1/move-comics', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const config = getConfig();
      const comicsLocation = config.comicsLocation;

      const directories = getComicsDirectories();
      if (!directories || directories.length === 0) {
        return res.status(500).json({ ok: false, message: 'No comics directories configured' });
      }

      const libraryPath = typeof body.libraryPath === 'string' ? body.libraryPath.trim() : '';
      let sourceDir;
      let destBaseDir;
      if (libraryPath) {
        if (!directories.includes(libraryPath)) {
          return res.status(400).json({ ok: false, message: 'Unknown library path' });
        }
        if (body.confirmation !== 'i want to do this') {
          return res.status(400).json({
            ok: false,
            message: 'Confirmation phrase "i want to do this" required for a whole-library reorganize.'
          });
        }
        sourceDir = libraryPath;
        destBaseDir = libraryPath;
      } else {
        sourceDir = comicsLocation;
        destBaseDir = (body.targetDirectory && directories.includes(body.targetDirectory))
          ? body.targetDirectory
          : directories[0];
      }

      if (!sourceDir || !fs.existsSync(sourceDir)) {
        return res.status(404).json({ ok: false, message: 'Source directory not found' });
      }

      log('INFO', 'MOVE', `Starting comic move operation from ${sourceDir} to ${destBaseDir}`);
      moveLog(`Starting move operation to ${destBaseDir}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';

      const comics = await dbAll(
        `SELECT id, path, name, metadata, originalPath FROM comics WHERE tagStatus = 'successful' AND path LIKE ?`,
        [`${sourceDir}%`]
      );

      const files = comics.filter(c => {
        if (!fs.existsSync(c.path)) return false;
        const ext = c.name.toLowerCase();
        if (ext.endsWith('.cbz')) return allowedFormats === 'cbz' || allowedFormats === 'both';
        if (ext.endsWith('.cbr')) return allowedFormats === 'cbr' || allowedFormats === 'both';
        return false;
      });

      if (files.length === 0) {
        moveLog('No successful matches found to move');
        return res.json({ ok: true, message: 'No successful matches found to move', processed: 0, moved: 0 });
      }

      moveLog(`Found ${files.length} successful comic(s) to process`);

      let processed = 0;
      let moved = 0;
      let errors = 0;
      const results = [];

      const folderRules = (deps.getFolderRules || getFolderRules)();

      for (const comicRecord of files) {
        const file = comicRecord.name;
        try {
          const filePath = comicRecord.path;
          processed++;
          moveLog(`[${processed}/${files.length}] Processing: ${file}`);

          let info = {};
          try {
            info = JSON.parse(comicRecord.metadata || '{}');
          } catch (e) {
            info = {};
          }

          if (!info || Object.keys(info).length === 0) {
            const { getComicInfoFromArchive } = deps;
            info = await getComicInfoFromArchive(filePath);
          }

          if (!info || Object.keys(info).length === 0) {
            moveLog(`✗ Error: ${file} - No valid ComicInfo.xml metadata found`);
            results.push({ file, success: false, error: 'No valid ComicInfo.xml metadata found' });
            errors++;
            continue;
          }

          const relFolder = formatFolderPath(info, folderRules);
          const destDir = path.join(destBaseDir, relFolder);
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

          const originalPlan = planOriginalMove(comicRecord.originalPath, destDir);
          if (originalPlan.action === 'collision') {
            const message = `Original file already exists at destination: ${path.basename(originalPlan.newOriginalPath)}`;
            moveLog(`✗ Error: ${file} - ${message}`);
            results.push({ file, success: false, error: message });
            errors++;
            continue;
          }
          if (originalPlan.action === 'clear') {
            moveLog(`⚠ Warning: original file missing for ${file}; clearing link`);
            log('WARN', 'MOVE', `Original file missing for ${file}; clearing link`);
          }
          const originalArgs = originalPlan.action === 'none'
            ? {}
            : {
                oldOriginalPath: originalPlan.oldOriginalPath,
                newOriginalPath: originalPlan.newOriginalPath
              };

          const oldId = comicRecord.id;
          const newId = createId(destPath);
          const newName = path.basename(destPath);

          await updateComicIdentity({
            dbRun,
            oldId,
            newId,
            oldPath: filePath,
            newPath: destPath,
            newName,
            thumbnailsDir: THUMBNAILS_DIRECTORY,
            guidedViewDir: GUIDED_VIEW_DIR,
            ...originalArgs
          });

          let parent = path.dirname(filePath);
          while (parent && parent !== comicsLocation && parent.startsWith(comicsLocation)) {
            try {
              const remaining = fs.readdirSync(parent);
              if (remaining.length === 0) {
                fs.rmdirSync(parent);
                parent = path.dirname(parent);
              } else {
                break;
              }
            } catch (_) {
              break;
            }
          }

          moved++;
          moveLog(`✓ Moved: ${relFolder}/${file}`);
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

  router.get('/api/v1/move/stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    registerMoveClient(res);

    res.write(':ok\n\n');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    getMoveLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unregisterMoveClient(res);
    });
  });

  router.post('/api/v1/move/clear', requireAdmin, (req, res) => {
    clearMoveLogs();
    res.json({ ok: true });
  });

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
};
