const express = require('express');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const xml2js = require('xml2js');
const { spawn } = require('child_process');
const { promisify } = require('util');
const {
  validateDeviceName,
  validateDeviceId,
  validateFingerprint,
  validateLastReadPage,
  validateStatus,
  validateScanInterval,
  validateApiKey
} = require('../validation');

const yauzlOpen = promisify(yauzl.open);

function createApiRouter({
  log,
  ctLog,
  registerCtClient,
  unregisterCtClient,
  getLogs,
  getCtLogs,
  renameLog,
  registerRenameClient,
  unregisterRenameClient,
  getRenameLogs,
  clearRenameLogs,
  moveLog,
  registerMoveClient,
  unregisterMoveClient,
  getMoveLogs,
  clearMoveLogs,
  getScanIntervalMinutes,
  setScanIntervalMinutes,
  getComicVineApiKey,
  setComicVineApiKey,
  getCtScheduleMinutes,
  setCtScheduleMinutes,
  getComicsDirectories,
  getConfig,
  saveSetting,
  scanLibrary,
  scheduleNextScan,
  buildLibrary,
  getComicPages,
  isScanning,
  dbGet,
  dbRun,
  dbAll,
  runComicTagger,
  scheduleCtRun,
  applyUserSelection,
  skipCurrentMatch,
  getPendingMatch,
  saveMetadataToComic,
  cvFetchJson,
  normalizeCvId,
  stripHtml,
  COMICVINE_API_URL,
  SCRIPTS_DIRECTORY,
  createId,
  getMimeFromExt,
  requireAdmin,
  requireAuth,
  isAuthEnabled
}) {
  const router = express.Router();

  /**
   * Security: Validate that a file path is within allowed comic directories
   * Prevents path traversal attacks (e.g., ../../etc/passwd)
   * @param {string} requestedPath - The decoded file path from user input
   * @returns {boolean} - True if path is safe, false if potentially malicious
   */
  function isPathSafe(requestedPath) {
    if (!requestedPath || typeof requestedPath !== 'string') {
      return false;
    }

    // Resolve to absolute path to eliminate .. and symlinks
    const resolvedPath = path.resolve(requestedPath);

    // Get allowed comic directories
    const allowedDirs = getComicsDirectories();

    if (!Array.isArray(allowedDirs) || allowedDirs.length === 0) {
      log('WARN', 'SECURITY', 'No comic directories configured - rejecting all paths');
      return false;
    }

    // Check if resolved path starts with any allowed directory
    const isSafe = allowedDirs.some(allowedDir => {
      const resolvedAllowedDir = path.resolve(allowedDir);
      return resolvedPath.startsWith(resolvedAllowedDir + path.sep) ||
             resolvedPath === resolvedAllowedDir;
    });

    if (!isSafe) {
      log('WARN', 'SECURITY', `Path traversal attempt blocked: ${requestedPath} -> ${resolvedPath}`);
    }

    return isSafe;
  }

  /**
   * Security: Format error messages based on user role
   * Admins get detailed errors for debugging, non-admins get generic messages
   * @param {Error} error - The error object
   * @param {Object} req - Express request object (with req.user)
   * @param {string} fallbackMessage - Generic message for non-admins
   * @returns {string} - Formatted error message
   */
  function formatErrorMessage(error, req, fallbackMessage = 'Operation failed') {
    const isAdmin = req.user?.role === 'admin';

    // Always log full error server-side for debugging
    log('ERROR', 'API', `Error for ${req.user?.email || 'unknown'}: ${error.message || error}`);

    // Return detailed error to admins, generic to non-admins
    if (isAdmin) {
      return error.message || error.toString();
    }

    return fallbackMessage;
  }

  // Get current user info
  router.get('/api/v1/user/me', requireAuth, (req, res) => {
    res.json({
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
      authEnabled: isAuthEnabled()
    });
  });

  router.get('/api/v1/settings', requireAuth, (req, res) => {
    const apiKey = getComicVineApiKey();
    const isAdmin = req.user?.role === 'admin';

    res.json({
      scanInterval: getScanIntervalMinutes(),
      hasApiKey: !!(apiKey && apiKey !== 'YOUR_API_KEY_HERE'),
      // Only send actual key to admins (for settings form)
      comicVineApiKey: isAdmin ? apiKey : undefined
    });
  });

  router.post('/api/v1/settings', requireAdmin, async (req, res) => {
    try {
      const { interval = 5, apiKey = '' } = req.body || {};

      // Validate scan interval
      const parsedInterval = parseInt(interval, 10);
      const intervalToValidate = isNaN(parsedInterval) ? 5 : parsedInterval;
      const intervalValidation = validateScanInterval(intervalToValidate);
      if (!intervalValidation.valid) {
        return res.status(400).json({ ok: false, message: intervalValidation.error });
      }

      // Validate API key
      const apiKeyValidation = validateApiKey(apiKey);
      if (!apiKeyValidation.valid) {
        return res.status(400).json({ ok: false, message: apiKeyValidation.error });
      }

      const minutes = intervalValidation.sanitized;
      const sanitizedApiKey = apiKeyValidation.sanitized;

      setScanIntervalMinutes(minutes);
      setComicVineApiKey(sanitizedApiKey);
      await saveSetting('scanInterval', minutes);
      await saveSetting('comicVineApiKey', sanitizedApiKey);
      scheduleNextScan();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });

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

  // ComicTagger endpoints
  router.get('/api/v1/comictagger/stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    registerCtClient(res);

    req.on('close', () => {
      unregisterCtClient(res);
    });
  });

  router.get('/api/v1/comictagger/schedule', requireAdmin, (req, res) => {
    res.json({ minutes: getCtScheduleMinutes() });
  });

  router.post('/api/v1/comictagger/schedule', requireAdmin, async (req, res) => {
    try {
      const { minutes = 60 } = req.body || {};
      const mins = Math.max(0, parseInt(minutes, 10) || 60);
      setCtScheduleMinutes(mins);
      await saveSetting('ctScheduleMinutes', mins);
      scheduleCtRun();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save schedule') });
    }
  });

  router.post('/api/v1/comictagger/run', requireAdmin, async (req, res) => {
    try {
      runComicTagger();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'ComicTagger run failed') });
    }
  });

  router.post('/api/v1/comictagger/apply', requireAdmin, async (req, res) => {
    try {
      const { selections = [] } = req.body || {};
      applyUserSelection(selections);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to apply selection') });
    }
  });

  router.post('/api/v1/comictagger/skip', requireAdmin, async (req, res) => {
    try {
      skipCurrentMatch();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to skip match') });
    }
  });

  router.get('/api/v1/comictagger/logs', requireAdmin, (req, res) => {
    res.json(getCtLogs());
  });

  router.get('/api/v1/comictagger/pending', requireAdmin, (req, res) => {
    const pending = getPendingMatch();
    res.json(pending || { waitingForResponse: false });
  });

  // Get detailed pending match info including first page as base64 data URI
  router.get('/api/v1/comictagger/pending-details', requireAdmin, async (req, res) => {
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

            // Read the first page image from the CBZ and convert to base64
            const imageBuffer = await new Promise((resolve, reject) => {
              yauzl.open(pending.filePath, { lazyEntries: true }, (err, zipfile) => {
                if (err) return reject(err);

                let found = false;
                zipfile.readEntry();

                zipfile.on('entry', (entry) => {
                  if (entry.fileName === firstPage) {
                    found = true;
                    zipfile.openReadStream(entry, (e, readStream) => {
                      if (e) {
                        zipfile.close();
                        return reject(e);
                      }

                      const chunks = [];
                      readStream.on('data', (chunk) => chunks.push(chunk));
                      readStream.on('end', () => {
                        zipfile.close();
                        resolve(Buffer.concat(chunks));
                      });
                      readStream.on('error', (err) => {
                        zipfile.close();
                        reject(err);
                      });
                    });
                  } else {
                    zipfile.readEntry();
                  }
                });

                zipfile.on('end', () => {
                  if (!found) reject(new Error('First page not found in CBZ'));
                });

                zipfile.on('error', reject);
              });
            });

            // Determine mime type from file extension
            const mimeType = getMimeFromExt(firstPage);
            const base64Image = imageBuffer.toString('base64');
            firstPageUrl = `data:${mimeType};base64,${base64Image}`;

            log('INFO', 'CT', `Generated base64 data URI for first page (${Math.round(base64Image.length / 1024)}KB)`);
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
  router.post('/api/v1/comictagger/match-covers', requireAdmin, async (req, res) => {
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

  router.post('/api/v1/rename-cbz', requireAdmin, async (req, res) => {
    try {
      const yesDir = path.join(getConfig().comicsLocation, 'yes');

      if (!fs.existsSync(yesDir)) {
        return res.status(404).json({ ok: false, message: 'Yes directory not found' });
      }

      const scriptPath = path.join(SCRIPTS_DIRECTORY, 'rename_cbz.sh');
      if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ ok: false, message: 'Rename script not found' });
      }

      log('INFO', 'RENAME', `Starting CBZ rename operation in ${yesDir}`);
      renameLog(`Starting rename operation in ${yesDir}`);

      const files = fs.readdirSync(yesDir).filter(file => file.toLowerCase().endsWith('.cbz'));

      if (files.length === 0) {
        renameLog('No CBZ files found to rename');
        return res.json({ ok: true, message: 'No CBZ files found to rename', processed: 0, renamed: 0 });
      }

      renameLog(`Found ${files.length} CBZ file(s) to process`);

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
  router.get('/api/v1/rename/stream', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    registerRenameClient(res);
    getRenameLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    req.on('close', () => {
      unregisterRenameClient(res);
    });
  });

  // Clear rename output
  router.post('/api/v1/rename/clear', requireAdmin, (req, res) => {
    clearRenameLogs();
    res.json({ ok: true });
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

      const files = fs.readdirSync(yesDir).filter(file => file.toLowerCase().endsWith('.cbz'));

      if (files.length === 0) {
        moveLog('No CBZ files found to move');
        return res.json({ ok: true, message: 'No CBZ files found to move', processed: 0, moved: 0 });
      }

      moveLog(`Found ${files.length} CBZ file(s) to process`);

      let processed = 0;
      let moved = 0;
      let errors = 0;
      const results = [];

      for (const file of files) {
        try {
          const filePath = path.join(yesDir, file);
          processed++;
          moveLog(`[${processed}/${files.length}] Processing: ${file}`);

          const zipFile = await yauzlOpen(filePath, { lazyEntries: true });
          let comicInfoXml = null;

          await new Promise((resolve, reject) => {
            zipFile.readEntry();
            zipFile.on('entry', (entry) => {
              if (entry.fileName === 'ComicInfo.xml') {
                zipFile.openReadStream(entry, (err, readStream) => {
                  if (err) {
                    zipFile.readEntry();
                    return;
                  }
                  let xmlData = '';
                  readStream.on('data', (chunk) => {
                    xmlData += chunk;
                  });
                  readStream.on('end', () => {
                    comicInfoXml = xmlData;
                    zipFile.close();
                    resolve();
                  });
                });
              } else {
                zipFile.readEntry();
              }
            });
            zipFile.on('end', () => {
              zipFile.close();
              resolve();
            });
            zipFile.on('error', reject);
          });

          if (!comicInfoXml) {
            moveLog(`✗ Error: ${file} - No ComicInfo.xml found`);
            results.push({ file, success: false, error: 'No ComicInfo.xml found' });
            errors++;
            continue;
          }

          const parser = new xml2js.Parser();
          const xmlResult = await parser.parseStringPromise(comicInfoXml);

          const publisher = xmlResult.ComicInfo?.Publisher?.[0] || 'Unknown Publisher';

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

          fs.renameSync(filePath, destPath);
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
    res.flushHeaders();
    registerMoveClient(res);
    getMoveLogs().forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    req.on('close', () => {
      unregisterMoveClient(res);
    });
  });

  // Clear move output
  router.post('/api/v1/move/clear', requireAdmin, (req, res) => {
    clearMoveLogs();
    res.json({ ok: true });
  });

  router.post('/api/v1/device/register', async (req, res) => {
    try {
      let { deviceId, deviceName, fingerprint } = req.body || {};
      const now = Date.now();

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      // Validate fingerprint
      const fingerprintValidation = validateFingerprint(fingerprint);
      if (!fingerprintValidation.valid) {
        return res.status(400).json({ ok: false, message: fingerprintValidation.error });
      }
      fingerprint = fingerprintValidation.sanitized;

      if (!deviceId && fingerprint) {
        // Look for existing device with SAME userId + fingerprint
        const existingDevice = await dbGet(
          'SELECT deviceId, deviceName FROM devices WHERE fingerprint = ? AND userId = ? LIMIT 1',
          [fingerprint, userId]
        );

        if (existingDevice) {
          deviceId = existingDevice.deviceId;
          if (!deviceName) {
            deviceName = existingDevice.deviceName;
          }
        }
      }

      if (!deviceId) {
        deviceId = createId(`${userId}:${fingerprint || 'device'}:${now}:${Math.random()}`);
      } else {
        // Validate provided deviceId
        const deviceIdValidation = validateDeviceId(deviceId);
        if (!deviceIdValidation.valid) {
          return res.status(400).json({ ok: false, message: deviceIdValidation.error });
        }
        deviceId = deviceIdValidation.sanitized;
      }

      // Validate and sanitize device name
      const deviceNameValidation = validateDeviceName(deviceName);
      const resolvedDeviceName = deviceNameValidation.sanitized;
      const userAgent = req.headers['user-agent'] || '';

      await dbRun(
        `INSERT OR REPLACE INTO devices (deviceId, deviceName, fingerprint, userId, lastSeen, userAgent, created)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created FROM devices WHERE deviceId = ?), ?))`,
        [
          deviceId,
          resolvedDeviceName,
          fingerprint || '',
          userId,
          now,
          userAgent,
          deviceId,
          now
        ]
      );

      log('INFO', 'SYNC', `Device registered: ${resolvedDeviceName} (${deviceId}) for user ${userId}`);
      res.json({ ok: true, deviceId, deviceName: resolvedDeviceName });
    } catch (error) {
      log('ERROR', 'SYNC', `Device registration failed: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Device registration failed') });
    }
  });

  router.get('/api/v1/sync/check/:comicId', async (req, res) => {
    try {
      const { comicId } = req.params;
      const { deviceId, lastKnownPage = 0, lastKnownTimestamp = 0 } = req.query;
      if (!comicId || !deviceId) {
        return res.status(400).json({ ok: false, message: 'Missing parameters' });
      }

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      // Get comic total pages
      const comic = await dbGet(
        `SELECT totalPages FROM comics WHERE id = ?`,
        [comicId]
      );

      // Get the current device's progress
      const currentDeviceProgress = await dbGet(
        `SELECT lastReadPage, lastSyncTimestamp FROM device_progress WHERE comicId = ? AND deviceId = ?`,
        [comicId, deviceId]
      );

      // Get the most recent progress from ANY other device BELONGING TO THE SAME USER
      const otherDeviceProgress = await dbGet(
        `SELECT dp.lastReadPage, dp.lastSyncTimestamp, dp.deviceId, d.deviceName
         FROM device_progress dp
         JOIN devices d ON dp.deviceId = d.deviceId
         WHERE dp.comicId = ? AND dp.deviceId != ? AND d.userId = ?
         ORDER BY dp.lastSyncTimestamp DESC
         LIMIT 1`,
        [comicId, deviceId, userId]
      );

      const currentTimestamp = currentDeviceProgress?.lastSyncTimestamp || 0;
      const otherTimestamp = otherDeviceProgress?.lastSyncTimestamp || 0;

      const hasNewerSync = otherTimestamp > currentTimestamp;
      const isFromDifferentDevice = otherDeviceProgress !== undefined;

      // Update device lastSeen timestamp
      const now = Date.now();
      await dbRun(
        `UPDATE devices SET lastSeen = ? WHERE deviceId = ?`,
        [now, deviceId]
      );

      res.json({
        ok: true,
        lastSyncTimestamp: otherTimestamp,
        lastSyncDeviceId: otherDeviceProgress?.deviceId || null,
        lastSyncDeviceName: otherDeviceProgress?.deviceName || null,
        lastReadPage: otherDeviceProgress?.lastReadPage || 0,
        totalPages: comic?.totalPages || 0,
        hasNewerSync,
        isFromDifferentDevice,
        currentDeviceProgress: {
          lastReadPage: currentDeviceProgress?.lastReadPage || 0,
          lastSyncTimestamp: currentTimestamp
        }
      });
    } catch (error) {
      log('ERROR', 'SYNC', `Sync check failed: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Sync check failed') });
    }
  });

  router.post('/api/v1/sync/update', async (req, res) => {
    try {
      const { comicId, deviceId, lastReadPage } = req.body || {};
      // NOTE: deviceName removed - it was redundant and never used

      if (!comicId || !deviceId) {
        return res.status(400).json({ ok: false, message: 'Missing parameters' });
      }

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      const now = Date.now();

      if (typeof lastReadPage === 'number') {
        // Get comic total pages
        const comic = await dbGet(`SELECT totalPages FROM comics WHERE id = ?`, [comicId]);
        const totalPages = comic?.totalPages || 0;

        // Validate lastReadPage
        const pageValidation = validateLastReadPage(lastReadPage, totalPages);
        if (!pageValidation.valid) {
          return res.status(400).json({ ok: false, message: pageValidation.error });
        }

        // Update per-device progress (for device sync)
        await dbRun(
          `INSERT OR REPLACE INTO device_progress (comicId, deviceId, lastReadPage, totalPages, lastSyncTimestamp)
           VALUES (?, ?, ?, ?, ?)`,
          [comicId, deviceId, pageValidation.sanitized, totalPages, now]
        );

        // ALSO update per-user status (for read/unread badges)
        await dbRun(`
          INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(userId, comicId) DO UPDATE SET
            lastReadPage = excluded.lastReadPage,
            totalPages = excluded.totalPages,
            updatedAt = excluded.updatedAt
        `, [userId, comicId, pageValidation.sanitized, totalPages, now]);

        log('INFO', 'SYNC', `Progress updated for comic ${comicId} by device ${deviceId} for user ${userId} (page ${pageValidation.sanitized})`);
      }

      // Update device lastSeen timestamp
      await dbRun(
        `UPDATE devices SET lastSeen = ? WHERE deviceId = ?`,
        [now, deviceId]
      );

      res.json({ ok: true, lastSyncTimestamp: now });
    } catch (error) {
      log('ERROR', 'SYNC', `Sync update failed: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Sync update failed') });
    }
  });

  router.get('/api/v1/devices', async (req, res) => {
    try {
      const currentUserId = req.user?.userId || 'default-user';
      const isAdmin = req.user?.role === 'admin';
      const requestedUserId = req.query.userId;

      let userId = currentUserId;

      // Admins can view any user's devices via ?userId=xxx query param
      if (isAdmin && requestedUserId) {
        userId = requestedUserId;
      }

      // Non-admins can only see their own devices
      const devices = await dbAll(
        'SELECT * FROM devices WHERE userId = ? ORDER BY lastSeen DESC',
        [userId]
      );
      res.json({ ok: true, devices, currentUserId, viewingUserId: userId });
    } catch (error) {
      log('ERROR', 'SYNC', `Failed to fetch devices: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch devices') });
    }
  });

  router.delete('/api/v1/devices/:deviceId', async (req, res) => {
    try {
      const { deviceId } = req.params;
      const currentUserId = req.user?.userId || 'default-user';
      const isAdmin = req.user?.role === 'admin';

      // Check if device exists and get its userId
      const device = await dbGet(
        'SELECT userId FROM devices WHERE deviceId = ?',
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ ok: false, message: 'Device not found' });
      }

      // Users can only delete their own devices, admins can delete any device
      if (!isAdmin && device.userId !== currentUserId) {
        return res.status(403).json({ ok: false, message: 'You can only delete your own devices' });
      }

      // Delete the device (cascade will handle device_progress and progress tables)
      await dbRun('DELETE FROM devices WHERE deviceId = ?', [deviceId]);

      log('INFO', 'DEVICE', `Device ${deviceId} deleted by ${currentUserId}`);
      res.json({ ok: true, message: 'Device deleted successfully' });
    } catch (error) {
      log('ERROR', 'DEVICE', `Failed to delete device: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to delete device') });
    }
  });

  router.get('/api/v1/users', async (req, res) => {
    try {
      const isAdmin = req.user?.role === 'admin';

      // Only admins can get user list
      if (!isAdmin) {
        return res.status(403).json({ ok: false, message: 'Admin access required' });
      }

      const users = await dbAll(
        'SELECT userId, email, role, created, lastSeen FROM users ORDER BY email ASC'
      );
      res.json({ ok: true, users });
    } catch (error) {
      log('ERROR', 'USER', `Failed to fetch users: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch users') });
    }
  });

  // Get library tree structure for access control
  router.get('/api/v1/library-tree', requireAdmin, async (req, res) => {
    try {
      // Get all comics with their full info
      const comics = await dbAll(`
        SELECT id, path, publisher, series, name
        FROM comics
        ORDER BY path
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

  // Get user's access permissions
  router.get('/api/v1/users/:userId/access', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;

      // Check if user exists
      const user = await dbGet('SELECT userId, email, role FROM users WHERE userId = ?', [userId]);
      if (!user) {
        return res.status(404).json({ ok: false, message: 'User not found' });
      }

      // Admins have access to everything (no need to query database)
      if (user.role === 'admin') {
        return res.json({
          ok: true,
          userId,
          role: 'admin',
          hasFullAccess: true,
          access: []
        });
      }

      // Get user's access permissions
      const access = await dbAll(
        'SELECT accessType, accessValue, direct_access, child_access FROM user_library_access WHERE userId = ? AND (direct_access = 1 OR child_access = 1)',
        [userId]
      );

      res.json({
        ok: true,
        userId,
        role: user.role,
        hasFullAccess: false,
        access
      });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to fetch user access: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch user access') });
    }
  });

  // Update user's access permissions
  router.post('/api/v1/users/:userId/access', requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { access } = req.body; // access is an array of { accessType, accessValue, direct_access, child_access }

      if (!Array.isArray(access)) {
        return res.status(400).json({ ok: false, message: 'Invalid access data: expected array' });
      }

      // Check if user exists
      const user = await dbGet('SELECT userId, role FROM users WHERE userId = ?', [userId]);
      if (!user) {
        return res.status(404).json({ ok: false, message: 'User not found' });
      }

      // Cannot modify admin access through this endpoint
      if (user.role === 'admin') {
        return res.status(400).json({ ok: false, message: 'Cannot modify admin user access (admins have full access)' });
      }

      // Clear existing access for this user
      await dbRun('DELETE FROM user_library_access WHERE userId = ?', [userId]);

      // Smart normalization: If a parent has child_access but some children are missing,
      // convert to direct_access on parent + direct_access on each present child
      let normalizedAccess = [];

      if (access.length > 0) {
        // Build hierarchy map from comics database
        const comics = await dbAll('SELECT path, publisher, series FROM comics');
        const rootFolders = getComicsDirectories();

        // Map: root_folder -> Set of publishers
        // Map: publisher -> Set of series
        // No need to map series -> comics since series is the lowest level for access control
        const rootToPublishers = new Map();
        const publisherToSeries = new Map();

        for (const comic of comics) {
          // Determine root folder
          let rootFolder = 'Unknown';
          for (const folder of rootFolders) {
            if (comic.path.startsWith(folder)) {
              rootFolder = folder;
              break;
            }
          }

          // Map root -> publishers
          if (!rootToPublishers.has(rootFolder)) {
            rootToPublishers.set(rootFolder, new Set());
          }
          if (comic.publisher) {
            rootToPublishers.get(rootFolder).add(comic.publisher);
          }

          // Map publisher -> series
          if (comic.publisher) {
            if (!publisherToSeries.has(comic.publisher)) {
              publisherToSeries.set(comic.publisher, new Set());
            }
            if (comic.series) {
              publisherToSeries.get(comic.publisher).add(comic.series);
            }
          }
        }

        // Build set of what children are present in access list
        const accessSet = new Map();
        for (const item of access) {
          const key = `${item.accessType}:${item.accessValue}`;
          accessSet.set(key, item);
        }

        // Process each access item
        for (const item of access) {
          let shouldNormalize = false;
          let allChildren = [];

          // If parent has child_access, check how many children are present
          if (item.child_access) {
            if (item.accessType === 'root_folder') {
              // Get all publishers under this root folder
              allChildren = Array.from(rootToPublishers.get(item.accessValue) || []);
              const presentChildren = allChildren.filter(pub =>
                accessSet.has(`publisher:${pub}`)
              );

              // Only normalize if SOME (but not all) children are present
              // If ALL children are present, keep child_access and remove redundant children
              // If NO children or SOME children, convert child_access to direct_access only
              if (presentChildren.length === allChildren.length && allChildren.length > 0) {
                // All children present - keep child_access, will remove redundant children later
                shouldNormalize = false;
              } else if (presentChildren.length > 0) {
                // Some children present - remove child_access (selective access)
                shouldNormalize = true;
              } else {
                // No children present - this is fine, child_access covers everything
                shouldNormalize = false;
              }

            } else if (item.accessType === 'publisher') {
              // Get all series under this publisher
              allChildren = Array.from(publisherToSeries.get(item.accessValue) || []);
              const presentChildren = allChildren.filter(series =>
                accessSet.has(`series:${series}`)
              );
              // Same logic as root_folder
              if (presentChildren.length === allChildren.length && allChildren.length > 0) {
                shouldNormalize = false;
              } else if (presentChildren.length > 0) {
                shouldNormalize = true;
              } else {
                shouldNormalize = false;
              }

            } else if (item.accessType === 'series') {
              // Series is the lowest level for access control
              // Series doesn't support child_access (it automatically grants access to all comics)
              // If somehow child_access was set, we should normalize it away
              if (item.child_access) {
                shouldNormalize = true;
                allChildren = ['dummy']; // Set to non-empty to trigger normalization
              } else {
                shouldNormalize = false;
              }
            }
          }

          if (shouldNormalize && allChildren.length > 0) {
            // Convert: remove child_access, add direct_access to parent
            normalizedAccess.push({
              accessType: item.accessType,
              accessValue: item.accessValue,
              direct_access: true,
              child_access: false
            });

            log('INFO', 'ACCESS', `Normalized ${item.accessType}:${item.accessValue} - removed child_access${item.accessType === 'series' ? ' (series is lowest level)' : ' due to selective child access'}`);
          } else {
            // Keep as-is
            normalizedAccess.push(item);
          }
        }

        // Remove redundant child entries when parent has child_access
        // If root_folder has child_access, remove all publisher/series under it
        // If publisher has child_access, remove all series under it
        const finalAccess = [];
        const rootFoldersWithChildAccess = new Set();
        const publishersWithChildAccess = new Set();

        // Build maps for hierarchy
        const publisherToRootFolder = new Map();
        const seriesToPublisher = new Map();
        for (const comic of comics) {
          // Determine root folder for this comic
          let rootFolder = 'Unknown';
          for (const folder of rootFolders) {
            if (comic.path.startsWith(folder)) {
              rootFolder = folder;
              break;
            }
          }
          if (comic.publisher) {
            publisherToRootFolder.set(comic.publisher, rootFolder);
          }
          if (comic.series && comic.publisher) {
            seriesToPublisher.set(comic.series, comic.publisher);
          }
        }

        // First pass: identify parents with child_access
        for (const item of normalizedAccess) {
          if (item.child_access) {
            if (item.accessType === 'root_folder') {
              rootFoldersWithChildAccess.add(item.accessValue);
            } else if (item.accessType === 'publisher') {
              publishersWithChildAccess.add(item.accessValue);
            }
          }
        }

        // Second pass: filter out redundant entries
        for (const item of normalizedAccess) {
          // Always keep root_folder entries
          if (item.accessType === 'root_folder') {
            finalAccess.push(item);
            continue;
          }

          // Skip publishers if their root folder has child_access
          if (item.accessType === 'publisher') {
            const rootFolder = publisherToRootFolder.get(item.accessValue);
            if (rootFolder && rootFoldersWithChildAccess.has(rootFolder)) {
              // This publisher is covered by root folder's child_access, skip it
              continue;
            }
          }

          // Skip series if their publisher has child_access OR their root folder has child_access
          if (item.accessType === 'series') {
            const publisher = seriesToPublisher.get(item.accessValue);
            if (publisher) {
              // Check if publisher has child_access
              if (publishersWithChildAccess.has(publisher)) {
                continue; // Skip - covered by publisher's child_access
              }
              // Check if root folder has child_access
              const rootFolder = publisherToRootFolder.get(publisher);
              if (rootFolder && rootFoldersWithChildAccess.has(rootFolder)) {
                continue; // Skip - covered by root folder's child_access
              }
            }
          }

          finalAccess.push(item);
        }

        normalizedAccess = finalAccess;
      }

      // Insert normalized access permissions
      if (normalizedAccess.length > 0) {
        for (const item of normalizedAccess) {
          if (!item.accessType || !item.accessValue) continue;

          // Skip comic-level access (series is the lowest level)
          if (item.accessType === 'comic') {
            log('WARN', 'ACCESS', `Skipping comic-level access for user ${userId} - series is the lowest level`);
            continue;
          }

          const directAccess = item.direct_access === true ? 1 : 0;
          // Series doesn't support child_access (it grants access to all comics by default)
          let childAccess = (item.accessType === 'series') ? 0 : (item.child_access === true ? 1 : 0);

          // Can't have child_access without direct_access
          if (!directAccess) {
            childAccess = 0;
          }

          // Only insert if at least one access type is enabled
          if (directAccess || childAccess) {
            await dbRun(
              'INSERT INTO user_library_access (userId, accessType, accessValue, direct_access, child_access) VALUES (?, ?, ?, ?, ?)',
              [userId, item.accessType, item.accessValue, directAccess, childAccess]
            );
          }
        }
      }

      log('INFO', 'ACCESS', `Updated access permissions for user ${userId}: ${normalizedAccess.length} entries`);
      res.json({ ok: true, message: 'Access permissions updated successfully' });
    } catch (error) {
      log('ERROR', 'ACCESS', `Failed to update user access: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to update user access') });
    }
  });

  router.get('/api/v1/sync/devices/:comicId', async (req, res) => {
    try {
      const { comicId } = req.params;
      const { currentDeviceId } = req.query;

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      if (!comicId) {
        return res.status(400).json({ ok: false, message: 'Comic ID is required' });
      }

      // Get the comic's total pages
      const comic = await dbGet(
        `SELECT totalPages FROM comics WHERE id = ?`,
        [comicId]
      );

      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Get all devices for THIS USER and their per-device progress for this comic
      const devices = await dbAll(`
        SELECT d.deviceId, d.deviceName, d.lastSeen, d.userAgent,
               dp.lastReadPage, dp.lastSyncTimestamp
        FROM devices d
        LEFT JOIN device_progress dp ON d.deviceId = dp.deviceId AND dp.comicId = ?
        WHERE d.userId = ?
        ORDER BY d.lastSeen DESC
      `, [comicId, userId]);

      res.json({
        ok: true,
        comic: {
          id: comicId,
          totalPages: comic.totalPages || 0
        },
        devices: devices.map(device => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          lastSeen: device.lastSeen,
          lastSyncTimestamp: device.lastSyncTimestamp,
          lastReadPage: device.lastReadPage,
          isCurrentDevice: device.deviceId === currentDeviceId
        }))
      });
    } catch (error) {
      log('ERROR', 'SYNC', `Failed to fetch comic sync devices: ${error.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Failed to fetch comic sync devices') });
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

  router.get('/api/v1/comics', async (req, res) => {
    try {
      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      const lib = await buildLibrary(userId);
      res.json(lib);
    } catch (e) {
      log('ERROR', 'LIST', `Failed to list library: ${e.message}`);
      res.json({});
    }
  });

  router.get('/api/v1/search', async (req, res) => {
    log('INFO', 'LIST', 'Searching library');
    try {
      const { query = '', field = 'all' } = req.query;
      const q = query.toLowerCase();
      const userId = req.user?.userId || 'default-user';

      const rows = await dbAll('SELECT * FROM comics');

      // Load user manga mode preferences
      const { getAllMangaModePreferences } = require('../db');
      const allPrefs = await getAllMangaModePreferences(userId);

      // Load user continuous mode preferences
      const userProgress = await dbAll(
        'SELECT comicId, continuousMode FROM user_comic_status WHERE userId = ? AND continuousMode IS NOT NULL',
        [userId]
      );

      const continuousModeMap = {};
      for (const p of userProgress) {
        continuousModeMap[p.comicId] = p.continuousMode === 1;
      }

      // Create maps for each preference type
      const prefMaps = {
        comic: new Map(),
        series: new Map(),
        publisher: new Map()
      };

      for (const pref of allPrefs) {
        if (prefMaps[pref.preferenceType]) {
          prefMaps[pref.preferenceType].set(pref.targetId, pref.mangaMode === 1);
        }
      }

      const results = [];
      for (const r of rows) {
        const meta = (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
        const hay = {
          title: r.name || '',
          series: r.series || '',
          publisher: r.publisher || '',
          character: meta.Characters || '',
          all: `${r.name} ${r.series} ${r.publisher} ${meta.Characters || ''} ${meta.Summary || ''}`
        };
        if ((hay[field] || hay.all).toLowerCase().includes(q)) {
          // Apply hierarchical manga mode preference
          let mangaMode = false;
          if (prefMaps.comic.has(r.id)) {
            mangaMode = prefMaps.comic.get(r.id);
          } else if (prefMaps.series.has(r.series)) {
            mangaMode = prefMaps.series.get(r.series);
          } else if (prefMaps.publisher.has(r.publisher)) {
            mangaMode = prefMaps.publisher.get(r.publisher);
          }

          const continuousMode = continuousModeMap[r.id] !== undefined ? continuousModeMap[r.id] : false;

          results.push({
            id: r.id,
            name: r.name,
            path: r.path,
            thumbnailPath: r.thumbnailPath,
            progress: { lastReadPage: r.lastReadPage || 0, totalPages: r.totalPages || 0 },
            metadata: meta,
            series: r.series,
            mangaMode: mangaMode,
            continuousMode: continuousMode
          });
        }
      }
      res.json(results);
    } catch (e) {
      log('ERROR', 'LIST', `Search failed: ${e.message}`);
      res.json([]);
    }
  });

  router.get('/api/v1/comics/pages', async (req, res) => {
    try {
      const p = Buffer.from(req.query.path || '', 'base64').toString('utf-8');

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ pages: [], error: 'Access denied' });
      }

      if (!p || !fs.existsSync(p)) return res.json({ pages: [] });
      const pages = await getComicPages(p);
      const id = createId(p);
      await dbRun('UPDATE comics SET totalPages = ? WHERE id = ?', [pages.length, id]).catch(() => {});
      res.json({ pages });
    } catch (e) {
      log('ERROR', 'SERVER', `/pages failed: ${e.message}`);
      res.json({ pages: [] });
    }
  });

  router.get('/api/v1/comics/pages/image', async (req, res) => {
    try {
      const p = Buffer.from(req.query.path || '', 'base64').toString('utf-8');

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).end();
      }

      const pageName = req.query.page || '';
      if (!p || !pageName || !fs.existsSync(p)) return res.status(404).end();
      yauzl.open(p, { lazyEntries: true }, (err, zip) => {
        if (err) return res.status(500).end();
        let sent = false;
        zip.readEntry();
        zip.on('entry', entry => {
          if (entry.fileName === pageName) {
            sent = true;
            zip.openReadStream(entry, (e, rs) => {
              if (e) { zip.close(); return res.status(500).end(); }
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              res.setHeader('Content-Type', getMimeFromExt(entry.fileName));
              rs.pipe(res);
              rs.on('end', () => zip.close());
            });
          } else {
            zip.readEntry();
          }
        });
        zip.on('end', () => { if (!sent) res.status(404).end(); });
        zip.on('error', () => res.status(500).end());
      });
    } catch {
      res.status(500).end();
    }
  });

  router.post('/api/v1/progress', async (req, res) => {
    try {
      const { comicPath, page } = req.body || {};
      if (!comicPath || typeof page !== 'number') return res.status(400).json({ message: 'Bad request' });
      const id = createId(comicPath);
      await dbRun('UPDATE comics SET lastReadPage = ? WHERE id = ?', [page, id]);
      log('INFO', 'PROGRESS', `Set page ${page} for ${path.basename(comicPath)}`);
      res.json({ ok: true });
    } catch (e) {
      log('ERROR', 'PROGRESS', `Progress update failed: ${e.message}`);
      res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to update progress') });
    }
  });

  router.post('/api/v1/comics/status', async (req, res) => {
    try {
      const { comicId, status } = req.body;
      if (!comicId || !status) return res.status(400).json({ message: 'Bad request' });

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      // Validate status
      const statusValidation = validateStatus(status);
      if (!statusValidation.valid) {
        return res.status(400).json({ ok: false, message: statusValidation.error });
      }
      const validatedStatus = statusValidation.sanitized;

      const comic = await dbGet('SELECT totalPages FROM comics WHERE id = ?', [comicId]);
      if (!comic) return res.status(404).json({ message: 'Comic not found' });

      const totalPages = comic.totalPages || 0;
      let lastReadPage;

      if (validatedStatus === 'read') {
        // Mark as read: set to last page (PER-USER)
        lastReadPage = totalPages > 0 ? totalPages - 1 : 0;
      } else {
        // Mark as unread: set to page 0 (PER-USER)
        lastReadPage = 0;
      }

      // Update per-user status table
      await dbRun(`
        INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(userId, comicId) DO UPDATE SET
          lastReadPage = excluded.lastReadPage,
          totalPages = excluded.totalPages,
          updatedAt = excluded.updatedAt
      `, [userId, comicId, lastReadPage, totalPages, Date.now()]);

      log('INFO', 'STATUS', `Comic ${comicId} marked as ${status} for user ${userId}`);

      res.json({
        ok: true,
        progress: {
          lastReadPage: lastReadPage,
          totalPages: totalPages
        }
      });
    } catch (e) {
      log('ERROR', 'STATUS', `Failed to update comic status: ${e.message}`);
      res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to update comic status') });
    }
  });

  router.post('/api/v1/series/status', async (req, res) => {
    try {
      const { rootFolder = '', publisher, series, status } = req.body || {};
      if (!publisher || !series || !status) {
        return res.status(400).json({ message: 'Bad request' });
      }

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      // Validate status
      const statusValidation = validateStatus(status);
      if (!statusValidation.valid) {
        return res.status(400).json({ ok: false, message: statusValidation.error });
      }
      const validatedStatus = statusValidation.sanitized;

      let where = 'series = ? AND publisher = ?';
      const params = [series, publisher];
      if (rootFolder && rootFolder !== 'Library') {
        where += ' AND path LIKE ?';
        const prefix = rootFolder.endsWith(path.sep) ? rootFolder : rootFolder + path.sep;
        params.push(prefix + '%');
      }

      const comics = await dbAll(`SELECT id, totalPages FROM comics WHERE ${where}`, params);

      for (const c of comics) {
        const totalPages = c.totalPages || 0;
        let lastReadPage;

        if (validatedStatus === 'read') {
          // Mark as read: set to last page (PER-USER)
          lastReadPage = totalPages > 0 ? totalPages - 1 : 0;
        } else {
          // Mark as unread: set to page 0 (PER-USER)
          lastReadPage = 0;
        }

        // Update per-user status table
        await dbRun(`
          INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(userId, comicId) DO UPDATE SET
            lastReadPage = excluded.lastReadPage,
            totalPages = excluded.totalPages,
            updatedAt = excluded.updatedAt
        `, [userId, c.id, lastReadPage, totalPages, Date.now()]);
      }

      log('INFO', 'STATUS', `Series ${series} (${comics.length} comics) marked as ${validatedStatus} for user ${userId}`);
      res.json({ ok: true });
    } catch (e) {
      log('ERROR', 'STATUS', `Failed to update series status: ${e.message}`);
      res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to update series status') });
    }
  });

  // Toggle manga mode for a comic (PER-USER preference)
  router.post('/api/v1/comics/manga-mode', requireAuth, async (req, res) => {
    try {
      const { comicId, mangaMode } = req.body;
      if (!comicId || typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request' });
      }

      // Get userId from authenticated user
      const userId = req.user?.userId || 'default-user';

      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Store manga mode preference per-user (not in comics table)
      const { setMangaModePreference } = require('../db');
      await setMangaModePreference(userId, 'comic', comicId, mangaMode);

      log('INFO', 'MANGA_MODE', `User ${userId} set comic ${comicId} manga mode to ${mangaMode}`);

      res.json({
        ok: true,
        mangaMode
      });
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to update manga mode: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update manga mode') });
    }
  });

  // Get current library-level manga mode preference for the user
  router.get('/api/v1/manga-mode-preference', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';
      const directories = getComicsDirectories();

      // Check if any library has manga mode enabled
      // If at least one library has it, return true
      let hasAnyMangaMode = false;

      for (const dir of directories) {
        const pref = await dbGet(
          `SELECT mangaMode FROM user_reading_preferences
           WHERE userId = ? AND preferenceType = 'library' AND targetId = ?`,
          [userId, dir]
        );

        if (pref && pref.mangaMode === 1) {
          hasAnyMangaMode = true;
          break;
        }
      }

      res.json({ ok: true, mangaMode: hasAnyMangaMode });
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to get manga mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get manga mode preference') });
    }
  });

  // Set manga mode for all comics or at hierarchy level (PER-USER preference)
  router.post('/api/v1/comics/set-all-manga-mode', requireAuth, async (req, res) => {
    try {
      const { mangaMode, preferenceType, targetId } = req.body;
      if (typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: mangaMode must be boolean' });
      }

      const userId = req.user?.userId || 'default-user';
      const { setMangaModePreference } = require('../db');

      // If preferenceType and targetId are provided, set at that level
      // Otherwise, set at library level for all root folders
      if (preferenceType && targetId) {
        // Validate preferenceType
        if (!['comic', 'series', 'publisher', 'library'].includes(preferenceType)) {
          return res.status(400).json({ ok: false, message: 'Invalid preferenceType' });
        }

        await setMangaModePreference(userId, preferenceType, targetId, mangaMode);

        log('INFO', 'MANGA_MODE', `User ${userId} set ${preferenceType} '${targetId}' manga mode to ${mangaMode}`);

        res.json({
          ok: true,
          preferenceType,
          targetId,
          mangaMode
        });
      } else {
        // Set at library level for all root folders (user wants ALL comics in manga mode)
        // IMPORTANT: Clear all more specific preferences first to avoid hierarchy conflicts
        const deleteResult = await dbRun(
          `DELETE FROM user_reading_preferences
           WHERE userId = ? AND preferenceType IN ('comic', 'series', 'publisher')`,
          [userId]
        );
        const deletedCount = deleteResult.changes || 0;

        log('INFO', 'MANGA_MODE', `Cleared ${deletedCount} specific manga preferences for user ${userId}`);

        // Now set library-level preferences
        const directories = getComicsDirectories();
        for (const dir of directories) {
          await setMangaModePreference(userId, 'library', dir, mangaMode);
        }

        log('INFO', 'MANGA_MODE', `User ${userId} set all libraries (${directories.length} root folders) manga mode to ${mangaMode}`);

        res.json({
          ok: true,
          updatedCount: directories.length,
          clearedCount: deletedCount,
          mangaMode
        });
      }
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to set manga modes: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update manga modes') });
    }
  });

  // === CONTINUOUS MODE ENDPOINTS ===

  // Get user's default continuous mode preference
  router.get('/api/v1/continuous-mode-preference', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || 'default-user';

      // Check user_settings for continuousModeDefault
      const setting = await dbGet(
        `SELECT continuousModeDefault FROM user_settings WHERE userId = ? AND key = 'continuousMode'`,
        [userId]
      );

      const continuousMode = setting ? (setting.continuousModeDefault === 1) : false;

      res.json({ ok: true, continuousMode });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to get continuous mode preference: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to get continuous mode preference') });
    }
  });

  // Toggle continuous mode for a specific comic (per-user)
  router.post('/api/v1/comics/continuous-mode', requireAuth, async (req, res) => {
    try {
      const { comicId, continuousMode } = req.body;
      if (!comicId || typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: comicId and continuousMode (boolean) required' });
      }

      const userId = req.user?.userId || 'default-user';

      // Verify comic exists
      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      // Update or insert continuous mode for this comic in user_comic_status
      await dbRun(
        `INSERT INTO user_comic_status (userId, comicId, continuousMode)
         VALUES (?, ?, ?)
         ON CONFLICT(userId, comicId) DO UPDATE SET
           continuousMode = excluded.continuousMode,
           updatedAt = (strftime('%s', 'now') * 1000)`,
        [userId, comicId, continuousMode ? 1 : null]
      );

      log('INFO', 'CONTINUOUS_MODE', `User ${userId} set comic ${comicId} continuous mode to ${continuousMode}`);

      res.json({
        ok: true,
        continuousMode
      });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to update continuous mode: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update continuous mode') });
    }
  });

  // Set continuous mode for all comics at hierarchy level
  router.post('/api/v1/comics/set-all-continuous-mode', requireAuth, async (req, res) => {
    try {
      const { level, target, continuousMode } = req.body;

      if (typeof continuousMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request: continuousMode must be boolean' });
      }

      const userId = req.user?.userId || 'default-user';
      let updated = 0;

      if (!level || !target) {
        // Set as user default
        await dbRun(
          `INSERT INTO user_settings (userId, key, continuousModeDefault)
           VALUES (?, 'continuousMode', ?)
           ON CONFLICT(userId, key) DO UPDATE SET
             continuousModeDefault = excluded.continuousModeDefault`,
          [userId, continuousMode ? 1 : 0]
        );

        log('INFO', 'CONTINUOUS_MODE', `User ${userId} set default continuous mode to ${continuousMode}`);

        res.json({
          ok: true,
          updated: 1,
          continuousMode
        });
        return;
      }

      // Bulk update based on hierarchy level
      if (level === 'library' && target.rootFolder) {
        // Update all comics in this root folder
        const result = await dbRun(
          `INSERT OR REPLACE INTO user_comic_status (userId, comicId, continuousMode, lastReadPage, totalPages, updatedAt)
           SELECT ?, c.id, ?, COALESCE(ucs.lastReadPage, 0), COALESCE(ucs.totalPages, 0), (strftime('%s', 'now') * 1000)
           FROM comics c
           LEFT JOIN user_comic_status ucs ON ucs.userId = ? AND ucs.comicId = c.id
           WHERE c.rootFolder = ?`,
          [userId, continuousMode ? 1 : null, userId, target.rootFolder]
        );
        updated = result.changes || 0;

      } else if (level === 'publisher' && target.rootFolder && target.publisher) {
        // Update all comics from this publisher
        const result = await dbRun(
          `INSERT OR REPLACE INTO user_comic_status (userId, comicId, continuousMode, lastReadPage, totalPages, updatedAt)
           SELECT ?, c.id, ?, COALESCE(ucs.lastReadPage, 0), COALESCE(ucs.totalPages, 0), (strftime('%s', 'now') * 1000)
           FROM comics c
           LEFT JOIN user_comic_status ucs ON ucs.userId = ? AND ucs.comicId = c.id
           WHERE c.rootFolder = ? AND c.publisher = ?`,
          [userId, continuousMode ? 1 : null, userId, target.rootFolder, target.publisher]
        );
        updated = result.changes || 0;

      } else if (level === 'series' && target.rootFolder && target.publisher && target.series) {
        // Update all comics in this series
        const result = await dbRun(
          `INSERT OR REPLACE INTO user_comic_status (userId, comicId, continuousMode, lastReadPage, totalPages, updatedAt)
           SELECT ?, c.id, ?, COALESCE(ucs.lastReadPage, 0), COALESCE(ucs.totalPages, 0), (strftime('%s', 'now') * 1000)
           FROM comics c
           LEFT JOIN user_comic_status ucs ON ucs.userId = ? AND ucs.comicId = c.id
           WHERE c.rootFolder = ? AND c.publisher = ? AND c.series = ?`,
          [userId, continuousMode ? 1 : null, userId, target.rootFolder, target.publisher, target.series]
        );
        updated = result.changes || 0;

      } else {
        return res.status(400).json({ ok: false, message: 'Invalid level or target parameters' });
      }

      log('INFO', 'CONTINUOUS_MODE', `User ${userId} set continuous mode to ${continuousMode} for ${updated} comics at ${level} level`);

      res.json({
        ok: true,
        updated,
        continuousMode
      });
    } catch (e) {
      log('ERROR', 'CONTINUOUS_MODE', `Failed to set continuous modes: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update continuous modes') });
    }
  });

  // OPTIONS preflight is now handled by global CORS middleware in server.js

  router.get('/api/v1/comics/download', async (req, res) => {
    let p;
    try {
      p = Buffer.from(req.query.path || '', 'base64').toString('utf-8');

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (!p || !fs.existsSync(p)) return res.status(404).json({ message: 'Not found' });

      log('INFO', 'DOWNLOAD', `Serving ${path.basename(p)}`);

      // CORS headers now set by global middleware in server.js
      // Keep expose headers for range requests
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const stat = await fs.promises.stat(p);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        let start = parseInt(startStr, 10);
        let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', end - start + 1);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
        fs.createReadStream(p, { start, end }).pipe(res);
      } else {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(p)}"`);
        res.setHeader('Content-Length', fileSize);
        fs.createReadStream(p).pipe(res);
      }
    } catch (e) {
      log('ERROR', 'DOWNLOAD', `Download failed${p ? ' for ' + path.basename(p) : ''}: ${e.message}`);
      res.status(500).json({ message: formatErrorMessage(e, req, 'Download failed') });
    }
  });

  router.get('/api/v1/comics/info', async (req, res) => {
    try {
      const pB64 = req.query.path || '';
      const p = Buffer.from(pB64, 'base64').toString('utf-8');
      if (!p) return res.status(400).json({ message: 'No path' });

      // Security: Validate path is within allowed directories
      if (!isPathSafe(p)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const id = createId(p);
      const row = await dbGet('SELECT metadata FROM comics WHERE id = ?', [id]);
      let meta = {};
      try { meta = JSON.parse(row?.metadata || '{}'); } catch {}
      return res.json(meta);
    } catch (e) {
      return res.status(500).json({ message: formatErrorMessage(e, req, 'Failed to fetch comic info') });
    }
  });

  router.post('/api/v1/comics/info', requireAdmin, async (req, res) => {
    try {
      const pB64 = req.query.path || '';
      const cbzPath = Buffer.from(pB64, 'base64').toString('utf-8');
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

      await dbRun('UPDATE comics SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), id]);
      log('INFO', 'META', `💾 DB updated for ${path.basename(cbzPath)}`);

      if (!fs.existsSync(cbzPath)) {
        log('ERROR', 'META', `❌ CBZ not found on disk: ${cbzPath}`);
        return res.status(404).json({ ok: false, message: 'CBZ not found on disk' });
      }

      try {
        await saveMetadataToComic(cbzPath, metadata);
        log('INFO', 'META', `📂 ComicInfo.xml written back into ${path.basename(cbzPath)}`);
      } catch (e) {
        log('ERROR', 'META', `❌ Write-back failed for ${path.basename(cbzPath)}: ${e.message}`);
        return res.status(200).json({ ok: true, writeBack: false, error: formatErrorMessage(e, req, 'Metadata write-back failed') });
      }

      log('INFO', 'META', `✅ Metadata save complete for ${path.basename(cbzPath)}`);

      scanLibrary();

      return res.json({ ok: true });
    } catch (e) {
      log('ERROR', 'META', `❌ POST /comics/info error: ${e.message}`);
      return res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save metadata') });
    }
  });

  router.get('/api/v1/search/comicvine', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const {
        query = '',
        resources = 'volume',
        page = 1,
        limit = 20,
        sort,
        filter
      } = req.query;

      let searchUrl = `${COMICVINE_API_URL}/search/?api_key=${encodeURIComponent(apiKey)}&format=json`
                    + `&query=${encodeURIComponent(query)}`
                    + `&resources=${encodeURIComponent(resources)}`
                    + `&page=${page}`
                    + `&limit=${limit}`;
      if (sort)   searchUrl += `&sort=${encodeURIComponent(sort)}`;
      if (filter) searchUrl += `&filter=${encodeURIComponent(filter)}`;

      const sdata = await cvFetchJson(searchUrl);

      const results = [];
      for (const item of (sdata.results || [])) {
        const type = item.api_detail_url?.includes('/issue/') ? 'issue' : 'volume';
        const obj = {
          type,
          id: item.id,
          name: item.name || item.volume?.name || 'Unknown',
          volumeName: item.volume?.name || null,
          issueNumber: item.issue_number || null,
          coverDate: item.cover_date || item.date_added || null,
          startYear: item.start_year || item.startYear || '',
          publisher: item.publisher?.name || item.volume?.publisher?.name || '',
          image: item.image || null
        };

        if (type === 'volume') {
          try {
            const volIdNum = String(item.id).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
            const volMetaUrl =
              `${COMICVINE_API_URL}/volume/4050-${volIdNum}/?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=name,publisher`;

            let volName = obj.name || '';
            let publisher = obj.publisher || '';
            try {
              const vmeta = await cvFetchJson(volMetaUrl);
              volName   = vmeta?.results?.name || volName;
              publisher = vmeta?.results?.publisher?.name || publisher;
            } catch {}

            const buildIssuesUrl = (filterStr) =>
              `${COMICVINE_API_URL}/issues/?api_key=${encodeURIComponent(apiKey)}&format=json`
              + `&filter=${encodeURIComponent(filterStr)}`
              + `&field_list=id,name,issue_number,cover_date,image,volume`
              + `&sort=cover_date:asc&limit=100`;

            const matchesVolume = (arr, idNum) => {
              if (!Array.isArray(arr)) return false;
              return arr.some(is => {
                const volInIssue = is?.volume?.id ?? is?.volume;
                if (volInIssue == null) return false;
                const normalized = String(volInIssue).replace(/^(?:\d{4}-)?(\d+)$/, '$1');
                return normalized === String(idNum);
              });
            };

            let issuesUrl = buildIssuesUrl(`volume:4050-${volIdNum}`);
            let ij;
            try {
              ij = await cvFetchJson(issuesUrl);
            } catch {
              ij = { results: [] };
            }

            if (!matchesVolume(ij.results, volIdNum)) {
              issuesUrl = buildIssuesUrl(`volume:${volIdNum}`);
              try {
                ij = await cvFetchJson(issuesUrl);
              } catch {
                ij = { results: [] };
              }
            }

            if (!matchesVolume(ij.results, volIdNum)) {
              ij.results = [];
            }

            obj.issues = (ij.results || []).map(is => ({
              type: 'issue',
              id: is.id,
              name: is.name || (is.volume?.name || volName) || 'Unknown',
              issueNumber: is.issue_number,
              volumeName: is.volume?.name || volName || '',
              publisher,
              coverDate: is.cover_date || '',
              image: is.image || null
            }));

          } catch (err) {
            // Volume enrichment failed
          }
        }

        results.push(obj);
      }

      return res.json({
        total: sdata.number_of_total_results || results.length,
        results
      });
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'ComicVine search failed') });
    }
  });

  router.get('/api/v1/comicvine/volume/:id', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const id = req.params.id;
      const volUrl = `${COMICVINE_API_URL}/volume/4050-${encodeURIComponent(id)}/?api_key=${encodeURIComponent(apiKey)}&format=json`;
      const vjson = await cvFetchJson(volUrl);
      const volume = vjson.results;

      const normalized = {
        Title: volume.name || 'Unknown',
        Series: volume.name || '',
        Summary: stripHtml(volume.description || ''),
        Publisher: volume.publisher?.name || '',
        StartYear: volume.start_year || '',
        Issues: volume.count_of_issues || ''
      };

      try {
        const firstIssueIdRaw =
          volume?.first_issue?.id ??
          (Array.isArray(volume?.issues) && volume.issues.length ? volume.issues[0].id : null);

        if (firstIssueIdRaw) {
          const idStr = String(firstIssueIdRaw);
          const idNum = (idStr.match(/^(?:\d{4}-)?(\d+)$/) || [])[1] || idStr;

          const issueUrl =
            `${COMICVINE_API_URL}/issue/4000-${encodeURIComponent(idNum)}/`
            + `?api_key=${encodeURIComponent(apiKey)}&format=json&field_list=`
            + ['person_credits','character_credits','team_credits','location_credits'].join(',');

          const { results: issue } = await cvFetchJson(issueUrl);

          const roles = Array.isArray(issue?.person_credits)
            ? issue.person_credits.map(p => ({ name: p.name, role: String(p.role || '').toLowerCase() }))
            : [];

          const writers    = roles.filter(r => r.role.includes('writer')).map(r => r.name);
          const pencillers = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name);

          if (writers.length)    normalized.Writer    = writers.join(', ');
          if (pencillers.length) normalized.Penciller = pencillers.join(', ');

          const characters = (issue?.character_credits || []).map(c => c.name).join(', ');
          const teams      = (issue?.team_credits || []).map(t => t.name).join(', ');
          const locations  = (issue?.location_credits || []).map(l => l.name).join(', ');
          if (characters) normalized.Characters = characters;
          if (teams)      normalized.Teams      = teams;
          if (locations)  normalized.Locations  = locations;
        }
      } catch (enrichErr) {
        // Creator enrichment failed
      }

      return res.json(normalized);
    } catch (e) {
      return res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch volume details') });
    }
  });

  router.get('/api/v1/comicvine/issue/:id', async (req, res) => {
    try {
      const apiKey = getComicVineApiKey();
      if (!apiKey) {
        return res.status(400).json({ message: 'API key not set' });
      }

      const idNum = normalizeCvId(req.params.id);

      const issueUrl =
        `${COMICVINE_API_URL}/issue/4000-${encodeURIComponent(idNum)}/`
        + `?api_key=${encodeURIComponent(apiKey)}`
        + `&format=json&field_list=` + [
          'name','issue_number','description',
          'person_credits','character_credits','team_credits','location_credits',
          'publisher','volume','cover_date','store_date'
        ].join(',');

      const data = await cvFetchJson(issueUrl);
      const issue = data?.results;

      let publisherFrom = '';
      let publisher =
        (issue?.publisher?.name && (publisherFrom = 'issue.publisher')) && issue.publisher.name ||
        (issue?.volume?.publisher?.name && (publisherFrom = 'issue.volume.publisher')) && issue.volume.publisher.name ||
        '';

      let volStatus = null;
      let volUrl = null;
      if (!publisher && issue?.volume?.id) {
        const volIdNum = normalizeCvId(issue.volume.id);
        volUrl =
          `${COMICVINE_API_URL}/volume/4050-${encodeURIComponent(volIdNum)}/`
          + `?api_key=${encodeURIComponent(apiKey)}&format=json`;
        try {
          const vjson = await cvFetchJson(volUrl);
          volStatus = 200;
          if (vjson?.results?.publisher?.name) {
            publisher = vjson.results.publisher.name;
            publisherFrom = 'volume.publisher (fallback)';
          }
        } catch (err) {
          volStatus = err.status;
        }
      }

      const title = issue?.name || issue?.volume?.name || 'Unknown';
      const series = issue?.volume?.name || '';
      const number = issue?.issue_number || '';
      const summary = stripHtml(issue?.description || '');

      let writer = '', penciller = '';
      if (Array.isArray(issue?.person_credits)) {
        const roles = issue.person_credits.map(p => ({ name: p.name, role: (p.role || '').toLowerCase() }));
        writer    = roles.filter(r => r.role.includes('writer')).map(r => r.name).join(', ');
        penciller = roles.filter(r => r.role.includes('penciller') || r.role.includes('artist')).map(r => r.name).join(', ');
      }

      const characters = (issue?.character_credits || []).map(c => c.name).join(', ');
      const teams      = (issue?.team_credits || []).map(t => t.name).join(', ');
      const locations  = (issue?.location_credits || []).map(l => l.name).join(', ');

      res.json({
        Title: title,
        Series: series,
        Number: number,
        Summary: summary,
        Writer: writer,
        Penciller: penciller,
        Publisher: publisher,
        Characters: characters,
        Teams: teams,
        Locations: locations,
        'Cover Date': issue?.cover_date || '',
        'Store Date': issue?.store_date || '',
        _debug: {
          issuePublisher: issue?.publisher?.name || '',
          volumePublisherInline: issue?.volume?.publisher?.name || '',
          volumeId: issue?.volume?.id || null,
          volStatus,
          volUrl
        }
      });
    } catch (e) {
      res.status(e.status || 500).json({ message: formatErrorMessage(e, req, 'Failed to fetch issue details') });
    }
  });

  // ============================================================================
  // READING LISTS API
  // ============================================================================

  // Get all reading lists for current user with progress stats
  router.get('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const lists = await dbAll(
        'SELECT * FROM reading_lists WHERE userId = ? ORDER BY created DESC',
        [req.user.userId]
      );

      // Get stats for each list
      const listsWithStats = await Promise.all(lists.map(async (list) => {
        // Get all comic IDs in this list
        const items = await dbAll(
          'SELECT comicId FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
          [list.id]
        );

        const comicIds = items.map(item => item.comicId);
        const totalComics = comicIds.length;

        if (totalComics === 0) {
          return {
            ...list,
            totalComics: 0,
            readComics: 0,
            inProgressComics: 0,
            unreadComics: 0,
            progressPercent: 0
          };
        }

        // Get progress for these comics
        const placeholders = comicIds.map(() => '?').join(',');
        const progressRows = await dbAll(
          `SELECT comicId, lastReadPage, totalPages FROM user_comic_status
           WHERE userId = ? AND comicId IN (${placeholders})`,
          [req.user.userId, ...comicIds]
        );

        // Calculate status for each comic
        let readComics = 0;
        let inProgressComics = 0;
        let unreadComics = 0;

        comicIds.forEach(comicId => {
          const progress = progressRows.find(p => p.comicId === comicId);
          if (!progress || !progress.totalPages || progress.lastReadPage === 0) {
            unreadComics++;
          } else if (progress.lastReadPage >= progress.totalPages - 1) {
            readComics++;
          } else {
            inProgressComics++;
          }
        });

        const progressPercent = Math.round((readComics / totalComics) * 100);

        return {
          ...list,
          totalComics,
          readComics,
          inProgressComics,
          unreadComics,
          progressPercent
        };
      }));

      res.json({ ok: true, lists: listsWithStats });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to load reading lists')
      });
    }
  });

  // Create a new reading list
  router.post('/api/v1/reading-lists', requireAuth, async (req, res) => {
    try {
      const { name, description, comicIds } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'List name is required' });
      }

      const now = Date.now();
      const listId = createId(`${req.user.userId}:${name}:${now}`);

      // Create the list
      await dbRun(
        'INSERT INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
        [listId, req.user.userId, name.trim(), description || '', now, now]
      );

      // Add comics to the list if provided
      if (comicIds && Array.isArray(comicIds) && comicIds.length > 0) {
        const stmt = await Promise.all(comicIds.map((comicId, index) =>
          dbRun(
            'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [listId, comicId, now, index]
          )
        ));
      }

      res.json({ ok: true, listId });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to create reading list')
      });
    }
  });

  // Get reading list details with all comics
  router.get('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      const list = await dbGet(
        'SELECT * FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get comics in this list with their progress
      const items = await dbAll(
        `SELECT rli.comicId, rli.addedAt, rli.sortOrder,
                ucs.lastReadPage, ucs.totalPages
         FROM reading_list_items rli
         LEFT JOIN user_comic_status ucs ON rli.comicId = ucs.comicId AND ucs.userId = ?
         WHERE rli.listId = ?
         ORDER BY rli.sortOrder ASC`,
        [req.user.userId, req.params.id]
      );

      res.json({ ok: true, list, items });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to load reading list')
      });
    }
  });

  // Update reading list (name, description)
  router.put('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      const { name, description } = req.body;

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'List name is required' });
      }

      await dbRun(
        'UPDATE reading_lists SET name = ?, description = ?, updated = ? WHERE id = ?',
        [name.trim(), description || '', Date.now(), req.params.id]
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to update reading list')
      });
    }
  });

  // Delete reading list
  router.delete('/api/v1/reading-lists/:id', requireAuth, async (req, res) => {
    try {
      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Foreign key cascade will delete items
      await dbRun('DELETE FROM reading_lists WHERE id = ?', [req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to delete reading list')
      });
    }
  });

  // Add comics to reading list
  router.post('/api/v1/reading-lists/:id/comics', requireAuth, async (req, res) => {
    try {
      const { comicIds } = req.body;

      if (!comicIds || !Array.isArray(comicIds) || comicIds.length === 0) {
        return res.status(400).json({ message: 'Comic IDs are required' });
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get current max sort order
      const maxSort = await dbGet(
        'SELECT MAX(sortOrder) as maxOrder FROM reading_list_items WHERE listId = ?',
        [req.params.id]
      );

      let nextOrder = (maxSort?.maxOrder ?? -1) + 1;
      const now = Date.now();

      // Add comics (ignore duplicates)
      for (const comicId of comicIds) {
        try {
          await dbRun(
            'INSERT OR IGNORE INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
            [req.params.id, comicId, now, nextOrder]
          );
          nextOrder++;
        } catch (err) {
          // Skip if already exists
        }
      }

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [now, req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to add comics to reading list')
      });
    }
  });

  // Remove comics from reading list
  router.delete('/api/v1/reading-lists/:id/comics', requireAuth, async (req, res) => {
    try {
      const { comicIds } = req.body;

      if (!comicIds || !Array.isArray(comicIds) || comicIds.length === 0) {
        return res.status(400).json({ message: 'Comic IDs are required' });
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      const placeholders = comicIds.map(() => '?').join(',');
      await dbRun(
        `DELETE FROM reading_list_items WHERE listId = ? AND comicId IN (${placeholders})`,
        [req.params.id, ...comicIds]
      );

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [Date.now(), req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to remove comics from reading list')
      });
    }
  });

  // Reorder comics in reading list
  router.put('/api/v1/reading-lists/:id/reorder', requireAuth, async (req, res) => {
    try {
      const { comicOrder } = req.body; // Array of comicIds in new order

      if (!comicOrder || !Array.isArray(comicOrder)) {
        return res.status(400).json({ message: 'Comic order array is required' });
      }

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Update sort order for each comic
      for (let i = 0; i < comicOrder.length; i++) {
        await dbRun(
          'UPDATE reading_list_items SET sortOrder = ? WHERE listId = ? AND comicId = ?',
          [i, req.params.id, comicOrder[i]]
        );
      }

      // Update list timestamp
      await dbRun('UPDATE reading_lists SET updated = ? WHERE id = ?', [Date.now(), req.params.id]);

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to reorder comics')
      });
    }
  });

  // Mark all comics in reading list as read/unread
  router.post('/api/v1/reading-lists/:id/mark-read', requireAuth, async (req, res) => {
    try {
      const { read } = req.body; // boolean: true = mark read, false = mark unread

      // Verify ownership
      const list = await dbGet(
        'SELECT id FROM reading_lists WHERE id = ? AND userId = ?',
        [req.params.id, req.user.userId]
      );

      if (!list) {
        return res.status(404).json({ message: 'Reading list not found' });
      }

      // Get all comics in this list
      const items = await dbAll(
        'SELECT comicId FROM reading_list_items WHERE listId = ?',
        [req.params.id]
      );

      const now = Date.now();

      // Update status for each comic
      for (const item of items) {
        const comic = await dbGet('SELECT totalPages FROM comics WHERE id = ?', [item.comicId]);
        const totalPages = comic?.totalPages || 0;
        const lastReadPage = read ? (totalPages > 0 ? totalPages - 1 : 1) : 0;

        await dbRun(
          `INSERT INTO user_comic_status (userId, comicId, lastReadPage, totalPages, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(userId, comicId) DO UPDATE SET
             lastReadPage = excluded.lastReadPage,
             totalPages = excluded.totalPages,
             updatedAt = excluded.updatedAt`,
          [req.user.userId, item.comicId, lastReadPage, totalPages, now]
        );
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to update reading status')
      });
    }
  });

  // Export reading lists as JSON
  router.post('/api/v1/reading-lists/export', requireAuth, async (req, res) => {
    try {
      const { listIds } = req.body; // Optional: specific list IDs to export, or all if not provided

      let lists;
      if (listIds && Array.isArray(listIds) && listIds.length > 0) {
        const placeholders = listIds.map(() => '?').join(',');
        lists = await dbAll(
          `SELECT * FROM reading_lists WHERE userId = ? AND id IN (${placeholders})`,
          [req.user.userId, ...listIds]
        );
      } else {
        lists = await dbAll(
          'SELECT * FROM reading_lists WHERE userId = ?',
          [req.user.userId]
        );
      }

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        lists: await Promise.all(lists.map(async (list) => {
          const items = await dbAll(
            'SELECT comicId, sortOrder FROM reading_list_items WHERE listId = ? ORDER BY sortOrder ASC',
            [list.id]
          );

          return {
            name: list.name,
            description: list.description,
            comics: items.map(item => ({
              id: item.comicId,
              sortOrder: item.sortOrder
            }))
          };
        }))
      };

      res.json({ ok: true, ...exportData });
    } catch (error) {
      res.status(500).json({
        message: formatErrorMessage(error, req, 'Failed to export reading lists')
      });
    }
  });

  // Import reading lists from JSON
  router.post('/api/v1/reading-lists/import', requireAuth, async (req, res) => {
    try {
      const { lists } = req.body;

      if (!lists || !Array.isArray(lists)) {
        return res.status(400).json({ message: 'Invalid import data format' });
      }

      const now = Date.now();
      const imported = [];
      const skipped = [];

      for (const listData of lists) {
        try {
          const listId = createId(`${req.user.userId}:${listData.name}:${now}:${Math.random()}`);

          // Create list
          await dbRun(
            'INSERT INTO reading_lists (id, userId, name, description, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
            [listId, req.user.userId, listData.name, listData.description || '', now, now]
          );

          // Add comics (skip if comic doesn't exist)
          if (listData.comics && Array.isArray(listData.comics)) {
            for (const comic of listData.comics) {
              const exists = await dbGet('SELECT id FROM comics WHERE id = ?', [comic.id]);
              if (exists) {
                await dbRun(
                  'INSERT INTO reading_list_items (listId, comicId, addedAt, sortOrder) VALUES (?, ?, ?, ?)',
                  [listId, comic.id, now, comic.sortOrder || 0]
                );
              }
            }
          }

          imported.push(listData.name);
        } catch (err) {
          log('ERROR', 'API', `Failed to import list ${listData.name}: ${err.message}`);
          skipped.push(listData.name);
        }
      }

      res.json({ ok: true, imported, skipped });
    } catch (error) {
      res.status(400).json({
        message: formatErrorMessage(error, req, 'Failed to import reading lists')
      });
    }
  });

  return router;
}

module.exports = {
  createApiRouter
};
