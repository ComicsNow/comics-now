const { registerSyncClient, unregisterSyncClient } = require('../../services/sync-stream');

function attachUserSyncStreamRoutes(router, deps) {
  const { dbGet, validateDeviceId, formatErrorMessage, log } = deps;

  router.get('/api/v1/sync/stream', async (req, res) => {
    let closed = false;
    const userId = req.user?.userId || 'default-user';

    const cleanup = () => {
      closed = true;
      unregisterSyncClient(userId, res);
    };

    if (typeof req.on === 'function') {
      req.on('close', cleanup);
    }
    if (typeof res.on === 'function') {
      res.on('close', cleanup);
    }

    try {
      const devVal = validateDeviceId(req.query?.deviceId);
      if (!devVal.valid) {
        return res.status(400).json({ ok: false, message: devVal.error });
      }
      const deviceId = devVal.sanitized;

      const device = await dbGet('SELECT userId FROM devices WHERE deviceId = ?', [deviceId]);
      if (closed || res.destroyed || res.writableEnded) {
        return;
      }

      if (!device) {
        return res.status(404).json({ ok: false, message: 'Device not registered' });
      }

      if (device.userId !== userId) {
        log('WARN', 'SYNC', `User ${userId} attempted SSE stream for device ${deviceId} owned by ${device.userId}`);
        return res.status(403).json({ ok: false, message: 'Unauthorized device' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      req.socket?.setTimeout?.(0);
      res.setTimeout?.(0);

      if (closed || res.destroyed || res.writableEnded) {
        return;
      }

      registerSyncClient(userId, deviceId, res);
    } catch (error) {
      if (!res.headersSent && !res.writableEnded) {
        res.status(500).json({ ok: false, message: formatErrorMessage(error, req, 'Sync stream failed') });
      }
    }
  });
}

module.exports = attachUserSyncStreamRoutes;
