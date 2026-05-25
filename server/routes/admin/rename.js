const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Admin Rename Routes
 * @param {express.Router} router 
 * @param {object} deps 
 */
module.exports = function attach(router, deps) {
  const {
    log,
    getConfig,
    SCRIPTS_DIRECTORY,
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

  router.post('/api/v1/rename-cbz', async (req, res) => {
    try {
      const comicsLocation = getConfig().comicsLocation;

      if (!fs.existsSync(comicsLocation)) {
        return res.status(404).json({ ok: false, message: 'Scan directory not found' });
      }

      log('INFO', 'RENAME', `Starting rename operation in ${comicsLocation}`);
      renameLog(`Starting rename operation in ${comicsLocation}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';
      
      const comics = await dbAll(
        `SELECT id, path, name, metadata FROM comics WHERE tagStatus = 'successful' AND path LIKE ?`,
        [`${comicsLocation}%`]
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

          const series = info.Series;
          const publisher = info.Publisher;
          const year = info.Year || (info.CoverDate ? info.CoverDate.toString().substring(0, 4) : null);

          if (!series || !publisher || !year) {
            renameLog(`✗ Error: ${file} - Missing required tags (Series, Publisher, or Year/CoverDate)`);
            results.push({ file, success: false, error: 'Missing required tags (Series, Publisher, or Year/CoverDate)' });
            errors++;
            continue;
          }

          let formatted_issue = '';
          if (info.Number != null && info.Number !== '') {
            formatted_issue = info.Number.toString();
            if (/^[0-9]+$/.test(formatted_issue)) {
              formatted_issue = formatted_issue.padStart(2, '0');
            }
          }

          const ext = path.extname(filePath);
          let newName = '';
          if (formatted_issue) {
            newName += `${formatted_issue} `;
          }
          newName += series;
          if (info.Title) {
            newName += ` - ${info.Title}`;
          }
          newName += ` [${publisher}] (${year})`;
          if (info.PageCount) {
            newName += ` #${info.PageCount}`;
          }
          newName += ext;

          // Safe filename: replace '/' with '-'
          newName = newName.replace(/\//g, '-');

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

            fs.renameSync(filePath, newFilePath);

            // Update database record immediately to preserve metadata and progress
            const oldId = comicRecord.id;
            const newId = createId(newFilePath);
            await dbRun(
              'UPDATE comics SET id = ?, path = ?, name = ? WHERE id = ?',
              [newId, newFilePath, newName, oldId]
            );

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
