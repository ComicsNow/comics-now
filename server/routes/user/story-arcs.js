/**
 * User Story Arcs & Continuity Route Handler
 */
const { initReadingOrdersDb } = require('../../readingOrdersDb');
const { createContinuityMatcher } = require('../../services/continuityMatcher');

function attachUserStoryArcsRoutes(router, deps) {
  if (!router || typeof router.get !== 'function') return;
  const { dbAll } = deps || {};
  let readingOrdersDbInstance = null;
  let matcherInstance = null;

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
}

module.exports = attachUserStoryArcsRoutes;
