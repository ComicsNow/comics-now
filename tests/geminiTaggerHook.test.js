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
});
