const fs = require('fs');

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
    cancelComicTagger,
    isTaggerRunning,
    applyUserSelection,
    skipCurrentMatch,
    getPendingMatch,
    getComicPages,
    getMimeFromExt,
    getComicVineApiKey,
    setComicVineApiKey,
    getGoogleBooksApiKey,
    setGoogleBooksApiKey,
    cvFetchJson,
    COMICVINE_API_URL,
    formatErrorMessage,
    getTaggerMode,
    setTaggerMode,
    getTaggerServiceUrl,
    setTaggerServiceUrl,
    getMetadataStorage,
    setMetadataStorage,
    getTaggerLowerThreshold,
    setTaggerLowerThreshold,
    getTaggerUpperThreshold,
    setTaggerUpperThreshold,
    getTaggerEnabledSources,
    setTaggerEnabledSources,
    getMetronUser,
    setMetronUser,
    getMetronPassword,
    setMetronPassword,
    getTaggerForceReprocess,
    setTaggerForceReprocess,
    searchExternal,
    getScanLogsList,
    getScanLogDetail,
    clearEnhancedTracking
  } = deps;

  // SSE Log Stream
  router.get('/api/v1/comictagger/stream', (req, res) => {
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

  // Settings / Schedule endpoint
  router.get('/api/v1/comictagger/schedule', (req, res) => {
    res.json({ 
      minutes: getCtScheduleMinutes ? getCtScheduleMinutes() : 60,
      comicsLocation: getComicsLocation ? getComicsLocation() : '',
      taggerMode: 'new',
      taggerServiceUrl: getTaggerServiceUrl ? getTaggerServiceUrl() : 'http://127.0.0.1:5000',
      metadataStorage: getMetadataStorage ? getMetadataStorage() : 'archive',
      lowerThreshold: getTaggerLowerThreshold ? getTaggerLowerThreshold() : 0.80,
      upperThreshold: getTaggerUpperThreshold ? getTaggerUpperThreshold() : 0.90,
      enabledSources: getTaggerEnabledSources ? getTaggerEnabledSources() : [],
      forceReprocess: getTaggerForceReprocess ? getTaggerForceReprocess() : false,
      metronUser: getMetronUser ? getMetronUser() : '',
      hasMetronPass: !!(getMetronPassword && getMetronPassword()),
      comicVineApiKey: getComicVineApiKey ? getComicVineApiKey() : '',
      googleBooksApiKey: getGoogleBooksApiKey ? getGoogleBooksApiKey() : ''
    });
  });

  router.post('/api/v1/comictagger/schedule', async (req, res) => {
    try {
      const {
        minutes = 60,
        comicsLocation,
        metadataStorage,
        lowerThreshold,
        upperThreshold,
        enabledSources,
        forceReprocess,
        metronUser,
        metronPassword,
        comicVineApiKey,
        googleBooksApiKey
      } = req.body || {};

      const mins = Math.max(0, parseInt(minutes, 10) || 0);
      if (setCtScheduleMinutes) setCtScheduleMinutes(mins);
      await saveSetting('ctScheduleMinutes', mins);
      
      if (comicsLocation && setComicsLocation) {
        setComicsLocation(comicsLocation);
      }

      if (metadataStorage && setMetadataStorage) {
        setMetadataStorage(metadataStorage);
        await saveSetting('metadata_storage', metadataStorage);
      }

      if (lowerThreshold !== undefined && setTaggerLowerThreshold) {
        setTaggerLowerThreshold(lowerThreshold);
        await saveSetting('taggerLowerThreshold', lowerThreshold);
      }

      if (upperThreshold !== undefined && setTaggerUpperThreshold) {
        setTaggerUpperThreshold(upperThreshold);
        await saveSetting('taggerUpperThreshold', upperThreshold);
      }

      if (enabledSources && setTaggerEnabledSources) {
        setTaggerEnabledSources(enabledSources);
        await saveSetting('taggerEnabledSources', enabledSources);
      }

      if (forceReprocess !== undefined && setTaggerForceReprocess) {
        setTaggerForceReprocess(forceReprocess);
        await saveSetting('taggerForceReprocess', forceReprocess);
      }

      if (metronUser !== undefined && setMetronUser) {
        setMetronUser(metronUser);
        await saveSetting('metronUser', metronUser);
      }

      if (metronPassword !== undefined && setMetronPassword && metronPassword.trim()) {
        setMetronPassword(metronPassword);
        await saveSetting('metronPassword', metronPassword);
      }

      if (comicVineApiKey !== undefined && setComicVineApiKey) {
        setComicVineApiKey(comicVineApiKey);
        await saveSetting('comicVineApiKey', comicVineApiKey);
      }

      if (googleBooksApiKey !== undefined && setGoogleBooksApiKey) {
        setGoogleBooksApiKey(googleBooksApiKey);
        await saveSetting('googleBooksApiKey', googleBooksApiKey);
      }

      if (scheduleCtRun) scheduleCtRun();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ message: formatErrorMessage(e, req, 'Failed to save settings') });
    }
  });

  // Available metadata sources list
  router.get('/api/v1/comictagger/sources', (req, res) => {
    const allSources = [
      { id: 'src-comicvine', label: 'ComicVine', requiresApiKey: true },
      { id: 'src-metron', label: 'Metron', requiresAuth: true },
      { id: 'src-gcd', label: 'Grand Comics Database (GCD)' },
      { id: 'src-lcg', label: 'League of Comic Geeks (LCG)' },
      { id: 'src-goodreads', label: 'Goodreads' },
      { id: 'src-blackwells', label: "Blackwell's" },
      { id: 'src-waterstones', label: 'Waterstones' },
      { id: 'src-googlebooks', label: 'Google Books', requiresApiKey: true },
      { id: 'src-amazon', label: 'Amazon' }
    ];
    const enabled = getTaggerEnabledSources ? getTaggerEnabledSources() : allSources.map(s => s.id);
    res.json({
      sources: allSources.map(s => ({
        ...s,
        enabled: enabled.includes(s.id)
      }))
    });
  });

  // Run Scan
  router.post('/api/v1/comictagger/run', async (req, res) => {
    try {
      const { force } = req.body || {};
      const shouldForce = force !== undefined ? !!force : (getTaggerForceReprocess ? getTaggerForceReprocess() : false);
      runComicTagger({ force: shouldForce });
      res.json({ ok: true, force: shouldForce });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'ComicTagger run failed') });
    }
  });

  // Cancel Scan
  router.post('/api/v1/comictagger/cancel', async (req, res) => {
    try {
      if (cancelComicTagger) {
        const cancelled = cancelComicTagger();
        return res.json({ ok: true, cancelled });
      }
      res.json({ ok: false, message: 'Cancel not supported' });
    } catch (e) {
      res.status(500).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to cancel scan') });
    }
  });

  // Apply Selection
  router.post('/api/v1/comictagger/apply', async (req, res) => {
    try {
      const { selections = [] } = req.body || {};
      await applyUserSelection(selections);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to apply selection') });
    }
  });

  // Skip Match
  router.post('/api/v1/comictagger/skip', async (req, res) => {
    try {
      skipCurrentMatch();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to skip match') });
    }
  });

  // Manual Search across enabled sources
  router.post('/api/v1/comictagger/search', async (req, res) => {
    try {
      const { source = 'comicvine', query = '' } = req.body || {};
      if (!query.trim()) {
        return res.status(400).json({ error: 'Search query is required' });
      }
      if (searchExternal) {
        const results = await searchExternal(source, query);
        return res.json({ ok: true, results });
      }
      res.status(501).json({ error: 'Search service not configured' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Scan Logs List
  router.get('/api/v1/comictagger/scan-logs', async (req, res) => {
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

  // Scan Log Detail
  router.get('/api/v1/comictagger/scan-logs/:id', async (req, res) => {
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

  // Clear Tracking History
  router.post('/api/v1/comictagger/clear-history', async (req, res) => {
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

  router.get('/api/v1/comictagger/logs', (req, res) => {
    res.json(getCtLogs());
  });

  router.get('/api/v1/comictagger/pending', (req, res) => {
    const pending = getPendingMatch();
    const running = isTaggerRunning ? isTaggerRunning() : false;
    res.json({
      ...(pending || {}),
      waitingForResponse: !!(pending && pending.waitingForResponse),
      isRunning: running
    });
  });

  // Get detailed pending match info
  router.get('/api/v1/comictagger/pending-details', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending || !pending.waitingForResponse) {
        return res.json({ waitingForResponse: false });
      }

      const { previewBuffer, ...safePending } = pending;
      const response = {
        ...safePending,
        firstPageUrl: null,
        matches: pending.matches || []
      };

      log('INFO', 'CT', `Returning pending details: ${response.matches.length} candidate(s)`);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.json(response);
    } catch (error) {
      log('ERROR', 'CT', `Failed to get pending details: ${error.message}`);
      res.status(500).json({ error: 'Failed to get pending details' });
    }
  });

  // Dedicated endpoint for the first page preview
  router.get('/api/v1/comictagger/preview', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending) {
        return res.status(404).end();
      }

      if (pending.previewBuffer && pending.previewMime) {
        res.setHeader('Content-Type', pending.previewMime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(pending.previewBuffer);
      }

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

  // Match cover enrichment fallback
  router.post('/api/v1/comictagger/match-covers', async (req, res) => {
    try {
      const { matches } = req.body;
      if (!Array.isArray(matches)) {
        return res.status(400).json({ error: 'matches must be an array' });
      }

      // If matches already contain coverUrl from tagger-replacement, return directly!
      const enriched = matches.map(m => ({
        ...m,
        coverUrl: m.coverUrl || m.metadata?.cover_image_url || null
      }));
      res.json({ matches: enriched });
    } catch (error) {
      res.json({ matches: req.body.matches || [] });
    }
  });
};
