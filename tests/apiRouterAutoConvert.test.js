const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comics-now-api-router-test-'));
process.env.COMICS_DATA_DIR = tmpDir;

jest.mock('../server/middleware/auth', () => ({
  requireAdmin: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
  requireAuth: (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  }
}));

jest.mock('../server/settings', () => ({
  saveSetting: jest.fn(async () => {})
}));

const { createConfiguredApiRouter } = require('../server/bootstrap/api-router');
const { saveSetting } = require('../server/settings');

describe('API Router Auto-Convert & Format Settings Round-Trip', () => {
  let server;
  let baseUrl;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use(createConfiguredApiRouter());
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      done();
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists autoConvertEnabled, autoConvertFormats, and delete*AfterConversion across POST -> GET /api/v1/settings', async () => {
    const saveRes = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interval: 10,
        apiKey: '',
        allowedFormats: ['cbz', 'cbr', 'pdf', 'epub'],
        autoConvertEnabled: true,
        autoConvertFormats: ['cbr', 'pdf', 'epub'],
        deleteCbrAfterConversion: true,
        deletePdfAfterConversion: true,
        deleteEpubAfterConversion: true,
        metadataStorage: 'sidecar'
      })
    });

    expect(saveRes.status).toBe(200);
    const saveBody = await saveRes.json();
    expect(saveBody.ok).toBe(true);

    expect(saveSetting).toHaveBeenCalledWith('auto_convert_enabled', true);
    expect(saveSetting).toHaveBeenCalledWith('auto_convert_formats', ['cbr', 'pdf', 'epub']);
    expect(saveSetting).toHaveBeenCalledWith('delete_cbr_after_conversion', true);
    expect(saveSetting).toHaveBeenCalledWith('delete_pdf_after_conversion', true);
    expect(saveSetting).toHaveBeenCalledWith('delete_epub_after_conversion', true);

    const getRes = await fetch(`${baseUrl}/api/v1/settings`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();

    expect(getBody.autoConvertEnabled).toBe(true);
    expect(getBody.autoConvertFormats).toEqual(['cbr', 'pdf', 'epub']);
    expect(getBody.deleteCbrAfterConversion).toBe(true);
    expect(getBody.deletePdfAfterConversion).toBe(true);
    expect(getBody.deleteEpubAfterConversion).toBe(true);
  });
});
