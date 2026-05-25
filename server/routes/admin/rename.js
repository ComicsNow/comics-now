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
    formatErrorMessage
  } = deps;

  router.post('/api/v1/rename-cbz', async (req, res) => {
    try {
      const comicsLocation = getConfig().comicsLocation;

      if (!fs.existsSync(comicsLocation)) {
        return res.status(404).json({ ok: false, message: 'Scan directory not found' });
      }

      const scriptPath = path.join(SCRIPTS_DIRECTORY, 'rename_cbz.sh');
      if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ ok: false, message: 'Rename script not found' });
      }

      log('INFO', 'RENAME', `Starting rename operation in ${comicsLocation}`);
      renameLog(`Starting rename operation in ${comicsLocation}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';
      
      const { dbAll } = deps;
      const comics = await dbAll(
        `SELECT id, path, name FROM comics WHERE tagStatus = 'successful' AND path LIKE ?`,
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

          const result = await new Promise((resolve, reject) => {
            const child = spawn(scriptPath, [filePath], {
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: comicsLocation
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
              stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
              stderr += data.toString();
            });

            child.on('close', (code) => {
              if (code === 0) {
                if (stdout.includes('Renaming to:')) {
                  renamed = renamed + 1;
                  const match = stdout.match(/Renaming to: (.+)/);
                  const newName = match ? match[1].trim() : 'unknown';
                  renameLog(`✓ Renamed: ${path.basename(newName)}`);
                  resolve({ file, success: true, newName, output: stdout.trim() });
                } else {
                  renameLog(`→ Skipped: ${file} (no rename needed)`);
                  resolve({ file, success: true, newName: file, output: stdout.trim() });
                }
              } else {
                errors = errors + 1;
                const errorMsg = stderr || stdout || 'Unknown error';
                renameLog(`✗ Error: ${file} - ${errorMsg}`);
                resolve({ file, success: false, error: errorMsg, code });
              }
            });

            child.on('error', (err) => {
              errors = errors + 1;
              renameLog(`✗ Error: ${file} - ${err.message}`);
              reject({ file, success: false, error: err.message });
            });
          });

          results.push(result);
          log('INFO', 'RENAME', `Processed ${file}: ${result.success ? 'success' : 'failed'}`);

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
