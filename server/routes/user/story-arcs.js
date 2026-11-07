/**
 * User Story Arcs & Continuity Route Handler (Reverse Proxy to Python Service)
 *
 * Proxies all story arc crawler, sync, matching, and batch tagging operations
 * to the Python Tag Comics Now service (http://127.0.0.1:5000/api/story-arcs/*).
 */
const http = require('http');

function getTaggerBaseUrl(deps) {
  return (deps && typeof deps.getTaggerServiceUrl === 'function' && deps.getTaggerServiceUrl()) ||
         (deps && deps.config && deps.config.taggerServiceUrl) ||
         process.env.TAGGER_SERVICE_URL ||
         'http://127.0.0.1:5000';
}

function attachUserStoryArcsRoutes(router, deps) {
  if (!router || typeof router.get !== 'function') return;
  const adminGuard = deps?.requireAdminAuth || deps?.requireAdmin;
  const syncMiddlewares = typeof adminGuard === 'function' ? [adminGuard] : [];

  // Helper for JSON proxy requests
  async function proxyJson(req, res, targetPath, method = 'GET', body = null) {
    try {
      const baseUrl = getTaggerBaseUrl(deps);
      const url = new URL(targetPath, baseUrl);
      if (req.query) {
        for (const [k, v] of Object.entries(req.query)) {
          if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }
      }
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      };
      if (body) {
        opts.body = JSON.stringify(body);
      }
      const upstream = await fetch(url.toString(), opts);
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    } catch (err) {
      console.warn(`[StoryArcsProxy] Error proxying ${method} ${targetPath}:`, err.message);
      if (method === 'GET' && targetPath === '/api/story-arcs') {
        return res.json({ ok: true, storyArcs: [] });
      }
      return res.status(502).json({ ok: false, error: 'Tag Comics Now service unavailable' });
    }
  }

  // GET /api/v1/story-arcs
  router.get('/api/v1/story-arcs', async (req, res) => {
    try {
      const baseUrl = getTaggerBaseUrl(deps);
      const url = new URL('/api/story-arcs', baseUrl);
      if (req.query.publisher) url.searchParams.set('publisher', req.query.publisher);
      if (req.query.search) url.searchParams.set('search', req.query.search);
      const upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      const data = await upstream.json();
      const storyArcs = Array.isArray(data) ? data : (data.storyArcs || []);
      return res.json({ ok: true, storyArcs });
    } catch (err) {
      console.warn('[StoryArcsProxy] Fallback story arcs lookup:', err.message);
      return res.json({ ok: true, storyArcs: [] });
    }
  });

  // GET /api/v1/comics/:comicId/continuity
  router.get('/api/v1/comics/:comicId/continuity', async (req, res) => {
    try {
      const comicId = req.params.comicId;
      const baseUrl = getTaggerBaseUrl(deps);
      const upstream = await fetch(`${baseUrl}/api/story-arcs/continuity/next/${comicId}`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await upstream.json();
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res.json({ ok: true, hasArc: false, earlierUnread: [] });
    }
  });

  // GET /api/v1/story-arcs/sync/status
  router.get('/api/v1/story-arcs/sync/status', (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/sync/status', 'GET');
  });

  // GET /api/v1/story-arcs/logs
  router.get('/api/v1/story-arcs/logs', (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/logs', 'GET');
  });

  // DELETE /api/v1/story-arcs/logs
  router.delete('/api/v1/story-arcs/logs', ...syncMiddlewares, (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/logs', 'DELETE');
  });

  // GET /api/v1/story-arcs/batch-tag/publishers
  router.get('/api/v1/story-arcs/batch-tag/publishers', (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/batch-tag/publishers', 'GET');
  });

  // POST /api/v1/story-arcs/sync
  router.post('/api/v1/story-arcs/sync', ...syncMiddlewares, async (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/sync', 'POST', req.body || {});
  });

  // POST /api/v1/story-arcs/sync/cancel
  router.post('/api/v1/story-arcs/sync/cancel', ...syncMiddlewares, (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/sync/cancel', 'POST');
  });

  // GET /api/v1/story-arcs/batch-tag/status
  router.get('/api/v1/story-arcs/batch-tag/status', (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/batch-tag/status', 'GET');
  });

  // POST /api/v1/story-arcs/batch-tag
  router.post('/api/v1/story-arcs/batch-tag', ...syncMiddlewares, async (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/batch-tag', 'POST', req.body || {});
  });

  // POST /api/v1/story-arcs/batch-tag/cancel
  router.post('/api/v1/story-arcs/batch-tag/cancel', ...syncMiddlewares, (req, res) => {
    return proxyJson(req, res, '/api/story-arcs/batch-tag/cancel', 'POST');
  });

  // GET /api/v1/story-arcs/stream (SSE Proxy)
  router.get('/api/v1/story-arcs/stream', ...syncMiddlewares, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': keepalive\n\n');

    const baseUrl = getTaggerBaseUrl(deps);
    const targetUrl = `${baseUrl}/api/story-arcs/stream`;
    try {
      const upstreamReq = http.get(targetUrl, (upstreamRes) => {
        upstreamRes.on('data', chunk => {
          try { res.write(chunk); } catch (_) {}
        });
        upstreamRes.on('end', () => {
          try { res.end(); } catch (_) {}
        });
      });
      upstreamReq.on('error', err => {
        console.warn('[StoryArcsProxy] SSE stream error:', err.message);
      });
      req.on('close', () => {
        upstreamReq.destroy();
      });
    } catch (e) {
      console.warn('[StoryArcsProxy] Failed to connect to SSE stream:', e.message);
    }
  });

  // GET /api/v1/story-arcs/batch-tag/stream (SSE Proxy)
  router.get('/api/v1/story-arcs/batch-tag/stream', ...syncMiddlewares, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': keepalive\n\n');

    const baseUrl = getTaggerBaseUrl(deps);
    const targetUrl = `${baseUrl}/api/story-arcs/batch-tag/stream`;
    try {
      const upstreamReq = http.get(targetUrl, (upstreamRes) => {
        upstreamRes.on('data', chunk => {
          try { res.write(chunk); } catch (_) {}
        });
        upstreamRes.on('end', () => {
          try { res.end(); } catch (_) {}
        });
      });
      upstreamReq.on('error', err => {
        console.warn('[StoryArcsProxy] Batch tag stream error:', err.message);
      });
      req.on('close', () => {
        upstreamReq.destroy();
      });
    } catch (e) {
      console.warn('[StoryArcsProxy] Failed to connect to batch tag SSE:', e.message);
    }
  });

  // GET /api/v1/story-arcs/:arcId
  router.get('/api/v1/story-arcs/:arcId', async (req, res) => {
    try {
      const arcId = req.params.arcId;
      const baseUrl = getTaggerBaseUrl(deps);
      const upstream = await fetch(`${baseUrl}/api/story-arcs/${arcId}`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await upstream.json();
      if (upstream.status === 404) {
        return res.status(404).json({ ok: false, error: 'Story arc not found' });
      }
      return res.json({ ok: true, storyArc: data });
    } catch (err) {
      console.warn('[StoryArcsProxy] Error fetching story arc detail:', err.message);
      return res.status(502).json({ ok: false, error: 'Tag Comics Now service unavailable' });
    }
  });
}

module.exports = attachUserStoryArcsRoutes;
