/**
 * User Story Arcs & Continuity Route Handler
 */
const { initReadingOrdersDb } = require('../../readingOrdersDb');
const { createContinuityMatcher } = require('../../services/continuityMatcher');
const { getReadingOrdersRunner } = require('../../services/reading-orders-runner');
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

  // GET /api/v1/story-arcs/:arcId
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

  // GET /api/v1/story-arcs/sync/status
  router.get('/api/v1/story-arcs/sync/status', (req, res) => {
    return res.json({ ok: true, ...runner.getStatus() });
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
}

module.exports = attachUserStoryArcsRoutes;
