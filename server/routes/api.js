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
      // Get all unique libraries, publishers, series from comics
      const comics = await dbAll(`
        SELECT DISTINCT
          publisher as library,
          publisher,
          series
        FROM comics
        WHERE publisher IS NOT NULL
        ORDER BY publisher, series
      `);

      // Build hierarchical tree structure
      const tree = {};
      for (const comic of comics) {
        const lib = comic.library || 'Unknown Library';
        const pub = comic.publisher || 'Unknown Publisher';
        const ser = comic.series || 'Unknown Series';

        if (!tree[lib]) {
          tree[lib] = {};
        }
        if (!tree[lib][pub]) {
          tree[lib][pub] = new Set();
        }
        tree[lib][pub].add(ser);
      }

      // Convert Sets to arrays for JSON serialization
      const result = {};
      for (const lib in tree) {
        result[lib] = {};
        for (const pub in tree[lib]) {
          result[lib][pub] = Array.from(tree[lib][pub]);
        }
      }

      res.json({ ok: true, tree: result });
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
        'SELECT accessType, accessValue, granted FROM user_library_access WHERE userId = ? AND granted = 1',
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
      const { access } = req.body; // access is an array of { accessType, accessValue, granted }

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

      // Insert new access permissions
      if (access.length > 0) {
        for (const item of access) {
          if (!item.accessType || !item.accessValue) continue;
          const granted = item.granted === false ? 0 : 1; // Default to granted
          await dbRun(
            'INSERT INTO user_library_access (userId, accessType, accessValue, granted) VALUES (?, ?, ?, ?)',
            [userId, item.accessType, item.accessValue, granted]
          );
        }
      }

      log('INFO', 'ACCESS', `Updated access permissions for user ${userId}: ${access.length} entries`);
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
      const rows = await dbAll('SELECT * FROM comics');
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
          results.push({
            id: r.id,
            name: r.name,
            path: r.path,
            thumbnailPath: r.thumbnailPath,
            progress: { lastReadPage: r.lastReadPage || 0, totalPages: r.totalPages || 0 },
            metadata: meta,
            series: r.series,
            mangaMode: r.mangaMode === 1 || r.mangaMode === true
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

  // Toggle manga mode for a comic
  router.post('/api/v1/comics/manga-mode', requireAuth, async (req, res) => {
    try {
      const { comicId, mangaMode } = req.body;
      if (!comicId || typeof mangaMode !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'Bad request' });
      }

      const comic = await dbGet('SELECT id FROM comics WHERE id = ?', [comicId]);
      if (!comic) {
        return res.status(404).json({ ok: false, message: 'Comic not found' });
      }

      await dbRun('UPDATE comics SET mangaMode = ? WHERE id = ?', [mangaMode ? 1 : 0, comicId]);

      log('INFO', 'MANGA_MODE', `Comic ${comicId} manga mode set to ${mangaMode}`);

      res.json({
        ok: true,
        mangaMode
      });
    } catch (e) {
      log('ERROR', 'MANGA_MODE', `Failed to update manga mode: ${e.message}`);
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to update manga mode') });
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

  return router;
}

module.exports = {
  createApiRouter
};
