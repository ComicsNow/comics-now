/**
 * @jest-environment jsdom
 */
const { downloadWithResume, runWithRetry } = require('../public/js/offline/download-core.js');

function u8(str) { return new Uint8Array(Buffer.from(str, 'utf-8')); }

// Minimal Response-like mock with a streaming body reader.
function mockRes({ status = 200, headers = {}, chunks = [] }) {
  let i = 0;
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined })
      })
    },
    blob: async () => new Blob(chunks)
  };
}

describe('downloadWithResume', () => {
  test('fresh download (200): returns full blob and reports progress', async () => {
    const chunks = [u8('AAAA'), u8('BBBB'), u8('CC')]; // 10 bytes
    const fetchImpl = jest.fn(async () => mockRes({ status: 200, headers: { 'Content-Length': '10' }, chunks }));
    const progress = [];

    const result = await downloadWithResume({
      url: '/dl', fetchImpl, onProgress: (r, t) => progress.push([r, t])
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // No Range header on a fresh download
    const opts = fetchImpl.mock.calls[0][1];
    expect(opts.headers.Range).toBeUndefined();
    expect(result.receivedBytes).toBe(10);
    expect(result.totalBytes).toBe(10);
    expect(result.blob.size).toBe(10);
    expect(progress[progress.length - 1]).toEqual([10, 10]);
  });

  test('resume (206): sends Range and appends to existing chunks', async () => {
    const priorChunks = [u8('AAAA')]; // 4 already downloaded
    const remaining = [u8('BBBB'), u8('CC')]; // 6 more
    const fetchImpl = jest.fn(async () => mockRes({
      status: 206,
      headers: { 'Content-Range': 'bytes 4-9/10' },
      chunks: remaining
    }));

    const result = await downloadWithResume({
      url: '/dl', fetchImpl, existingChunks: priorChunks, receivedBytes: 4
    });

    expect(fetchImpl.mock.calls[0][1].headers.Range).toBe('bytes=4-');
    expect(result.receivedBytes).toBe(10);
    expect(result.totalBytes).toBe(10);
    expect(result.blob.size).toBe(10);
  });

  test('server ignores Range (200 despite offset): restarts cleanly from scratch', async () => {
    const full = [u8('AAAA'), u8('BBBB'), u8('CC')];
    const fetchImpl = jest.fn(async () => mockRes({ status: 200, headers: { 'Content-Length': '10' }, chunks: full }));

    const result = await downloadWithResume({
      url: '/dl', fetchImpl, existingChunks: [u8('XXXX')], receivedBytes: 4
    });

    // Requested a range but got 200 → prior partial discarded, full body used.
    expect(result.receivedBytes).toBe(10);
    expect(result.blob.size).toBe(10);
  });

  test('416 range-not-satisfiable: treats existing partial as complete', async () => {
    const fetchImpl = jest.fn(async () => mockRes({ status: 416, headers: { 'Content-Range': 'bytes */10' } }));
    const result = await downloadWithResume({
      url: '/dl', fetchImpl, existingChunks: [u8('AAAABBBBCC')], receivedBytes: 10
    });
    expect(result.receivedBytes).toBe(10);
    expect(result.blob.size).toBe(10);
  });

  test('throws on unexpected error status', async () => {
    const fetchImpl = jest.fn(async () => mockRes({ status: 500 }));
    await expect(downloadWithResume({ url: '/dl', fetchImpl })).rejects.toThrow();
  });
});

describe('runWithRetry', () => {
  test('retries transient failures then succeeds', async () => {
    let attempts = 0;
    const sleep = jest.fn(async () => {});
    const fn = jest.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error('network');
      return 'ok';
    });
    const result = await runWithRetry(fn, { maxRetries: 3, sleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('does not retry AbortError', async () => {
    const err = new Error('aborted'); err.name = 'AbortError';
    const fn = jest.fn(async () => { throw err; });
    const sleep = jest.fn(async () => {});
    await expect(runWithRetry(fn, { maxRetries: 3, sleep })).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('gives up after maxRetries and rethrows', async () => {
    const fn = jest.fn(async () => { throw new Error('persistent'); });
    const sleep = jest.fn(async () => {});
    await expect(runWithRetry(fn, { maxRetries: 2, sleep })).rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
