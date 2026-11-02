const { installTaggerHook } = require('../server/services/gemini-tagger');

describe('Tagger Hook', () => {
  let originalFetch;
  let mockDb;
  let ctx;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockDb = {
      dbGet: jest.fn().mockResolvedValue({ value: '0' }),
      dbRun: jest.fn().mockResolvedValue({ changes: 1 })
    };
    ctx = {
      db: mockDb,
      paths: {
        CONFIG_FILE: '/tmp/test-config.json',
        THUMBNAILS_DIRECTORY: '/tmp/thumbnails'
      },
      log: jest.fn()
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('passes through requests unrelated to tagger sidecar', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = jest.fn().mockResolvedValue(mockResponse);

    installTaggerHook(ctx);

    const res = await globalThis.fetch('http://example.com/api/other', { method: 'GET' });
    expect(res).toBe(mockResponse);
  });

  test('passes through tagger requests when terms have not been accepted', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      geminiApiKey: 'test-key',
      geminiCoverMatchEnabled: true,
      geminiTermsAccepted: false
    }));

    const mockResponse = new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    const originalFetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = originalFetchMock;

    installTaggerHook(ctx);

    const res = await globalThis.fetch('http://127.0.0.1:5000/api/tag-file-stream', {
      method: 'POST',
      body: JSON.stringify({ path: '/tmp/test.cbz' })
    });

    expect(res).toBe(mockResponse);
    expect(originalFetchMock).toHaveBeenCalledWith('http://127.0.0.1:5000/api/tag-file-stream', {
      method: 'POST',
      body: JSON.stringify({ path: '/tmp/test.cbz' })
    });

    fs.existsSync.mockRestore();
    fs.readFileSync.mockRestore();
  });

  test('passes through tagger requests unaltered when geminiCoverMatchEnabled is false in SQLite settings even if config.json has true', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      geminiApiKey: 'test-key',
      geminiCoverMatchEnabled: true,
      geminiTermsAccepted: true
    }));

    mockDb.dbGet.mockImplementation(async (sql) => {
      if (sql.includes("key = 'geminiCoverMatchEnabled'")) {
        return { value: 'false' };
      }
      if (sql.includes("key = 'geminiTermsAccepted'")) {
        return { value: 'true' };
      }
      return { value: '0' };
    });

    const mockResponse = new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    const originalFetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = originalFetchMock;

    installTaggerHook(ctx);

    const reqInit = {
      method: 'POST',
      body: JSON.stringify({ path: '/tmp/test.cbz', upper_threshold: 0.90, lower_threshold: 0.80 })
    };
    const res = await globalThis.fetch('http://127.0.0.1:5000/api/tag-file-stream', reqInit);

    expect(res).toBe(mockResponse);
    // Must NOT rewrite upper_threshold to 1.01 when Gemini is disabled
    expect(originalFetchMock).toHaveBeenCalledWith('http://127.0.0.1:5000/api/tag-file-stream', reqInit);

    fs.existsSync.mockRestore();
    fs.readFileSync.mockRestore();
  });

  test('passes through tagger requests unaltered when ctx.config.geminiCoverMatchEnabled is false', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      geminiApiKey: 'test-key',
      geminiCoverMatchEnabled: true,
      geminiTermsAccepted: true
    }));

    ctx.config = {
      geminiApiKey: 'test-key',
      geminiCoverMatchEnabled: false,
      geminiTermsAccepted: true
    };
    mockDb.dbGet.mockResolvedValue(null);

    const mockResponse = new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    const originalFetchMock = jest.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = originalFetchMock;

    installTaggerHook(ctx);

    const reqInit = {
      method: 'POST',
      body: JSON.stringify({ path: '/tmp/test.cbz', upper_threshold: 0.90, lower_threshold: 0.80 })
    };
    const res = await globalThis.fetch('http://127.0.0.1:5000/api/tag-file', reqInit);

    expect(res).toBe(mockResponse);
    expect(originalFetchMock).toHaveBeenCalledWith('http://127.0.0.1:5000/api/tag-file', reqInit);

    fs.existsSync.mockRestore();
    fs.readFileSync.mockRestore();
  });
});
