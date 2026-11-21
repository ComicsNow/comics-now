'use strict';

const http = require('http');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PUBLISHERS = [
  { publisher: 'DC Comics' },
  { publisher: 'Marvel' }
];

const VALID_PNG_BASE64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
).toString('base64');

const originalCwd = process.cwd();
const previousLogoDir = process.env.LOGO_DIR;
const previousPublisherLogoDir = process.env.PUBLISHER_LOGOS_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-publisher-logos-'));

process.chdir(tempDir);
process.env.LOGO_DIR = tempDir;
process.env.PUBLISHER_LOGOS_DIR = tempDir;

// These resolve to the same modules the route imports as ../../db and
// ../../services/logos/comicvine.
jest.mock('../../../server/db', () => ({
  dbAll: jest.fn()
}));

jest.mock('../../../server/services/logos/comicvine', () => ({
  fetchPublisherLogo: jest.fn(),
  previewPublisherLogo: jest.fn()
}));

const { dbAll } = require('../../../server/db');
const { fetchPublisherLogo, previewPublisherLogo } = require('../../../server/services/logos/comicvine');
const adminPublisherLogosRouter = require('../../../server/routes/admin/publisher-logos');

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/admin/publishers/logos', adminPublisherLogosRouter);

  await new Promise((resolve, reject) => {
    server = http.createServer(app);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api/admin/publishers/logos`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve) => server.close(resolve));
  }

  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });

  const { LOGOS_DIRECTORY } = require('../../../server/constants');
  fs.rmSync(path.join(LOGOS_DIRECTORY, '__MockTestPublisherA__'), { recursive: true, force: true });
  fs.rmSync(path.join(LOGOS_DIRECTORY, '__MockTestPublisherB__'), { recursive: true, force: true });
  fs.rmSync(path.join(LOGOS_DIRECTORY, '__MockIsolatedPublisher__'), { recursive: true, force: true });

  if (previousLogoDir === undefined) delete process.env.LOGO_DIR;
  else process.env.LOGO_DIR = previousLogoDir;

  if (previousPublisherLogoDir === undefined) delete process.env.PUBLISHER_LOGOS_DIR;
  else process.env.PUBLISHER_LOGOS_DIR = previousPublisherLogoDir;
});

beforeEach(() => {
  jest.resetAllMocks();
  dbAll.mockResolvedValue(PUBLISHERS);
});

async function postJson(url, body) {
  return globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('admin publisher logos routes', () => {
  test('GET /api/admin/publishers/logos returns publishers', async () => {
    const response = await globalThis.fetch(`${baseUrl}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    const publishers = body.publishers.map((item) =>
      typeof item === 'string' ? item : item.publisher
    );

    expect(publishers).toEqual(['DC Comics', 'Marvel']);
    expect(dbAll).toHaveBeenCalledTimes(1);
  });

  test('POST /api/admin/publishers/logos/upload returns 400 when publisher or data is missing', async () => {
    const missingBody = await postJson(`${baseUrl}/upload`, {});
    expect(missingBody.status).toBe(400);

    const missingData = await postJson(`${baseUrl}/upload`, { publisher: 'DC Comics' });
    expect(missingData.status).toBe(400);

    const missingPublisher = await postJson(`${baseUrl}/upload`, { data: VALID_PNG_BASE64 });
    expect(missingPublisher.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/upload returns 400 for invalid base64', async () => {
    const response = await postJson(`${baseUrl}/upload`, {
      publisher: 'DC Comics',
      data: 'not base64 !!!'
    });
    expect(response.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/upload returns 400 for non-image magic bytes', async () => {
    const response = await postJson(`${baseUrl}/upload`, {
      publisher: 'DC Comics',
      data: Buffer.from('plain text').toString('base64')
    });
    expect(response.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/upload returns 200 for valid PNG base64', async () => {
    const response = await postJson(`${baseUrl}/upload`, {
      publisher: '__MockIsolatedPublisher__',
      data: VALID_PNG_BASE64
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.logo).toBe('string');
    expect(typeof body.filename).toBe('string');
  });

  test('POST /api/admin/publishers/logos/fetch returns 400 when publisher is missing', async () => {
    const response = await postJson(`${baseUrl}/fetch`, {});
    expect(response.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/fetch returns 404 when publisher is not found', async () => {
    fetchPublisherLogo.mockResolvedValue(null);

    const response = await postJson(`${baseUrl}/fetch`, { publisher: 'Unknown Publisher' });
    expect(response.status).toBe(404);
  });

  test('POST /api/admin/publishers/logos/fetch returns 200 on success', async () => {
    fetchPublisherLogo.mockResolvedValue({
      stored: true,
      filename: 'mock.png'
    });

    const response = await postJson(`${baseUrl}/fetch`, { publisher: '__MockIsolatedPublisher__' });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.logo).toBe('string');
    expect(typeof body.filename).toBe('string');
  });

  test('DELETE /api/admin/publishers/logos/:publisher returns success', async () => {
    const response = await globalThis.fetch(`${baseUrl}/__MockIsolatedPublisher__`, { method: 'DELETE' });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test('POST /api/admin/publishers/logos/fetch-preview returns 400 when publisher missing', async () => {
    const response = await postJson(`${baseUrl}/fetch-preview`, {});
    expect(response.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/fetch-preview returns 404 when logo not found', async () => {
    previewPublisherLogo.mockResolvedValue({ success: false, reason: 'Publisher not found' });
    const response = await postJson(`${baseUrl}/fetch-preview`, { publisher: 'Unknown Publisher' });
    expect(response.status).toBe(404);
  });

  test('POST /api/admin/publishers/logos/fetch-preview returns 200 with preview data', async () => {
    previewPublisherLogo.mockResolvedValue({
      success: true,
      base64: VALID_PNG_BASE64,
      mimeType: 'image/png',
      extension: '.png',
      sourceUrl: 'https://comicvine.gamespot.com/a/uploads/scale_avatar/1/1/image.png'
    });
    const response = await postJson(`${baseUrl}/fetch-preview`, { publisher: '__MockIsolatedPublisher__' });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.previewUrl).toContain('data:image/png;base64,');
  });

  test('POST /api/admin/publishers/logos/save returns 400 when changes is invalid', async () => {
    const response = await postJson(`${baseUrl}/save`, {});
    expect(response.status).toBe(400);
  });

  test('POST /api/admin/publishers/logos/save commits batch changes', async () => {
    const response = await postJson(`${baseUrl}/save`, {
      changes: [
        { publisher: '__MockTestPublisherA__', type: 'upload', data: VALID_PNG_BASE64, filename: 'logo.png' },
        { publisher: '__MockTestPublisherB__', type: 'delete' }
      ]
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
  });
});
