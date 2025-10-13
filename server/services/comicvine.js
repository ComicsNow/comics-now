const { COMICVINE_API_URL } = require('../constants');

const comicVineCache = new Map();

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object') {
        deepFreeze(value);
      }
    }
  }
  return obj;
}

async function cvFetchJson(url, options = {}) {
  if (comicVineCache.has(url)) {
    const cached = comicVineCache.get(url);
    comicVineCache.delete(url);
    comicVineCache.set(url, cached);
    return deepFreeze(cached);
  }

  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': 'Comics Now', ...(options.headers || {}) }
  });

  if (!res.ok) {
    const err = new Error(`ComicVine request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const frozen = deepFreeze(data);
  comicVineCache.set(url, frozen);
  if (comicVineCache.size > 10) {
    const firstKey = comicVineCache.keys().next().value;
    comicVineCache.delete(firstKey);
  }

  return frozen;
}

function normalizeCvId(raw) {
  const m = String(raw).match(/^(?:\d{4}-)?(\d+)$/);
  return m ? m[1] : String(raw);
}

function stripHtml(s = '') {
  return s.replace(/<\/?[^>]+(>|$)/g, '');
}

module.exports = {
  COMICVINE_API_URL,
  cvFetchJson,
  normalizeCvId,
  stripHtml
};
