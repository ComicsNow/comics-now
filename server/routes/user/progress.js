const path = require('path');

/**
 * User Progress Routes
 * 
 * Handles per-user and per-device progress syncing and manual status updates.
 */
module.exports = function attach(router, deps) {
  const {
    dbGet,
    dbRun,
    dbAll,
    log,
    formatErrorMessage,
    resolvePath,
    validateLastReadPage,
    validateStatus
  } = deps;

  // ─────────── Sync Update Endpoints ───────────

  router.get('/api/v1/sync/check/:comicId', async (req, res) => {
    try {
      const { comicId } = req.params;
      const { deviceId, lastKnownPage = 0, lastKnownTimestamp = 0 } = req.query;
      if (!comicId || !deviceId) {
        return res.status(400).json({ ok: false, message: 'Missing parameters' });
      }

      // Get userId from authenticated user (or default if auth disabled)
      const userId = req.user?.userId || 'default-user';

      // Ownership check: Ensure deviceId belongs to userId
      const device = await dbGet(`SELECT userId FROM devices WHERE deviceId = ?`, [deviceId]);
      if (device && device.userId !== userId) {
        log('WARN', 'SYNC', `User ${userId} attempted to access device ${deviceId} owned by ${device.userId}`);
        return res.status(403).json({ ok: false, message: 'Unauthorized device' });
      }

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

      // Ownership check: Ensure deviceId belongs to userId
      const device = await dbGet(`SELECT userId FROM devices WHERE deviceId = ?`, [deviceId]);
      if (device && device.userId !== userId) {
        log('WARN', 'SYNC', `User ${userId} attempted to update device ${deviceId} owned by ${device.userId}`);
        return res.status(403).json({ ok: false, message: 'Unauthorized device' });
      }

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

  // ─────────── Manual Status Endpoints ───────────

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
      const { rootFolder: rawRootFolder = '', publisher, series, status } = req.body || {};
      const rootFolder = resolvePath(rawRootFolder);
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
};
