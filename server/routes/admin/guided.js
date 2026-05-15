module.exports = function attach(router, deps) {
  const {
    log,
    guidedReader,
    formatErrorMessage,
    saveSetting,
    getGuidedLogs,
    clearGuidedLogs,
    registerGuidedClient,
    unregisterGuidedClient
  } = deps;

  router.get('/api/v1/guided/status', async (req, res) => {
    try {
      res.json(await guidedReader.getStatus());
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to fetch guided status') });
    }
  });

  router.get('/api/v1/guided/settings', async (req, res) => {
    try {
      res.json(await guidedReader.getSettings());
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to fetch guided settings') });
    }
  });

  router.post('/api/v1/guided/settings', async (req, res) => {
    try {
      const body = req.body || {};
      const autoOnAdd = !!body.autoOnAdd;
      const scheduleEnabled = !!body.scheduleEnabled;
      const intervalRaw = parseInt(body.scheduleInterval, 10);
      const scheduleInterval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.min(intervalRaw, 365 * 24) : 24;
      const scheduleUnit = body.scheduleUnit === 'days' ? 'days' : 'hours';

      await saveSetting(guidedReader.SETTINGS_KEYS.autoOnAdd, autoOnAdd);
      await saveSetting(guidedReader.SETTINGS_KEYS.scheduleEnabled, scheduleEnabled);
      await saveSetting(guidedReader.SETTINGS_KEYS.scheduleInterval, scheduleInterval);
      await saveSetting(guidedReader.SETTINGS_KEYS.scheduleUnit, scheduleUnit);
      await guidedReader.applySettingsChanged();

      res.json({ ok: true, settings: { autoOnAdd, scheduleEnabled, scheduleInterval, scheduleUnit } });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save guided settings') });
    }
  });

  router.post('/api/v1/guided/run', (req, res) => {
    try {
      const started = guidedReader.startRun();
      res.json({ ok: true, started });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to start guided run') });
    }
  });

  router.post('/api/v1/guided/run-scope', (req, res) => {
    try {
      const { scope, target } = req.body || {};
      const validScopes = ['comic', 'series', 'publisher', 'library'];
      if (!validScopes.includes(scope) || !target || typeof target !== 'string') {
        return res.status(400).json({ ok: false, message: 'scope must be comic|series|publisher|library and target must be a non-empty string' });
      }
      const started = guidedReader.startRunForScope(scope, target);
      if (!started) {
        return res.status(409).json({ ok: false, message: 'A guided run is already in progress' });
      }
      res.json({ ok: true, started, scope, target });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to start scoped guided run') });
    }
  });

  router.post('/api/v1/guided/cancel', (req, res) => {
    try {
      const cancelled = guidedReader.cancelRun();
      res.json({ ok: true, cancelled });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to cancel guided run') });
    }
  });

  router.get('/api/v1/guided/logs', (req, res) => {
    res.json(getGuidedLogs());
  });

  router.post('/api/v1/guided/logs/clear', (req, res) => {
    clearGuidedLogs();
    res.json({ ok: true });
  });

  router.get('/api/v1/guided/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Tell reverse proxies (Cloudflare, nginx) NOT to buffer this response.
    res.setHeader('X-Accel-Buffering', 'no');
    
    registerGuidedClient(res);

    if (res.socket && typeof res.socket.setNoDelay === 'function') {
      res.socket.setNoDelay(true);
    }

    // Initial keep-alive to help establish connection
    res.write(':ok\n\n');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Replay buffered logs
    for (const entry of getGuidedLogs()) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      unregisterGuidedClient(res);
    });
  });
};
