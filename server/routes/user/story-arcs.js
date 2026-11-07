/**
 * User Story Arcs & Continuity Route Handler
 */
const { initReadingOrdersDb } = require('../../readingOrdersDb');
const { createContinuityMatcher } = require('../../services/continuityMatcher');
const { getReadingOrdersRunner } = require('../../services/reading-orders-runner');
const { getStoryArcsBatchTagger } = require('../../services/story-arcs-batch-tagger');
const {
  registerStoryArcsClient,
  unregisterStoryArcsClient,
  getStoryArcsLogs,
  clearStoryArcsLogs
} = require('../../logger');

function attachUserStoryArcsRoutes(router, deps) {
  if (!router || typeof router.get !== 'function') return;
  const { dbAll, requireAdminAuth } = deps || {};
  const syncMiddlewares = typeof requireAdminAuth === 'function' ? [requireAdminAuth] : [];
  let readingOrdersDbInstance = null;
  let matcherInstance = null;
  const runner = getReadingOrdersRunner();
  const batchTagger = getStoryArcsBatchTagger();

  function getMatcher() {
    if (!matcherInstance) {
      try {
        readingOrdersDbInstance = initReadingOrdersDb();
        matcherInstance = createContinuityMatcher({
          readingOrdersDb: readingOrdersDbInstance,
          getComics: () => {
            try {
              // Read library comics synchronously via better-sqlite3 or prepared query
              if (typeof dbAll === 'function') {
                return dbAll('SELECT id, publisher, series, name, metadata FROM comics');
              }
              return [];
            } catch (err) {
              console.warn('[StoryArcsRoute] Error fetching comics for matcher:', err);
              return [];
            }
          }
        });
      } catch (err) {
        console.warn('[StoryArcsRoute] Error initializing reading-orders.db:', err.message);
        return null;
      }
    }
    return matcherInstance;
  }

  // GET /api/v1/story-arcs
  router.get('/api/v1/story-arcs', async (req, res) => {
    try {
      const matcher = getMatcher();
      if (!matcher) {
        return res.json({ ok: true, storyArcs: [] });
      }
      const publisher = req.query.publisher || null;
      const storyArcs = await matcher.getStoryArcsForPublisher(publisher);
      return res.json({ ok: true, storyArcs });
    } catch (err) {
      console.error('[StoryArcsRoute] Error fetching story arcs:', err);
      return res.status(500).json({ ok: false, error: 'Failed to fetch story arcs' });
    }
  });

  // GET /api/v1/story-arcs/continuity/lookup
  router.get('/api/v1/story-arcs/continuity/lookup', async (req, res) => {
    try {
      const matcher = getMatcher();
      if (!matcher) {
        return res.json({ ok: true, continuity: null, comicInfo: null });
      }
      const { series, issue } = req.query;
      if (!series || !issue) {
        return res.status(400).json({ ok: false, error: 'series and issue parameters required' });
      }
      const continuity = await matcher.getComicContinuity(series, issue);
      const comicInfo = matcher.getComicInfoMetadata(series, issue);
      return res.json({ ok: true, continuity, comicInfo });
    } catch (err) {
      console.error('[StoryArcsRoute] Error looking up continuity:', err);
      return res.status(500).json({ ok: false, error: 'Failed to lookup continuity' });
    }
  });

  // GET /api/v1/comics/:comicId/continuity
  router.get('/api/v1/comics/:comicId/continuity', async (req, res) => {
    try {
      const comicId = req.params.comicId;
      const comic = deps.dbGet ? deps.dbGet('SELECT id, name, series, metadata, lastReadPage, totalPages FROM comics WHERE id = ?', [comicId]) : null;
      if (!comic) {
        return res.json({ ok: true, hasArc: false, earlierUnread: [] });
      }

      const matcher = getMatcher();
      if (!matcher) {
        return res.json({ ok: true, hasArc: false, earlierUnread: [] });
      }

      let parsedMeta = {};
      try {
        parsedMeta = typeof comic.metadata === 'string' ? JSON.parse(comic.metadata) : (comic.metadata || {});
      } catch (_) {}

      const issueNum = parsedMeta.Number || (comic.name ? comic.name.match(/#?(\d+(\.\d+)?)/)?.[1] : null) || '1';
      const continuity = await matcher.getComicContinuity(comic.series, issueNum);

      if (!continuity || !continuity.arcId) {
        return res.json({ ok: true, hasArc: false, earlierUnread: [] });
      }

      const arcDetails = await matcher.getStoryArcDetails(continuity.arcId);
      const earlierIssues = (arcDetails?.issues || []).filter(iss => iss.position < continuity.position && iss.isOwned && iss.comicId);

      const earlierUnread = [];
      for (const iss of earlierIssues) {
        const row = deps.dbGet ? deps.dbGet('SELECT id, name, lastReadPage, totalPages FROM comics WHERE id = ?', [iss.comicId]) : null;
        if (row) {
          const total = Number(row.totalPages) || 1;
          const last = Number(row.lastReadPage) || 0;
          if (last < total - 1) {
            earlierUnread.push({
              id: row.id,
              name: row.name || `${iss.seriesName} #${iss.issueNumber}`,
              position: iss.position,
              seriesName: iss.seriesName,
              issueNumber: iss.issueNumber
            });
          }
        }
      }

      return res.json({
        ok: true,
        hasArc: true,
        arcId: continuity.arcId,
        arcTitle: continuity.arcTitle,
        position: continuity.position,
        earlierUnread
      });
    } catch (err) {
      console.error('[StoryArcsRoute] Error checking comic continuity:', err);
      return res.json({ ok: true, hasArc: false, earlierUnread: [] });
    }
  });

  // GET /api/v1/story-arcs/sync/status
  router.get('/api/v1/story-arcs/sync/status', (req, res) => {
    return res.json({ ok: true, ...runner.getStatus() });
  });

  // POST /api/v1/story-arcs/sync
  router.post('/api/v1/story-arcs/sync', ...syncMiddlewares, async (req, res) => {
    try {
      const { mode, force } = req.body || {};
      const status = runner.getStatus();
      if (status.isSyncing) {
        return res.status(409).json({ ok: false, error: 'Synchronization is already in progress' });
      }
      runner.startSync({ mode: mode || 'both', force: !!force }).catch(err => {
        console.error('[StoryArcsRoute] Background sync error:', err);
      });
      return res.json({ ok: true, message: 'Sync started' });
    } catch (err) {
      console.error('[StoryArcsRoute] Error triggering sync:', err);
      return res.status(500).json({ ok: false, error: 'Failed to start sync' });
    }
  });

  // POST /api/v1/story-arcs/sync/cancel
  router.post('/api/v1/story-arcs/sync/cancel', ...syncMiddlewares, (req, res) => {
    const cancelled = runner.cancelSync();
    return res.json({ ok: true, cancelled });
  });

  // GET /api/v1/story-arcs/stream
  router.get('/api/v1/story-arcs/stream', ...syncMiddlewares, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': keepalive\n\n');

    // Send existing recent logs
    const existing = getStoryArcsLogs();
    for (const entry of existing) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    registerStoryArcsClient(res);
    req.on('close', () => {
      unregisterStoryArcsClient(res);
    });
  });

  // GET /api/v1/story-arcs/logs
  router.get('/api/v1/story-arcs/logs', ...syncMiddlewares, (req, res) => {
    return res.json({ ok: true, logs: getStoryArcsLogs() });
  });

  // DELETE /api/v1/story-arcs/logs
  router.delete('/api/v1/story-arcs/logs', ...syncMiddlewares, (req, res) => {
    clearStoryArcsLogs();
    return res.json({ ok: true });
  });

  // GET /api/v1/story-arcs/batch-tag/publishers
  router.get('/api/v1/story-arcs/batch-tag/publishers', (req, res) => {
    return res.json({ ok: true, publishers: batchTagger.getStoryArcPublishers() });
  });

  // GET /api/v1/story-arcs/batch-tag/status
  router.get('/api/v1/story-arcs/batch-tag/status', (req, res) => {
    return res.json({ ok: true, ...batchTagger.getStatus() });
  });

  // POST /api/v1/story-arcs/batch-tag
  router.post('/api/v1/story-arcs/batch-tag', ...syncMiddlewares, async (req, res) => {
    try {
      const { publisher } = req.body || {};
      const status = batchTagger.getStatus();
      if (status.isRunning) {
        return res.status(409).json({ ok: false, error: 'Batch enrichment is already in progress' });
      }
      batchTagger.startBatchTag({ publisher: publisher || 'all' }).catch(err => {
        console.error('[StoryArcsRoute] Batch tagger background error:', err);
      });
      return res.json({ ok: true, message: 'Batch enrichment started' });
    } catch (err) {
      console.error('[StoryArcsRoute] Error starting batch enrichment:', err);
      return res.status(500).json({ ok: false, error: 'Failed to start batch enrichment' });
    }
  });

  // POST /api/v1/story-arcs/batch-tag/cancel
  router.post('/api/v1/story-arcs/batch-tag/cancel', ...syncMiddlewares, (req, res) => {
    const cancelled = batchTagger.cancelBatchTag();
    return res.json({ ok: true, cancelled });
  });

  // GET /api/v1/story-arcs/:arcId (parameterized fallback, must remain after all static routes)
  router.get('/api/v1/story-arcs/:arcId', async (req, res) => {
    try {
      const matcher = getMatcher();
      if (!matcher) {
        return res.status(503).json({ ok: false, error: 'Continuity database not available' });
      }
      const storyArc = await matcher.getStoryArcDetails(req.params.arcId);
      if (!storyArc) {
        return res.status(404).json({ ok: false, error: 'Story arc not found' });
      }
      return res.json({ ok: true, storyArc });
    } catch (err) {
      console.error('[StoryArcsRoute] Error fetching story arc detail:', err);
      return res.status(500).json({ ok: false, error: 'Failed to fetch story arc detail' });
    }
  });
}

module.exports = attachUserStoryArcsRoutes;
