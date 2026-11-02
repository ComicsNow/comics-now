const fs = require('fs');

const VALID_SCAN_MODES = ['default', 'unmatched', 'existing-xml', 'force'];

module.exports = function attachExecutionRoutes(router, deps) {
  const {
    log,
    runComicTagger,
    resolveScanMode,
    getScanScopeCounts,
    cancelComicTagger,
    isTaggerRunning,
    applyUserSelection,
    skipCurrentMatch,
    getPendingMatch,
    getComicPages,
    getMimeFromExt,
    formatErrorMessage,
    searchExternal,
    extractPageBuffer
  } = deps;

  router.post('/api/v1/tag-comics-now/run', async (req, res) => {
    try {
      const { force, mode } = req.body || {};
      if (mode !== undefined && !VALID_SCAN_MODES.includes(mode)) {
        return res.status(400).json({ ok: false, message: 'Invalid scan mode' });
      }
      const resolved = resolveScanMode
        ? resolveScanMode({ force, mode })
        : (mode || (force ? 'force' : 'default'));
      runComicTagger({ force, mode });
      res.json({ ok: true, mode: resolved });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Tag Comics Now! run failed') });
    }
  });

  router.get('/api/v1/tag-comics-now/scope-counts', async (req, res) => {
    try {
      const counts = getScanScopeCounts ? await getScanScopeCounts() : { unmatched: 0 };
      res.json({ ok: true, unmatched: counts.unmatched });
    } catch (e) {
      res.status(500).json({ ok: false, unmatched: 0, message: formatErrorMessage(e, req, 'Failed to get scan scope counts') });
    }
  });

  router.post('/api/v1/tag-comics-now/cancel', async (req, res) => {
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

  router.post('/api/v1/tag-comics-now/apply', async (req, res) => {
    try {
      const { selections = [] } = req.body || {};
      await applyUserSelection(selections);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to apply selection') });
    }
  });

  router.post('/api/v1/tag-comics-now/skip', async (req, res) => {
    try {
      skipCurrentMatch();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, message: formatErrorMessage(e, req, 'Failed to skip match') });
    }
  });

  router.post('/api/v1/tag-comics-now/search', async (req, res) => {
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

  router.get('/api/v1/tag-comics-now/pending', (req, res) => {
    const pending = getPendingMatch();
    const running = isTaggerRunning ? isTaggerRunning() : false;
    const { previewBuffer, waitingLogId, ...safePending } = pending || {};
    res.json({
      ...safePending,
      waitingForResponse: !!(pending && pending.waitingForResponse),
      isRunning: running
    });
  });

  router.get('/api/v1/tag-comics-now/pending-details', async (req, res) => {
    try {
      const pending = getPendingMatch();
      if (!pending || !pending.waitingForResponse) {
        return res.json({ waitingForResponse: false });
      }

      const { previewBuffer, waitingLogId, ...safePending } = pending;
      const response = {
        ...safePending,
        firstPageUrl: null,
        matches: pending.matches || []
      };

      if (log) log('INFO', 'CT', `Returning pending details: ${response.matches.length} candidate(s)`);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.json(response);
    } catch (error) {
      if (log) log('ERROR', 'CT', `Failed to get pending details: ${error.message}`);
      res.status(500).json({ error: 'Failed to get pending details' });
    }
  });

  router.get('/api/v1/tag-comics-now/preview', async (req, res) => {
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
      const bufferExtractor = extractPageBuffer || deps.extractPageBuffer;
      const imageBuffer = await bufferExtractor(pending.filePath, firstPage);

      if (!imageBuffer) {
        return res.status(404).end();
      }

      const mimeType = getMimeFromExt(firstPage);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(imageBuffer);
    } catch (error) {
      if (log) log('ERROR', 'CT', `Failed to get preview image: ${error.message}`);
      res.status(500).end();
    }
  });

  router.post('/api/v1/tag-comics-now/match-covers', async (req, res) => {
    try {
      const { matches } = req.body;
      if (!Array.isArray(matches)) {
        return res.status(400).json({ error: 'matches must be an array' });
      }

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
