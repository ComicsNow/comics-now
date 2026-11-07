/**
 * Story Arcs Sync Route Integration Tests
 * Validates that POST /api/v1/story-arcs/sync and related endpoints exist,
 * proxy correctly to the Python service, and return valid JSON cleanly.
 */
const { createApiRouter } = require('../server/routes');

describe('Story Arcs Sync API Endpoints Integration', () => {
  let router;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn((url, opts = {}) => {
      const urlStr = String(url);
      const method = (opts.method || 'GET').toUpperCase();

      if (urlStr.includes('/api/story-arcs/sync/status')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, isSyncing: false, percent: 0, currentSlug: null })
        });
      }
      if (urlStr.includes('/api/story-arcs/sync/cancel')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, cancelled: true })
        });
      }
      if (urlStr.includes('/api/story-arcs/sync') && method === 'POST') {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, message: 'Sync started' })
        });
      }
      if (urlStr.includes('/api/story-arcs/batch-tag/publishers')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, publishers: ['DC Comics', 'Marvel Comics'] })
        });
      }
      if (urlStr.includes('/api/story-arcs/batch-tag/status')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, isRunning: false, current: 0, total: 0 })
        });
      }
      if (urlStr.includes('/api/story-arcs/batch-tag/cancel')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, cancelled: true })
        });
      }
      if (urlStr.includes('/api/story-arcs/batch-tag') && method === 'POST') {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, message: 'Batch enrichment started' })
        });
      }
      if (urlStr.includes('/api/story-arcs/logs')) {
        if (method === 'DELETE') {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve({ ok: true })
          });
        }
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, logs: [] })
        });
      }
      if (urlStr.includes('/api/story-arcs/continuity/next/')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ hasArc: false, earlierUnread: [] })
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true })
      });
    });

    const mockDeps = {
      log: jest.fn(),
      dbAll: () => [],
      dbGet: () => null,
      dbRun: () => ({ changes: 0 }),
      requireAuth: (req, res, next) => next(),
      requireAdmin: (req, res, next) => next(),
      isAuthEnabled: () => false,
      config: {
        readingOrdersIntervalDays: 7,
        readingOrdersMode: 'both'
      }
    };

    router = createApiRouter(mockDeps);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function executeRequest(method, url, body = {}) {
    return new Promise((resolve, reject) => {
      const req = {
        method,
        url,
        path: url.split('?')[0],
        query: {},
        body,
        headers: { 'content-type': 'application/json' }
      };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
        status: jest.fn((code) => { res.statusCode = code; return res; }),
        json: jest.fn((data) => {
          resolve({ status: res.statusCode, body: data });
        }),
        writeHead: jest.fn((code, headers) => {
          res.statusCode = code;
          res.headers = { ...headers };
        }),
        write: jest.fn(),
        end: jest.fn(() => resolve({ status: res.statusCode }))
      };

      router.handle(req, res, (err) => {
        if (err) return reject(err);
        reject(new Error(`Route ${method} ${url} not handled by API router`));
      });
    });
  }

  it('POST /api/v1/story-arcs/sync starts sync and returns JSON with ok: true (never unhandled)', async () => {
    const res = await executeRequest('POST', '/api/v1/story-arcs/sync', { mode: 'issues', force: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      message: 'Sync started'
    }));
  });

  it('GET /api/v1/story-arcs/sync/status returns JSON status (never unhandled)', async () => {
    const res = await executeRequest('GET', '/api/v1/story-arcs/sync/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('isSyncing');
  });

  it('POST /api/v1/story-arcs/sync/cancel returns JSON confirmation', async () => {
    const res = await executeRequest('POST', '/api/v1/story-arcs/sync/cancel');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('GET /api/v1/story-arcs/logs returns logs array and does not match :arcId route', async () => {
    const res = await executeRequest('GET', '/api/v1/story-arcs/logs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it('DELETE /api/v1/story-arcs/logs clears logs and returns JSON', async () => {
    const res = await executeRequest('DELETE', '/api/v1/story-arcs/logs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /api/v1/story-arcs/batch-tag/publishers returns publisher list', async () => {
    const res = await executeRequest('GET', '/api/v1/story-arcs/batch-tag/publishers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(Array.isArray(res.body.publishers)).toBe(true);
  });

  it('GET /api/v1/story-arcs/batch-tag/status returns batch tagger status', async () => {
    const res = await executeRequest('GET', '/api/v1/story-arcs/batch-tag/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('isRunning');
  });

  it('POST /api/v1/story-arcs/batch-tag triggers batch enrichment and returns JSON', async () => {
    const res = await executeRequest('POST', '/api/v1/story-arcs/batch-tag', { publisher: 'all' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      message: 'Batch enrichment started'
    }));
  });

  it('POST /api/v1/story-arcs/batch-tag/cancel returns cancellation JSON', async () => {
    const res = await executeRequest('POST', '/api/v1/story-arcs/batch-tag/cancel');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('GET /api/v1/comics/:comicId/continuity returns continuity check payload', async () => {
    const res = await executeRequest('GET', '/api/v1/comics/9999/continuity');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('hasArc');
    expect(Array.isArray(res.body.earlierUnread)).toBe(true);
  });
});
