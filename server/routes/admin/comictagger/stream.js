module.exports = function attachStreamRoutes(router, deps) {
  const {
    registerCtClient,
    unregisterCtClient,
    getCtLogs,
    getScanLogsList,
    getScanLogDetail,
    clearEnhancedTracking
  } = deps;

  router.get('/api/v1/tag-comics-now/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    registerCtClient(res);
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

  router.get('/api/v1/tag-comics-now/logs', (req, res) => {
    res.json(getCtLogs ? getCtLogs() : []);
  });

  router.get('/api/v1/tag-comics-now/scan-logs', async (req, res) => {
    try {
      if (getScanLogsList) {
        const rawLogs = await getScanLogsList();
        const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs && Array.isArray(rawLogs.logs) ? rawLogs.logs : []);
        return res.json({ ok: true, logs });
      }
      res.json({ ok: true, logs: [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/v1/tag-comics-now/scan-logs/:id', async (req, res) => {
    try {
      if (getScanLogDetail) {
        const detail = await getScanLogDetail(req.params.id);
        return res.json({ ok: true, log: detail });
      }
      res.status(404).json({ error: 'Log not found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/api/v1/tag-comics-now/clear-history', async (req, res) => {
    try {
      if (clearEnhancedTracking) {
        const result = await clearEnhancedTracking();
        return res.json({ ok: true, result });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
