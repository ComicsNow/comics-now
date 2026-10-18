const { createApiRouter } = require('../../../server/routes');

describe('GET /api/v1/health', () => {
  let router;
  let mockDeps;

  beforeEach(() => {
    mockDeps = {
      log: jest.fn(),
      getComicsDirectories: jest.fn(() => ['/comics']),
      getPathFromLibraryId: jest.fn(),
      requireAuth: (req, res, next) => next(),
      requireAdmin: (req, res, next) => next(),
      isAuthEnabled: () => false,
      db: {}
    };

    router = createApiRouter(mockDeps);
  });

  test('responds with 200 and status ok without requiring auth', async () => {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        url: '/api/v1/health',
        path: '/api/v1/health',
        headers: {}
      };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader: jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; }),
        status: jest.fn((code) => { res.statusCode = code; return res; }),
        json: jest.fn((data) => {
          try {
            expect(res.statusCode).toBe(200);
            expect(data).toHaveProperty('status', 'ok');
            expect(typeof data.timestamp).toBe('number');
            expect(res.headers['cache-control']).toMatch(/no-store|no-cache/);
            resolve();
          } catch (err) {
            reject(err);
          }
        })
      };

      router.handle(req, res, (err) => {
        reject(err || new Error('Route not handled by router'));
      });
    });
  });
});
