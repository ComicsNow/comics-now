const express = require('express');
const http = require('http');

jest.mock('../../../server/config', () => ({
  getConfig: jest.fn(() => ({
    comicVineApiKey: 'mock-cv-key-001'
  })),
  getMetronPassword: jest.fn(() => '')
}));

const { attachCoverProxyRoutes } = require('../../../server/routes/user/metadata/cover-proxy');

function startTestServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

describe('[H-2] Cover Proxy SSRF Protection', () => {
  const origFetch = global.fetch;

  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  test('rejects disallowed lookalike hosts and private/metadata URLs with 403', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const app = express();
    const router = express.Router();
    attachCoverProxyRoutes(router, {
      getComicVineApiKey: () => 'mock-cv-key-001',
      cvFetchJson: jest.fn(),
      COMICVINE_API_URL: 'https://comicvine.gamespot.com/api'
    });
    app.use(router);

    const server = await startTestServer(app);
    try {
      const r1 = await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('https://evil-comicvine.gamespot.com/a.jpg')}`);
      expect(r1.status).toBe(403);

      const r2 = await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`);
      expect(r2.status).toBe(403);

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  test('passes redirect: error for direct allowed cover fetches and GCD fetches', async () => {
    const imgBytes = Buffer.alloc(200, 0x41);
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => imgBytes.buffer.slice(imgBytes.byteOffset, imgBytes.byteOffset + imgBytes.byteLength)
    });
    global.fetch = fetchSpy;

    const app = express();
    const router = express.Router();
    attachCoverProxyRoutes(router, {
      getComicVineApiKey: () => '',
      cvFetchJson: jest.fn(),
      COMICVINE_API_URL: 'https://comicvine.gamespot.com/api'
    });
    app.use(router);

    const server = await startTestServer(app);
    try {
      const resCv = await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('https://comicvine.gamespot.com/a.jpg')}`);
      expect(resCv.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://comicvine.gamespot.com/a.jpg',
        expect.objectContaining({ redirect: 'error' })
      );

      fetchSpy.mockClear();
      const resGcd = await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('https://files1.comics.org/cover.jpg')}`);
      expect(resGcd.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://files1.comics.org/cover.jpg',
        expect.objectContaining({ redirect: 'error' })
      );
    } finally {
      await server.close();
    }
  });

  test('fallback fetchCoverBuffer blocks unsafe internal URLs and enforces redirect: error', async () => {
    const requestedUrls = [];
    const fetchSpy = jest.fn().mockImplementation(async (url, opts) => {
      requestedUrls.push({ url, opts });
      if (url.startsWith('https://www.comics.org/')) {
        return { ok: false, status: 404, headers: { get: () => 'text/html' } };
      }
      if (url.startsWith('https://comicvine.gamespot.com/')) {
        const imgBytes = Buffer.alloc(200, 0x42);
        return {
          ok: true,
          headers: { get: () => 'image/jpeg' },
          arrayBuffer: async () => imgBytes.buffer.slice(imgBytes.byteOffset, imgBytes.byteOffset + imgBytes.byteLength)
        };
      }
      return {
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => Buffer.alloc(200, 0x43).buffer
      };
    });
    global.fetch = fetchSpy;

    const cvFetchJson = jest.fn()
      .mockResolvedValueOnce({
        results: [
          {
            id: 10,
            name: 'Test Comic',
            volume: { name: 'Test Comic' },
            issue_number: '1',
            image: { medium_url: 'http://127.0.0.1:5000/secret.jpg' }
          }
        ]
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 20,
            name: 'Test Comic',
            image: { medium_url: 'http://169.254.169.254/latest.jpg' }
          }
        ]
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 30,
            name: 'Test Comic',
            volume: { name: 'Test Comic' },
            issue_number: '1',
            image: { medium_url: 'https://comicvine.gamespot.com/safe.jpg' }
          }
        ]
      });

    const app = express();
    const router = express.Router();
    attachCoverProxyRoutes(router, {
      getComicVineApiKey: () => 'mock-cv-key-001',
      cvFetchJson,
      COMICVINE_API_URL: 'https://comicvine.gamespot.com/api'
    });
    app.use(router);

    const server = await startTestServer(app);
    try {
      await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('https://www.comics.org/cover.jpg')}&series=Test+Comic&issue=1`);
      const fetchedTargetUrls = requestedUrls.map((x) => x.url);
      expect(fetchedTargetUrls).not.toContain('http://127.0.0.1:5000/secret.jpg');
      expect(fetchedTargetUrls).not.toContain('http://169.254.169.254/latest.jpg');

      requestedUrls.length = 0;
      await origFetch(`${server.baseUrl}/api/v1/proxy/cover?url=${encodeURIComponent('https://www.comics.org/cover2.jpg')}&series=Test+Comic&issue=1`);
      const safeCall = requestedUrls.find((x) => x.url === 'https://comicvine.gamespot.com/safe.jpg');
      expect(safeCall).toBeDefined();
      expect(safeCall.opts).toEqual(expect.objectContaining({ redirect: 'error' }));
    } finally {
      await server.close();
    }
  });
});
