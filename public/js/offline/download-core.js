/**
 * Resumable download core (dependency-free, unit-testable).
 *
 * downloadWithResume streams a file with HTTP Range support so an interrupted or
 * paused download can continue from where it stopped instead of restarting.
 * runWithRetry wraps any async op with backoff, never retrying user aborts.
 */

function parseTotalFromContentRange(value) {
  // "bytes 4-9/10" or "bytes */10"
  if (!value) return 0;
  const m = /\/(\d+)\s*$/.exec(value);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {function} o.fetchImpl              fetch implementation (injectable for tests)
 * @param {AbortSignal} [o.signal]
 * @param {string} [o.credentials='include']
 * @param {Array<Uint8Array>} [o.existingChunks]  previously downloaded chunks (for resume)
 * @param {number} [o.receivedBytes=0]        bytes already downloaded
 * @param {function} [o.onProgress]           (receivedBytes, totalBytes) => void
 * @returns {Promise<{blob: Blob, receivedBytes: number, totalBytes: number}>}
 */
async function downloadWithResume({
  url,
  fetchImpl,
  signal,
  credentials = 'include',
  existingChunks = [],
  receivedBytes = 0,
  onProgress
} = {}) {
  const headers = {};
  const wantResume = receivedBytes > 0;
  if (wantResume) headers.Range = `bytes=${Math.floor(receivedBytes)}-`;

  const res = await fetchImpl(url, { method: 'GET', credentials, headers, signal });

  // Range already satisfied / beyond size → the partial we hold is the whole file.
  if (res.status === 416) {
    const total = parseTotalFromContentRange(res.headers.get('Content-Range')) || receivedBytes;
    return { blob: new Blob(existingChunks), receivedBytes, totalBytes: total };
  }

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }

  // We accumulate into the caller-provided array so a paused/aborted download
  // still has its partial bytes available for a later resume.
  const chunks = existingChunks;
  let received;
  let total;

  if (res.status === 206) {
    // Server honoured the range: keep prior chunks and append.
    received = receivedBytes;
    total = parseTotalFromContentRange(res.headers.get('Content-Range'))
      || (receivedBytes + (Number(res.headers.get('Content-Length')) || 0));
  } else {
    // 200: server ignored the range (or fresh download) → discard partial, start clean.
    chunks.length = 0;
    received = 0;
    total = Number(res.headers.get('Content-Length')) || 0;
  }

  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const blob = await res.blob();
    received = blob.size;
    if (typeof onProgress === 'function') onProgress(received, total || received);
    return { blob, receivedBytes: received, totalBytes: total || received };
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (typeof onProgress === 'function') onProgress(received, total);
  }

  return { blob: new Blob(chunks), receivedBytes: received, totalBytes: total || received };
}

/**
 * Retry an async operation with caller-supplied backoff. Aborts are never retried.
 * @param {function} fn  async () => result
 * @param {object} o
 * @param {number} [o.maxRetries=3]
 * @param {function} [o.sleep]            (ms) => Promise, injectable for tests
 * @param {function} [o.backoff]          (attemptIndex) => ms
 * @param {function} [o.shouldRetry]      (err) => boolean
 */
async function runWithRetry(fn, {
  maxRetries = 3,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  backoff = (n) => Math.min(1000 * Math.pow(2, n), 30000),
  shouldRetry
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isAbort = err && (err.name === 'AbortError');
      const retryable = typeof shouldRetry === 'function' ? shouldRetry(err) : !isAbort;
      if (isAbort || !retryable || attempt === maxRetries) {
        throw err;
      }
      await sleep(backoff(attempt));
    }
  }
  throw lastErr;
}

module.exports = {
  downloadWithResume,
  runWithRetry,
  parseTotalFromContentRange
};
