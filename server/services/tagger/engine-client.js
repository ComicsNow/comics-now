const db = require('../../db');
const { ctLog } = require('../../logger');
const {
  getTaggerServiceUrl,
  getComicVineApiKey,
  getGoogleBooksApiKey,
  getMetronUser,
  getMetronPassword,
  getGcdUser,
  getGcdPassword
} = require('../../config');

function formatDuration(msVal) {
  if (!msVal || msVal <= 0 || !isFinite(msVal)) return '< 1s';
  const totalSeconds = Math.round(msVal / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

async function callTaggerEngineWithProgress(serviceUrl, reqBody, abortSignal, onProgress) {
  try {
    const fetchRes = await fetch(`${serviceUrl}/api/tag-file-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortSignal,
      body: JSON.stringify(reqBody)
    });

    if (fetchRes.ok && fetchRes.body) {
      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'progress') {
                onProgress?.(data);
              } else if (data.type === 'result') {
                finalResult = data.data;
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Tagger engine error');
              }
            } catch (pe) {
              if (pe.message && !pe.message.includes('JSON')) throw pe;
            }
          }
        }
      }

      if (finalResult) return finalResult;
    }
  } catch (streamErr) {
    if (abortSignal && abortSignal.aborted) throw streamErr;
  }

  // Fallback to non-streaming POST
  const fallbackRes = await fetch(`${serviceUrl}/api/tag-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abortSignal,
    body: JSON.stringify(reqBody)
  });
  if (!fallbackRes.ok) {
    const errText = await fallbackRes.text();
    throw new Error(errText || `Status ${fallbackRes.status}`);
  }
  return await fallbackRes.json();
}

async function searchExternal(source, query) {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const comicvineApiKey = getComicVineApiKey();
  const googleBooksApiKey = getGoogleBooksApiKey();
  const metronUser = getMetronUser();
  const metronPass = getMetronPassword();
  const gcdUser = typeof getGcdUser === 'function' ? getGcdUser() : '';
  const gcdPass = typeof getGcdPassword === 'function' ? getGcdPassword() : '';

  const fetchRes = await fetch(`${serviceUrl}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      query,
      comicvine_api_key: comicvineApiKey,
      google_books_api_key: googleBooksApiKey,
      metron_user: metronUser,
      metron_pass: metronPass,
      gcd_user: gcdUser,
      gcd_pass: gcdPass
    })
  });
  if (!fetchRes.ok) {
    const errText = await fetchRes.text();
    throw new Error(errText || `Search failed with status ${fetchRes.status}`);
  }
  return await fetchRes.json();
}

async function getScanLogsList() {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const res = await fetch(`${serviceUrl}/api/logs`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.logs)) return data.logs;
  return [];
}

async function getScanLogDetail(logId) {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  const res = await fetch(`${serviceUrl}/api/logs/${logId}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return await res.json();
}

async function clearEnhancedTracking() {
  const serviceUrl = getTaggerServiceUrl() || 'http://127.0.0.1:5000';
  let pyResult = null;
  try {
    const res = await fetch(`${serviceUrl}/api/enhanced-comics/clear`, { method: 'POST' });
    if (res.ok) {
      pyResult = await res.json();
    }
  } catch (e) {
    ctLog(`⚠ Could not clear tagger engine tracking DB: ${e.message}`);
  }

  try {
    await db.dbRun("UPDATE comics SET tagStatus = 'pending', updatedAt = NULL WHERE tagStatus IN ('failed', 'completed', 'successful')");
    ctLog('✓ Reset comic tagging status in database.');
  } catch (dbErr) {
    ctLog(`⚠ Failed to reset comics in database: ${dbErr.message}`);
  }

  return pyResult || { ok: true };
}

module.exports = {
  formatDuration,
  callTaggerEngineWithProgress,
  searchExternal,
  getScanLogsList,
  getScanLogDetail,
  clearEnhancedTracking
};
