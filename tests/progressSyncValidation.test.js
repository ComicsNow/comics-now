const { createApiRouter } = require('../server/routes');

describe('Progress sync endpoint deviceId validation', () => {
  let router;
  let mockDeps;
  const validComicId = '1234567890abcdef1234567890abcdef12345678';

  beforeEach(() => {
    mockDeps = {
      log: jest.fn(),
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      formatErrorMessage: jest.fn((e, req, fallback) => fallback),
      getComicsDirectories: jest.fn(() => ['/comics']),
      getPathFromLibraryId: jest.fn(),
      resolveLibraryPath: jest.fn((p) => p),
      requireAuth: (req, res, next) => next(),
      requireAdmin: (req, res, next) => next(),
      isAuthEnabled: () => false
    };

    router = createApiRouter(mockDeps);
  });

  test('GET /api/v1/sync/check/:comicId rejects invalid deviceId with 400', async () => {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        url: `/api/v1/sync/check/${validComicId}?deviceId=<script>alert(1)</script>`,
        path: `/api/v1/sync/check/${validComicId}`,
        params: { comicId: validComicId },
        query: { deviceId: '<script>alert(1)</script>' },
        headers: {},
        user: { userId: 'user-1', role: 'user' }
      };

      const res = {
        statusCode: 200,
        status: jest.fn((code) => { res.statusCode = code; return res; }),
        json: jest.fn((data) => {
          try {
            expect(res.statusCode).toBe(400);
            expect(data.ok).toBe(false);
            expect(data.message).toBe('Device ID contains invalid characters');
            resolve();
          } catch (err) {
            reject(err);
          }
        })
      };

      router.handle(req, res, (err) => {
        reject(err || new Error('Route not handled'));
      });
    });
  });

  test('POST /api/v1/sync/update rejects invalid deviceId with 400', async () => {
    return new Promise((resolve, reject) => {
      const req = {
        method: 'POST',
        url: '/api/v1/sync/update',
        path: '/api/v1/sync/update',
        body: {
          comicId: validComicId,
          deviceId: 'device; DROP TABLE devices;--',
          lastReadPage: 1
        },
        headers: {},
        user: { userId: 'user-1', role: 'user' }
      };

      const res = {
        statusCode: 200,
        status: jest.fn((code) => { res.statusCode = code; return res; }),
        json: jest.fn((data) => {
          try {
            expect(res.statusCode).toBe(400);
            expect(data.ok).toBe(false);
            expect(data.message).toBe('Device ID contains invalid characters');
            resolve();
          } catch (err) {
            reject(err);
          }
        })
      };

      router.handle(req, res, (err) => {
        reject(err || new Error('Route not handled'));
      });
    });
  });

  test('GET /api/v1/sync/check/:comicId accepts valid deviceId', async () => {
    mockDeps.dbGet.mockImplementation(async (query) => {
      if (query.includes('FROM devices')) return { userId: 'user-1' };
      if (query.includes('FROM comics')) return { totalPages: 10 };
      if (query.includes('FROM device_progress')) return { lastReadPage: 2, lastSyncTimestamp: 100 };
      return undefined;
    });

    return new Promise((resolve, reject) => {
      const req = {
        method: 'GET',
        url: `/api/v1/sync/check/${validComicId}?deviceId=valid-device-123`,
        path: `/api/v1/sync/check/${validComicId}`,
        params: { comicId: validComicId },
        query: { deviceId: 'valid-device-123' },
        headers: {},
        user: { userId: 'user-1', role: 'user' }
      };

      const res = {
        statusCode: 200,
        status: jest.fn((code) => { res.statusCode = code; return res; }),
        json: jest.fn((data) => {
          try {
            expect(res.statusCode).toBe(200);
            expect(data.ok).toBe(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        })
      };

      router.handle(req, res, (err) => {
        reject(err || new Error('Route not handled'));
      });
    });
  });
});
