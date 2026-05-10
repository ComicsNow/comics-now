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

    registerCtClient(res);

    req.on('close', () => {
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

  // Get detailed pending match info including first page as base64 data URI
  router.get('/api/v1/comictagger/pending-details', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending || !pending.waitingForResponse) {
        return res.json({ waitingForResponse: false });
      }

      // Get first page of the comic being tagged as base64 data URI
      let firstPageUrl = null;
      if (pending.filePath) {
        try {
          const pages = await getComicPages(pending.filePath);
          if (pages && pages.length > 0) {
            const firstPage = pages[0];
            const { extractPageBuffer } = deps;
            const imageBuffer = await extractPageBuffer(pending.filePath, firstPage);

            if (imageBuffer) {
              // Determine mime type from file extension
              const mimeType = getMimeFromExt(firstPage);
              const base64Image = imageBuffer.toString('base64');
              firstPageUrl = `data:${mimeType};base64,${base64Image}`;

              log('INFO', 'CT', `Generated base64 data URI for first page (${Math.round(base64Image.length / 1024)}KB)`);
            }
          }
        } catch (error) {
          log('ERROR', 'CT', `Failed to get first page: ${error.message}`);
        }
      }

      const response = {
        ...pending,
        firstPageUrl,
        matches: pending.matches || []
      };

      log('INFO', 'CT', `Returning pending details: ${response.matches.length} match(es), waitingForResponse: ${response.waitingForResponse}`);

      // Prevent caching to ensure fresh data on external networks (Cloudflare)
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.json(response);
    } catch (error) {
      log('ERROR', 'CT', `Failed to get pending details: ${error.message}`);
      res.status(500).json({ error: 'Failed to get pending details' });
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

      // Use Promise.allSettled to ensure one failure doesn't break all matches
      const results = await Promise.allSettled(
        matches.map(match => fetchCoverWithTimeout(match))
      );

      // Extract values from settled promises (all should be fulfilled since we catch errors)
      const enrichedMatches = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          // This should rarely happen since we catch errors in fetchCoverWithTimeout
          log('ERROR', 'CT', `Unexpected rejection for match ${index}: ${result.reason}`);
          return { ...matches[index], coverUrl: null };
        }
      });

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
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    registerRenameClient(res);
    getRenameLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    req.on('close', () => {
      unregisterRenameClient(res);
    });
  });

  // Clear rename output
  router.post('/api/v1/rename/clear', (req, res) => {
    clearRenameLogs();
    res.json({ ok: true });
  });
};
