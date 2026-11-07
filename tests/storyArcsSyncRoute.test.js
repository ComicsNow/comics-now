/**
 * Story Arcs Sync Route Integration Tests
 * Validates that POST /api/v1/story-arcs/sync and related endpoints exist,
 * return valid JSON (never HTML fallback), and handle sync triggers cleanly.
 */
const { createApiRouter } = require('../server/routes');
const { getReadingOrdersRunner } = require('../server/services/reading-orders-runner');

describe('Story Arcs Sync API Endpoints Integration', () => {
  let router;
  let runner;

  beforeEach(() => {
    runner = getReadingOrdersRunner();
    jest.spyOn(runner, 'startSync').mockImplementation(async () => ({ ok: true }));
    jest.spyOn(runner, 'cancelSync').mockImplementation(() => true);

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
    runner.cancelSync();
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
});
