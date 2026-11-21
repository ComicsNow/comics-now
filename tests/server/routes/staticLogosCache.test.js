'use strict';

const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Static logos HTTP cache headers and revalidation', () => {
  let app;
  let server;
  let baseUrl;
  let tempLogosDir;

  beforeAll(async () => {
    tempLogosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-logos-test-'));
    fs.mkdirSync(path.join(tempLogosDir, 'dc-comics'), { recursive: true });
    fs.writeFileSync(path.join(tempLogosDir, 'dc-comics', 'logo.png'), Buffer.from([1, 2, 3, 4]));

    app = express();
    app.use(
      '/logos',
      express.static(tempLogosDir, {
        maxAge: 0,
        etag: true,
        lastModified: true,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        },
      })
    );

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(tempLogosDir, { recursive: true, force: true });
  });

  it('serves logos with no-cache, must-revalidate and ETag', async () => {
    const res = await httpGet(`${baseUrl}/logos/dc-comics/logo.png`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-cache, must-revalidate');
    expect(res.headers['etag']).toBeTruthy();
  });

  it('returns 304 Not Modified when matching If-None-Match header is sent', async () => {
    const initial = await httpGet(`${baseUrl}/logos/dc-comics/logo.png`);
    const etag = initial.headers['etag'];

    const cachedRes = await httpGet(`${baseUrl}/logos/dc-comics/logo.png`, {
      'if-none-match': etag,
    });

    expect(cachedRes.statusCode).toBe(304);
  });

  it('returns 200 with new logo content when file on disk is modified', async () => {
    const initial = await httpGet(`${baseUrl}/logos/dc-comics/logo.png`);
    const oldEtag = initial.headers['etag'];

    // Mutate file on disk
    fs.writeFileSync(path.join(tempLogosDir, 'dc-comics', 'logo.png'), Buffer.from([5, 6, 7, 8, 9]));

    const modifiedRes = await httpGet(`${baseUrl}/logos/dc-comics/logo.png`, {
      'if-none-match': oldEtag,
    });

    expect(modifiedRes.statusCode).toBe(200);
    expect(modifiedRes.headers['etag']).not.toBe(oldEtag);
  });
});
