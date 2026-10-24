const { COMICVINE_API_URL } = require('../constants');
const { deepFreeze } = require('../utils');

const comicVineCache = new Map();
let rateLimitQueue = Promise.resolve();

// Single fetch with a hard timeout so a stalled connection can never hang forever.
async function cvFetchOnce(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': 'Comics Now', ...(options.headers || {}) }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function cvFetchJson(url, options = {}) {
  if (comicVineCache.has(url)) {
    const cached = comicVineCache.get(url);
    comicVineCache.delete(url);
    comicVineCache.set(url, cached);
    return deepFreeze(cached);
  }

  const run = async () => {
    let res = await cvFetchOnce(url, options);

    if (res.status === 420 || res.status === 429) {
      // Rate limited — back off 60s then retry once
      await new Promise(r => setTimeout(r, 60000));
      res = await cvFetchOnce(url, options);
    }

    if (!res.ok) {
      const err = new Error(`ComicVine request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return deepFreeze(data);
  };

  // Append to the serial queue. The task's own result is what the caller awaits,
  // but the queue continuation ALWAYS resolves (ignoring success/failure) + adds
  // 500ms spacing — so a failed request can never leave the chain in a rejected
  // state, which would otherwise deadlock every subsequent caller.
  const resultPromise = rateLimitQueue.then(run, run);
  rateLimitQueue = resultPromise.then(
    () => new Promise(r => setTimeout(r, 500)),
    () => new Promise(r => setTimeout(r, 500))
  );

  const result = await resultPromise;

  comicVineCache.set(url, result);
  if (comicVineCache.size > 500) {
    const firstKey = comicVineCache.keys().next().value;
    comicVineCache.delete(firstKey);
  }

  return result;
}

function normalizeCvId(raw) {
  const m = String(raw).match(/^(?:\d{4}-)?(\d+)$/);
  return m ? m[1] : String(raw);
}

module.exports = {
  COMICVINE_API_URL,
  cvFetchJson,
  normalizeCvId
};
