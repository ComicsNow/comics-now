const express = require('express');
const request = require('supertest');
const attachProgressRoutes = require('../server/routes/user/progress');
const {
  validateLastReadPage,
  validateStatus,
  validateComicId,
  validateDeviceId
} = require('../server/validation');

describe('User Progress Routes', () => {
  let app;
  let mockDeps;

  beforeEach(() => {
    mockDeps = {
      dbGet: jest.fn(),
      dbRun: jest.fn(),
      dbAll: jest.fn(),
      log: jest.fn(),
      formatErrorMessage: jest.fn((e, req, msg) => msg),
      resolvePath: jest.fn(p => p),
      validateLastReadPage,
      validateStatus,
      validateComicId,
      validateDeviceId
    };

    const router = express.Router();

    // Add user mock middleware
    router.use((req, res, next) => {
      req.user = { userId: 'test-user-1' };
      next();
    });

    attachProgressRoutes(router, mockDeps);

    app = express();
    app.use(express.json());
    app.use(router);
  });

  describe('GET /api/v1/sync/check/:comicId', () => {
    const validComicId = '1234567890abcdef1234567890abcdef12345678';

    it('returns 400 for invalid comicId', async () => {
      const res = await request(app).get('/api/v1/sync/check/invalid-id?deviceId=device-1');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid comic ID format');
    });

    it('returns 400 for missing deviceId', async () => {
      const res = await request(app).get(`/api/v1/sync/check/${validComicId}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Missing parameters');
    });

    it('returns 400 for invalid deviceId', async () => {
      const res = await request(app).get(`/api/v1/sync/check/${validComicId}?deviceId=bad id!`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Device ID contains invalid characters');
    });

    it('returns 403 if device is owned by another user', async () => {
      mockDeps.dbGet.mockImplementation(async (query) => {
        if (query.includes('FROM devices')) return { userId: 'other-user' };
      });
      const res = await request(app).get(`/api/v1/sync/check/${validComicId}?deviceId=device-1`);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Unauthorized device');
    });

    it('returns sync data correctly when no other devices have newer sync', async () => {
      mockDeps.dbGet.mockImplementation(async (query, params) => {
        if (query.includes('FROM devices')) return { userId: 'test-user-1' };
        if (query.includes('FROM comics')) return { totalPages: 22 };
        if (query.includes('AND deviceId = ?')) return { lastReadPage: 5, lastSyncTimestamp: 1000 };
        if (query.includes('AND dp.deviceId != ?')) return undefined; // No other device progress
        return undefined;
      });

      const res = await request(app).get(`/api/v1/sync/check/${validComicId}?deviceId=device-1`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        lastSyncTimestamp: 0,
        hasNewerSync: false,
        isFromDifferentDevice: false,
        totalPages: 22,
        currentDeviceProgress: {
          lastReadPage: 5,
          lastSyncTimestamp: 1000
        }
      });

      // Should update lastSeen
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE devices SET lastSeen'),
        expect.arrayContaining([expect.any(Number), 'device-1'])
      );
    });

    it('returns sync data correctly when another device has newer sync', async () => {
      mockDeps.dbGet.mockImplementation(async (query, params) => {
        if (query.includes('FROM devices')) return { userId: 'test-user-1' };
        if (query.includes('FROM comics')) return { totalPages: 22 };
        if (query.includes('AND deviceId = ?')) return { lastReadPage: 5, lastSyncTimestamp: 1000 };
        if (query.includes('AND dp.deviceId != ?')) return {
          lastReadPage: 10,
          lastSyncTimestamp: 2000,
          deviceId: 'device-2',
          deviceName: 'Other Device'
        };
        return undefined;
      });

      const res = await request(app).get(`/api/v1/sync/check/${validComicId}?deviceId=device-1`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        lastSyncTimestamp: 2000,
        lastSyncDeviceId: 'device-2',
        lastSyncDeviceName: 'Other Device',
        lastReadPage: 10,
        totalPages: 22,
        hasNewerSync: true,
        isFromDifferentDevice: true,
        currentDeviceProgress: {
          lastReadPage: 5,
          lastSyncTimestamp: 1000
        }
      });
    });

    it('handles DB errors gracefully', async () => {
      mockDeps.dbGet.mockRejectedValue(new Error('DB Error'));
      const res = await request(app).get(`/api/v1/sync/check/${validComicId}?deviceId=device-1`);
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Sync check failed');
      expect(mockDeps.log).toHaveBeenCalledWith('ERROR', 'SYNC', expect.stringContaining('DB Error'));
    });
  });

  describe('POST /api/v1/sync/update', () => {
    const validComicId = '1234567890abcdef1234567890abcdef12345678';

    it('returns 400 for missing comicId', async () => {
      const res = await request(app).post('/api/v1/sync/update').send({ deviceId: 'dev1', lastReadPage: 1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing deviceId', async () => {
      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, lastReadPage: 1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid deviceId', async () => {
      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev 1!', lastReadPage: 1 });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Device ID contains invalid characters');
    });

    it('returns 403 if device is owned by another user', async () => {
      mockDeps.dbGet.mockResolvedValueOnce({ userId: 'another-user' });
      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev1' });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Unauthorized device');
    });

    it('inserts new device if not exists', async () => {
      mockDeps.dbGet.mockImplementation(async (query) => {
        if (query.includes('FROM devices')) return undefined;
        if (query.includes('FROM comics')) return { totalPages: 10 };
      });

      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev1', lastReadPage: 5 });
      expect(res.status).toBe(200);
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR IGNORE INTO devices'),
        expect.arrayContaining(['dev1', 'Browser Device', 'test-user-1'])
      );
    });

    it('returns 400 for invalid lastReadPage', async () => {
      mockDeps.dbGet.mockImplementation(async (query) => {
        if (query.includes('FROM devices')) return { userId: 'test-user-1' };
        if (query.includes('FROM comics')) return { totalPages: 10 };
      });

      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev1', lastReadPage: 15 });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('lastReadPage (15) exceeds totalPages (10)');
    });

    it('updates device_progress and user_comic_status correctly', async () => {
      mockDeps.dbGet.mockImplementation(async (query) => {
        if (query.includes('FROM devices')) return { userId: 'test-user-1' };
        if (query.includes('FROM comics')) return { totalPages: 10 };
      });

      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev1', lastReadPage: 5 });
      expect(res.status).toBe(200);

      // Check device_progress insert
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO device_progress'),
        expect.arrayContaining([validComicId, 'dev1', 5, 10, expect.any(Number)])
      );

      // Check user_comic_status insert
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', validComicId, 5, 10, expect.any(Number)])
      );

      // Check device lastSeen update
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE devices SET lastSeen'),
        expect.arrayContaining([expect.any(Number), 'dev1'])
      );
    });

    it('handles DB errors gracefully', async () => {
      mockDeps.dbGet.mockRejectedValue(new Error('Update failed'));
      const res = await request(app).post('/api/v1/sync/update').send({ comicId: validComicId, deviceId: 'dev1' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Sync update failed');
      expect(mockDeps.log).toHaveBeenCalledWith('ERROR', 'SYNC', expect.stringContaining('Update failed'));
    });
  });

  describe('POST /api/v1/comics/status', () => {
    const validComicId = '1234567890abcdef1234567890abcdef12345678';

    it('returns 400 for missing comicId or status', async () => {
      const res1 = await request(app).post('/api/v1/comics/status').send({ status: 'read' });
      expect(res1.status).toBe(400);

      const res2 = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId });
      expect(res2.status).toBe(400);
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId, status: 'invalid-status' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Status must be either "read" or "unread"');
    });

    it('returns 404 for missing comic', async () => {
      mockDeps.dbGet.mockResolvedValue(undefined);
      const res = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId, status: 'read' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Comic not found');
    });

    it('marks a comic as read (setting page to totalPages - 1)', async () => {
      mockDeps.dbGet.mockResolvedValue({ totalPages: 10 });
      const res = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId, status: 'read' });
      expect(res.status).toBe(200);
      expect(res.body.progress).toEqual({ lastReadPage: 9, totalPages: 10 });
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', validComicId, 9, 10, expect.any(Number)])
      );
    });

    it('marks a comic as unread (setting page to 0)', async () => {
      mockDeps.dbGet.mockResolvedValue({ totalPages: 10 });
      const res = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId, status: 'unread' });
      expect(res.status).toBe(200);
      expect(res.body.progress).toEqual({ lastReadPage: 0, totalPages: 10 });
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', validComicId, 0, 10, expect.any(Number)])
      );
    });

    it('handles DB errors gracefully', async () => {
      mockDeps.dbGet.mockRejectedValue(new Error('DB Error'));
      const res = await request(app).post('/api/v1/comics/status').send({ comicId: validComicId, status: 'read' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Failed to update comic status');
      expect(mockDeps.log).toHaveBeenCalledWith('ERROR', 'STATUS', expect.stringContaining('DB Error'));
    });
  });

  describe('POST /api/v1/series/status', () => {
    it('returns 400 for missing publisher, series, or status', async () => {
      const res1 = await request(app).post('/api/v1/series/status').send({ publisher: 'Pub', series: 'Ser' });
      expect(res1.status).toBe(400);

      const res2 = await request(app).post('/api/v1/series/status').send({ publisher: 'Pub', status: 'read' });
      expect(res2.status).toBe(400);

      const res3 = await request(app).post('/api/v1/series/status').send({ series: 'Ser', status: 'read' });
      expect(res3.status).toBe(400);
    });

    it('returns 400 for invalid status', async () => {
      const res = await request(app).post('/api/v1/series/status').send({ publisher: 'Pub', series: 'Ser', status: 'invalid-status' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Status must be either "read" or "unread"');
    });

    it('updates statuses in a transaction without rootFolder', async () => {
      mockDeps.dbAll.mockResolvedValue([
        { id: 'comic-1', totalPages: 10 },
        { id: 'comic-2', totalPages: 20 }
      ]);

      const res = await request(app).post('/api/v1/series/status').send({ publisher: 'Pub', series: 'Ser', status: 'read' });
      expect(res.status).toBe(200);

      expect(mockDeps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('WHERE series = ? AND publisher = ?'),
        ['Ser', 'Pub']
      );

      expect(mockDeps.dbRun).toHaveBeenCalledWith('BEGIN TRANSACTION');
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', 'comic-1', 9, 10, expect.any(Number)])
      );
      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', 'comic-2', 19, 20, expect.any(Number)])
      );
      expect(mockDeps.dbRun).toHaveBeenCalledWith('COMMIT');
    });

    it('updates statuses in a transaction with rootFolder', async () => {
      mockDeps.dbAll.mockResolvedValue([
        { id: 'comic-1', totalPages: 10 }
      ]);
      mockDeps.resolvePath.mockReturnValue('/my/library');

      const res = await request(app).post('/api/v1/series/status').send({ rootFolder: '/my/library', publisher: 'Pub', series: 'Ser', status: 'unread' });
      expect(res.status).toBe(200);

      expect(mockDeps.dbAll).toHaveBeenCalledWith(
        expect.stringContaining('AND path LIKE ?'),
        ['Ser', 'Pub', '/my/library/%']
      );

      expect(mockDeps.dbRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_comic_status'),
        expect.arrayContaining(['test-user-1', 'comic-1', 0, 10, expect.any(Number)])
      );
    });

    it('handles transaction rollbacks on error', async () => {
      mockDeps.dbAll.mockResolvedValue([
        { id: 'comic-1', totalPages: 10 }
      ]);

      // Force an error during the transaction loop
      mockDeps.dbRun.mockImplementation(async (query) => {
        if (query.includes('INSERT INTO user_comic_status')) {
          throw new Error('Insert failed');
        }
      });

      const res = await request(app).post('/api/v1/series/status').send({ publisher: 'Pub', series: 'Ser', status: 'read' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('Failed to update series status');

      expect(mockDeps.dbRun).toHaveBeenCalledWith('ROLLBACK');
      expect(mockDeps.log).toHaveBeenCalledWith('ERROR', 'STATUS', expect.stringContaining('Insert failed'));
    });
  });
});
