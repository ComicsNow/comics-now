const cryptoVault = require('../../utils/crypto-vault');

module.exports = function attach(router, deps) {
  const {
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

      if (body.useModal !== undefined) {
        await saveSetting(guidedReader.SETTINGS_KEYS.useModal, !!body.useModal);
      }
      if (body.modalTokenId !== undefined) {
        await saveSetting(guidedReader.SETTINGS_KEYS.modalTokenId, String(body.modalTokenId).trim());
      }
      if (body.modalTokenSecret !== undefined && String(body.modalTokenSecret).trim() !== '' && !cryptoVault.isMasked(body.modalTokenSecret)) {
        await saveSetting(guidedReader.SETTINGS_KEYS.modalTokenSecret, cryptoVault.encrypt(String(body.modalTokenSecret).trim()));
      }
      if (body.modalEnvironment !== undefined) {
        await saveSetting(guidedReader.SETTINGS_KEYS.modalEnvironment, String(body.modalEnvironment).trim());
      }
      if (body.concurrency !== undefined) {
        const conc = Math.min(Math.max(Number(body.concurrency) || 2, 1), 2);
        await saveSetting(guidedReader.SETTINGS_KEYS.concurrency, conc);
      }

      await guidedReader.applySettingsChanged();

      const savedSettings = await guidedReader.getSettings();
      res.json({ ok: true, settings: savedSettings });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to save guided settings') });
    }
  });

  router.get('/api/v1/guided/modal-credits', async (req, res) => {
    try {
      const detector = deps.modalDetector || (guidedReader && guidedReader.modalDetector) || require('../../services/modal-detector');
      const settings = await guidedReader.getSettings();

      let modalTokenSecret = '';
      if (deps.dbGet) {
        const row = await deps.dbGet('SELECT value FROM settings WHERE key = ?', [guidedReader.SETTINGS_KEYS.modalTokenSecret]);
        try { modalTokenSecret = row ? JSON.parse(row.value) : ''; } catch { modalTokenSecret = row?.value || ''; }
        modalTokenSecret = cryptoVault.decrypt(modalTokenSecret);
      }

      const result = await detector.checkCredits({
        modalTokenId: settings.modalTokenId,
        modalTokenSecret,
        modalEnvironment: settings.modalEnvironment
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: formatErrorMessage(e, req, 'Failed to check Modal credits') });
    }
  });

  router.get('/api/v1/guided/modal-status', async (req, res) => {
    try {
      const detector = deps.modalDetector || (guidedReader && guidedReader.modalDetector) || require('../../services/modal-detector');
      const settings = await guidedReader.getSettings();

      let modalTokenSecret = '';
      if (deps.dbGet) {
        const row = await deps.dbGet('SELECT value FROM settings WHERE key = ?', [guidedReader.SETTINGS_KEYS.modalTokenSecret]);
        try { modalTokenSecret = row ? JSON.parse(row.value) : ''; } catch { modalTokenSecret = row?.value || ''; }
        modalTokenSecret = cryptoVault.decrypt(modalTokenSecret);
      }

      const result = await detector.checkEnvironment({
        modalTokenId: settings.modalTokenId,
        modalTokenSecret,
        modalEnvironment: settings.modalEnvironment
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: formatErrorMessage(e, req, 'Failed to check Modal environment') });
    }
  });

  router.post('/api/v1/guided/modal-setup', async (req, res) => {
    try {
      const body = req.body || {};
      const detector = deps.modalDetector || (guidedReader && guidedReader.modalDetector) || require('../../services/modal-detector');
      const settings = await guidedReader.getSettings();

      const modalTokenId = body.modalTokenId !== undefined ? body.modalTokenId : settings.modalTokenId;
      const modalEnvironment = body.modalEnvironment !== undefined ? body.modalEnvironment : settings.modalEnvironment;

      let modalTokenSecret = body.modalTokenSecret;
      if ((modalTokenSecret === undefined || modalTokenSecret === '' || cryptoVault.isMasked(modalTokenSecret)) && deps.dbGet) {
        const row = await deps.dbGet('SELECT value FROM settings WHERE key = ?', [guidedReader.SETTINGS_KEYS.modalTokenSecret]);
        try { modalTokenSecret = row ? JSON.parse(row.value) : ''; } catch { modalTokenSecret = row?.value || ''; }
      }
      modalTokenSecret = cryptoVault.decrypt(modalTokenSecret);

      const result = await detector.setupEnvironment({
        modalTokenId,
        modalTokenSecret,
        modalEnvironment
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: formatErrorMessage(e, req, 'Failed to setup Modal environment') });
    }
  });

  router.post('/api/v1/guided/modal-test', async (req, res) => {
    try {
      const body = req.body || {};
      const detector = deps.modalDetector || (guidedReader && guidedReader.modalDetector) || require('../../services/modal-detector');
      const settings = await guidedReader.getSettings();

      const modalTokenId = body.modalTokenId !== undefined ? body.modalTokenId : settings.modalTokenId;
      const modalEnvironment = body.modalEnvironment !== undefined ? body.modalEnvironment : settings.modalEnvironment;

      let modalTokenSecret = body.modalTokenSecret;
      if ((modalTokenSecret === undefined || modalTokenSecret === '' || cryptoVault.isMasked(modalTokenSecret)) && deps.dbGet) {
        const row = await deps.dbGet('SELECT value FROM settings WHERE key = ?', [guidedReader.SETTINGS_KEYS.modalTokenSecret]);
        try { modalTokenSecret = row ? JSON.parse(row.value) : ''; } catch { modalTokenSecret = row?.value || ''; }
      }
      modalTokenSecret = cryptoVault.decrypt(modalTokenSecret);

      const result = await detector.checkCredits({
        modalTokenId,
        modalTokenSecret,
        modalEnvironment
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: formatErrorMessage(e, req, 'Failed to test Modal connection') });
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
      const { scope, target, force } = req.body || {};
      const validScopes = ['comic', 'series', 'publisher', 'library'];
      if (!validScopes.includes(scope) || !target || typeof target !== 'string') {
        return res.status(400).json({ ok: false, message: 'scope must be comic|series|publisher|library and target must be a non-empty string' });
      }
      const started = guidedReader.startRunForScope(scope, target, { force: !!force });
      if (!started) {
        return res.status(409).json({ ok: false, message: 'A guided run is already in progress' });
      }
      res.json({ ok: true, started, scope, target, force: !!force });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to start scoped guided run') });
    }
  });

  // Cancel the entire batch (drop the whole queue + stop).
  router.post('/api/v1/guided/cancel', (req, res) => {
    try {
      const cancelled = guidedReader.cancelAll();
      res.json({ ok: true, cancelled });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to cancel guided run') });
    }
  });

  // Skip only the currently-processing comic; the rest of the queue continues.
  router.post('/api/v1/guided/cancel-current', (req, res) => {
    try {
      const comicId = req.body?.id || req.query?.id || null;
      const cancelled = guidedReader.cancelCurrent(comicId);
      res.json({ ok: true, cancelled });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to cancel current job') });
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
