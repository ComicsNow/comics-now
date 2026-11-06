/**
 * Story Arcs & Continuity Express Router
 *
 * Exposes story arc lists, detailed reading sequences, and comic continuity lookups.
 */
const express = require('express');

function createStoryArcsRouter(routerInstance, deps = {}) {
  const router = routerInstance || express.Router();
  const matcher = deps.continuityMatcher;

  // GET /api/v1/story-arcs?publisher=:pub
  router.get('/', async (req, res) => {
    try {
      const publisher = req.query.publisher || null;
      if (!matcher) {
        return res.status(503).json({ ok: false, error: 'Continuity matcher not initialized' });
      }
      const storyArcs = await matcher.getStoryArcsForPublisher(publisher);
      return res.json({ ok: true, storyArcs });
    } catch (err) {
      console.error('[StoryArcsAPI] Error fetching story arcs:', err);
      return res.status(500).json({ ok: false, error: 'Failed to fetch story arcs' });
    }
  });

  // GET /api/v1/story-arcs/:arcId
  router.get('/:arcId', async (req, res) => {
    try {
      const { arcId } = req.params;
      if (!matcher) {
        return res.status(503).json({ ok: false, error: 'Continuity matcher not initialized' });
      }
      const storyArc = await matcher.getStoryArcDetails(arcId);
      if (!storyArc) {
        return res.status(404).json({ ok: false, error: 'Story arc not found' });
      }
      return res.json({ ok: true, storyArc });
    } catch (err) {
      console.error('[StoryArcsAPI] Error fetching story arc details:', err);
      return res.status(500).json({ ok: false, error: 'Failed to fetch story arc details' });
    }
  });

  // GET /api/v1/story-arcs/continuity/lookup?series=:s&issue=:i
  router.get('/continuity/lookup', async (req, res) => {
    try {
      const { series, issue } = req.query;
      if (!series || !issue) {
        return res.status(400).json({ ok: false, error: 'series and issue parameters required' });
      }
      if (!matcher) {
        return res.status(503).json({ ok: false, error: 'Continuity matcher not initialized' });
      }
      const continuity = await matcher.getComicContinuity(series, issue);
      const comicInfo = matcher.getComicInfoMetadata(series, issue);
      return res.json({ ok: true, continuity, comicInfo });
    } catch (err) {
      console.error('[StoryArcsAPI] Error looking up continuity:', err);
      return res.status(500).json({ ok: false, error: 'Failed to lookup continuity' });
    }
  });

  return router;
}

module.exports = {
  createStoryArcsRouter
};
