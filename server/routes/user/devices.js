module.exports = function attach(router, deps) {
  const {
    dbGet, dbRun, dbAll, log, formatErrorMessage,
    validateFingerprint, validateDeviceId, validateDeviceName, createId,
    requireAuth
  } = deps;

  router.post('/api/v1/device/register', requireAuth, async (req, res) => {
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

  router.get('/api/v1/devices', requireAuth, async (req, res) => {
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

  router.delete('/api/v1/devices/:deviceId', requireAuth, async (req, res) => {
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

  router.get('/api/v1/sync/devices/:comicId', requireAuth, async (req, res) => {
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
};
