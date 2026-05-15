const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function attach(router, deps) {
  const {
    log,
    registerCtClient,
    unregisterCtClient,
    getCtLogs,
    getCtScheduleMinutes,
    setCtScheduleMinutes,
    getComicsLocation,
    setComicsLocation,
    saveSetting,
    scheduleCtRun,
    runComicTagger,
    applyUserSelection,
    skipCurrentMatch,
    getPendingMatch,
    getComicPages,
    getMimeFromExt,
    getComicVineApiKey,
    cvFetchJson,
    COMICVINE_API_URL,
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

  // ComicTagger endpoints
  router.get('/api/v1/comictagger/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering
    
    // Register before flushing
    registerCtClient(res);

    // Initial keep-alive to help establish connection through some proxies
    res.write(':ok\n\n');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unregisterCtClient(res);
    });
  });
  router.get('/api/v1/comictagger/schedule', (req, res) => {
    res.json({ 
      minutes: getCtScheduleMinutes(),
      comicsLocation: getComicsLocation()
    });
  });

  router.post('/api/v1/comictagger/schedule', async (req, res) => {
    try {
      const { minutes = 60, comicsLocation } = req.body || {};
      const mins = Math.max(0, parseInt(minutes, 10) || 0);
      setCtScheduleMinutes(mins);
      await saveSetting('ctScheduleMinutes', mins);
      
      if (comicsLocation) {
        setComicsLocation(comicsLocation);
      }
      
      scheduleCtRun();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });

  router.post('/api/v1/comictagger/run', async (req, res) => {
    try {
      runComicTagger();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'ComicTagger run failed') });
    }
  });

  router.post('/api/v1/comictagger/apply', async (req, res) => {
    try {
      const { selections = [] } = req.body || {};
      applyUserSelection(selections);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to apply selection') });
    }
  });

  router.post('/api/v1/comictagger/skip', async (req, res) => {
    try {
      skipCurrentMatch();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to skip match') });
    }
  });

  router.get('/api/v1/comictagger/logs', (req, res) => {
    res.json(getCtLogs());
  });

  router.get('/api/v1/comictagger/pending', (req, res) => {
    const pending = getPendingMatch();
    res.json(pending || { waitingForResponse: false });
  });

  // Get detailed pending match info
  router.get('/api/v1/comictagger/pending-details', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending || !pending.waitingForResponse) {
        return res.json({ waitingForResponse: false });
      }

      const response = {
        ...pending,
        firstPageUrl: null, // Removed to reduce JSON size
        matches: pending.matches || []
      };

      log('INFO', 'CT', `Returning pending details: ${response.matches.length} match(es)`);

      // Prevent caching
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.json(response);
    } catch (error) {
      log('ERROR', 'CT', `Failed to get pending details: ${error.message}`);
      res.status(500).json({ error: 'Failed to get pending details' });
    }
  });

  // Dedicated endpoint for the first page preview to avoid huge base64 payloads in JSON
  router.get('/api/v1/comictagger/preview', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending) {
        return res.status(404).end();
      }

      // Check for cached buffer
      if (pending.previewBuffer && pending.previewMime) {
        res.setHeader('Content-Type', pending.previewMime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(pending.previewBuffer);
      }

      // Fallback if not yet cached or failed to cache
      if (!pending.filePath || !fs.existsSync(pending.filePath)) {
        return res.status(404).end();
      }

      const pages = await getComicPages(pending.filePath);
      if (!pages || pages.length === 0) {
        return res.status(404).end();
      }

      const firstPage = pages[0];
      const { extractPageBuffer } = deps;
      const imageBuffer = await extractPageBuffer(pending.filePath, firstPage);

      if (!imageBuffer) {
        return res.status(404).end();
      }

      const mimeType = getMimeFromExt(firstPage);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(imageBuffer);
    } catch (error) {
      log('ERROR', 'CT', `Failed to get preview image: ${error.message}`);
      res.status(500).end();
    }
  });

  // Enrich matches with ComicVine cover images
  router.post('/api/v1/comictagger/match-covers', async (req, res) => {
    try {
      const { matches } = req.body;
      if (!Array.isArray(matches)) {
        return res.status(400).json({ error: 'matches must be an array' });
      }

      log('INFO', 'CT', `Enriching ${matches.length} match(es) with cover images`);

      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        // No API key, return matches without covers
        log('WARN', 'CT', 'No ComicVine API key, returning matches without covers');
        return res.json({ matches: matches.map(m => ({ ...m, coverUrl: null })) });
      }

      // Helper to fetch cover with timeout
      const fetchCoverWithTimeout = async (match, timeoutMs = 5000) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          // Build search query: "Title Issue#"
          const query = `${match.title} ${match.issue}`;
          const searchUrl = `${COMICVINE_API_URL}/search/?api_key=${apiKey}&format=json&query=${encodeURIComponent(query)}&resources=issue&limit=1`;

          const result = await cvFetchJson(searchUrl);
          clearTimeout(timeout);

          const coverUrl = result?.results?.[0]?.image?.thumb_url || null;
          log('INFO', 'CT', `✓ Found cover for ${match.title} #${match.issue}`);

          return {
            ...match,
            coverUrl
          };
        } catch (error) {
          clearTimeout(timeout);
          if (error.name === 'AbortError') {
            log('WARN', 'CT', `Timeout fetching cover for ${match.title}`);
          } else {
            log('WARN', 'CT', `Failed to fetch cover for ${match.title}: ${error.message}`);
          }
          return { ...match, coverUrl: null };
        }
      };

      // Enrich matches with ComicVine cover images sequentially to avoid hanging the Pi
      const enrichedMatches = [];
      const MAX_MATCHES_TO_ENRICH = 25; // Safety cap
      const matchesToProcess = matches.slice(0, MAX_MATCHES_TO_ENRICH);

      for (const match of matchesToProcess) {
        const result = await fetchCoverWithTimeout(match);
        enrichedMatches.push(result);
        
        // Small delay between requests to be nice to ComicVine and the Pi CPU
        if (matchesToProcess.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Add back any unenriched matches if we hit the cap
      if (matches.length > MAX_MATCHES_TO_ENRICH) {
        for (let i = MAX_MATCHES_TO_ENRICH; i < matches.length; i++) {
          enrichedMatches.push({ ...matches[i], coverUrl: null });
        }
      }

      log('INFO', 'CT', `Successfully enriched ${enrichedMatches.length} match(es)`);

      // Prevent caching to ensure fresh data on external networks (Cloudflare)
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.json({ matches: enrichedMatches });
    } catch (error) {
      log('ERROR', 'CT', `Failed to enrich matches: ${error.message}`);
      // Even on error, try to return matches without covers rather than failing completely
      const fallbackMatches = req.body.matches?.map(m => ({ ...m, coverUrl: null })) || [];
      res.json({ matches: fallbackMatches });
    }
  });

  router.post('/api/v1/rename-cbz', async (req, res) => {
    try {
      const yesDir = path.join(getConfig().comicsLocation, 'yes');

      if (!fs.existsSync(yesDir)) {
        return res.status(404).json({ ok: false, message: 'Yes directory not found' });
      }

      const scriptPath = path.join(SCRIPTS_DIRECTORY, 'rename_cbz.sh');
      if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ ok: false, message: 'Rename script not found' });
      }

      log('INFO', 'RENAME', `Starting rename operation in ${yesDir}`);
      renameLog(`Starting rename operation in ${yesDir}`);

      const allowedFormats = deps.getAllowedFormats ? deps.getAllowedFormats() : 'cbz';
      const files = (await fs.promises.readdir(yesDir)).filter(file => {
        const ext = file.toLowerCase();
        if (ext.endsWith('.cbz')) return allowedFormats === 'cbz' || allowedFormats === 'both';
        if (ext.endsWith('.cbr')) return allowedFormats === 'cbr' || allowedFormats === 'both';
        return false;
      });

      if (files.length === 0) {
        renameLog('No files found to rename');
        return res.json({ ok: true, message: 'No files found to rename', processed: 0, renamed: 0 });
      }

      renameLog(`Found ${files.length} file(s) to process`);

      let processed = 0;
      let renamed = 0;
      let errors = 0;
      const results = [];

      for (const file of files) {
        try {
          const filePath = path.join(yesDir, file);
          processed++;
          renameLog(`[${processed}/${files.length}] Processing: ${file}`);

          const result = await new Promise((resolve, reject) => {
            const child = spawn(scriptPath, [filePath], {
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: yesDir
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
