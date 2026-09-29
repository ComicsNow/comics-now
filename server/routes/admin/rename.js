const fs = require('fs');
const path = require('path');

/**
 * Admin Rename Routes
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    log,
    getConfig,
    renameLog,
    registerRenameClient,
    unregisterRenameClient,
    getRenameLogs,
    clearRenameLogs,
    scanLibrary,
    formatErrorMessage,
    dbAll,
    dbRun,
    createId,
    getComicInfoFromArchive
  } = deps;

  const { THUMBNAILS_DIRECTORY, GUIDED_VIEW_DIR } = require('../../constants');
  const { formatComicFilename, updateComicIdentity } = require('../../services/organization');

  router.post('/api/v1/rename-cbz', async (req, res) => {
    try {
      const body = req.body || {};
      const comicsLocation = getConfig().comicsLocation;

      // Two scopes:
      //  - Inbox (Operations tab): rename comics in comicsLocation. No confirmation.
      //  - Whole library (Name tab): rename an entire library chosen via `libraryPath`.
      //    Destructive across a full library, so it requires the typed confirmation.
      const libraryPath = typeof body.libraryPath === 'string' ? body.libraryPath.trim() : '';
      let targetDir = comicsLocation;
      if (libraryPath) {
        const validDirs = deps.getComicsDirectories ? deps.getComicsDirectories() : [];
        if (!validDirs.includes(libraryPath)) {
          return res.status(400).json({ ok: false, message: 'Unknown library path' });
        }
        if (body.confirmation !== 'i want to do this') {
          return res.status(400).json({
            ok: false,
            message: 'Confirmation phrase "i want to do this" required for a whole-library rename.'
          });
        }
        targetDir = libraryPath;
      }

      if (!targetDir || !fs.existsSync(targetDir)) {
        return res.status(404).json({ ok: false, message: 'Target directory not found' });
      }

      log('INFO', 'RENAME', `Starting rename operation in ${targetDir}`);
      renameLog(`Starting rename operation in ${targetDir}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';

      const comics = await dbAll(
        `SELECT id, path, name, metadata FROM comics WHERE tagStatus = 'successful' AND path LIKE ?`,
        [`${targetDir}%`]
      );

      const files = comics.filter(c => {
        if (!fs.existsSync(c.path)) return false;
        const ext = c.name.toLowerCase();
        if (ext.endsWith('.cbz')) return allowedFormats === 'cbz' || allowedFormats === 'both';
        if (ext.endsWith('.cbr')) return allowedFormats === 'cbr' || allowedFormats === 'both';
        return false;
      });

      if (files.length === 0) {
        renameLog('No successful matches found to rename');
        return res.json({ ok: true, message: 'No successful matches found to rename', processed: 0, renamed: 0 });
      }

      renameLog(`Found ${files.length} successful comic(s) to process`);

      let processed = 0;
      let renamed = 0;
      let errors = 0;
      const results = [];

      const namingRules = (deps.getNamingRules || require('../../config').getNamingRules)();

      for (const comicRecord of files) {
        const file = comicRecord.name;
        try {
          const filePath = comicRecord.path;
          processed++;
          renameLog(`[${processed}/${files.length}] Processing: ${file}`);

          let info = {};
          try {
            info = JSON.parse(comicRecord.metadata || '{}');
          } catch (e) {
            info = {};
          }

          if (!info || Object.keys(info).length === 0) {
            info = await getComicInfoFromArchive(filePath);
          }

          if (!info || Object.keys(info).length === 0) {
            renameLog(`✗ Error: ${file} - No valid ComicInfo.xml metadata found`);
            results.push({ file, success: false, error: 'No valid ComicInfo.xml metadata found' });
            errors++;
            continue;
          }

          const ext = path.extname(filePath);
          let newName;
          try {
            newName = formatComicFilename(info, namingRules, ext);
          } catch (err) {
            renameLog(`✗ Error: ${file} - ${err.message}`);
            results.push({ file, success: false, error: err.message });
            errors++;
            continue;
          }

          const dir = path.dirname(filePath);
          const newFilePath = path.join(dir, newName);

          if (path.basename(filePath) !== newName) {
            renameLog(`Renaming to: ${newName}`);

            if (fs.existsSync(newFilePath)) {
              renameLog(`✗ Error: ${file} - File already exists at destination: ${newName}`);
              results.push({ file, success: false, error: `File already exists at destination: ${newName}` });
              errors++;
              continue;
            }

            const oldId = comicRecord.id;
            const newId = createId(newFilePath);

            await updateComicIdentity({
              dbRun,
              oldId,
              newId,
              oldPath: filePath,
              newPath: newFilePath,
              newName,
              thumbnailsDir: THUMBNAILS_DIRECTORY,
              guidedViewDir: GUIDED_VIEW_DIR
            });

            renamed++;
            renameLog(`✓ Renamed: ${newName}`);
            results.push({ file, success: true, newName, output: `Renamed to: ${newName}` });
          } else {
            renameLog(`→ Skipped: ${file} (no rename needed)`);
            results.push({ file, success: true, newName: file, output: 'Filename already correct.' });
          }

          log('INFO', 'RENAME', `Processed ${file}: success`);
        } catch (error) {
          errors = errors + 1;
          results.push({ file, success: false, error: error.message });
          renameLog(`✗ Error: ${file} - ${error.message}`);
          log('ERROR', 'RENAME', `Failed to process ${file}: ${error.message}`);
        }
      }

      log('INFO', 'RENAME', `Rename operation complete. Processed: ${processed}, Renamed: ${renamed}, Errors: ${errors}`);
      renameLog(`\n✓ Complete: Processed ${processed}, Renamed ${renamed}, Errors ${errors}`);

      if (renamed > 0) {
        log('INFO', 'RENAME', 'Triggering library scan due to renamed files');
        scanLibrary();
      }

      res.json({
        ok: true,
        message: 'Rename operation complete',
        processed,
        renamed,
        errors,
        results
      });

    } catch (error) {
      log('ERROR', 'RENAME', `Rename operation failed: ${error.message}`);
      renameLog(`✗ Operation failed: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Rename operation failed') });
    }
  });

  // Rename output stream endpoint
  router.get('/api/v1/rename/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering
    
    registerRenameClient(res);

    // Initial keep-alive
    res.write(':ok\n\n');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Send history
    getRenameLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unregisterRenameClient(res);
    });
  });

  // Clear rename output
  router.post('/api/v1/rename/clear', (req, res) => {
    clearRenameLogs();
    res.json({ ok: true });
  });
};
