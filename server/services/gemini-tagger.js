/**
 * Tagger Hook: Transparent Gemini Vision cover matching for standard Tag Comics Now! scans
 *
 * Hooks global fetch requests to the Python tagger sidecar (/api/tag-file-stream and /api/tag-file).
 * When Gemini API key is configured and daily quota is available:
 * 1. Adjusts request thresholds so Python gathers all candidates without prematurely auto-tagging with pHash.
 * 2. Streams progress in real-time to the Tag Comics Now! console.
 * 3. Compares the local cover art against candidate covers using Gemini Multimodal Vision.
 * 4. Respects live tagger thresholds (upperThreshold auto-accept, lowerThreshold review, below lower threshold reject).
 * 5. Calls /api/apply-tag on auto-accept so ComicInfo.xml is written.
 *
 * When Gemini API key is absent or quota is exhausted:
 * Falls back to standard tagger cover matching (pHash) with zero alteration.
 */

const cryptoVault = require('../utils/crypto-vault');
const { startMidnightPacificScheduler } = require('./gemini-quota');
const { getConfig, checkAndIncrementQuota } = require('./gemini-tag/resolver');
const { evaluateWithGemini } = require('./gemini-tag/evaluator');

let isHookInstalled = false;

function installTaggerHook(ctx) {
  if (isHookInstalled && globalThis.fetch && globalThis.fetch._isGeminiTaggerHook) return;
  isHookInstalled = true;

  const originalFetch = globalThis.fetch;
  const logger = ctx.log || (() => {});

  if (ctx.db) {
    try {
      startMidnightPacificScheduler({ db: ctx.db, log: logger });
    } catch (_) {}
  }

  // Override global fetch
  globalThis.fetch = async function hookFetch(input, init) {
    const urlStr = typeof input === 'string' ? input : (input?.url || input?.toString() || '');

    const isStream = urlStr.includes('/api/tag-file-stream');
    const isTagFile = !isStream && urlStr.includes('/api/tag-file');

    if (!isStream && !isTagFile) {
      return originalFetch(input, init);
    }

    let reqBody = {};
    try {
      reqBody = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
    } catch (_) {
      return originalFetch(input, init);
    }

    const config = getConfig(ctx);

    if (ctx.db && typeof ctx.db.dbGet === 'function') {
      try {
        const enabledRow = await ctx.db.dbGet("SELECT value FROM settings WHERE key = 'geminiCoverMatchEnabled'");
        if (enabledRow && enabledRow.value !== undefined && enabledRow.value !== null) {
          let parsedEnabled = enabledRow.value;
          try { parsedEnabled = JSON.parse(enabledRow.value); } catch { parsedEnabled = enabledRow.value; }
          config.enabled = parsedEnabled !== false && parsedEnabled !== 'false' && parsedEnabled !== 0 && parsedEnabled !== '0';
          if (ctx.config) ctx.config.geminiCoverMatchEnabled = config.enabled;
        }
      } catch (_) {}
    }

    if (!config.termsAccepted && ctx.db && typeof ctx.db.dbGet === 'function') {
      try {
        const row = await ctx.db.dbGet("SELECT value FROM settings WHERE key = 'geminiTermsAccepted'");
        if (row && (row.value === 'true' || row.value === '"true"' || row.value === true)) {
          config.termsAccepted = true;
          if (ctx.config) ctx.config.geminiTermsAccepted = true;
        }
      } catch (_) {}
    }

    if ((!config.apiKey || config.apiKey.startsWith('enc:v1:')) && ctx.db && typeof ctx.db.dbGet === 'function') {
      try {
        const keyRow = await ctx.db.dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
        if (keyRow?.value) {
          let rawVal = keyRow.value;
          try { rawVal = JSON.parse(rawVal); } catch { rawVal = keyRow.value; }
          config.apiKey = (cryptoVault.decrypt(rawVal) || rawVal || '').trim();
          if (ctx.config) ctx.config.geminiApiKey = config.apiKey;
        }
      } catch (_) {}
    }

    // If Gemini is disabled, has no API key, or terms have not been accepted, pass through completely unaltered
    if (!config.enabled || !config.apiKey || !config.termsAccepted) {
      return originalFetch(input, init);
    }

    // Check quota
    const quota = await checkAndIncrementQuota(ctx, config.dailyCap);
    if (!quota.allowed) {
      logger('WARN', 'TAGGER_HOOK', `Daily Gemini quota reached (${quota.count}/${config.dailyCap}). Using standard tagger cover matching (pHash).`);
      return originalFetch(input, init);
    }

    // Adjust request to Python so it gathers candidates without auto-writing with pHash
    const pythonReqBody = {
      ...reqBody,
      upper_threshold: 1.01,
      lower_threshold: 0.30
    };

    const newInit = {
      ...init,
      body: JSON.stringify(pythonReqBody)
    };

    if (isStream) {
      const originalRes = await originalFetch(input, newInit);
      if (!originalRes.ok || !originalRes.body) {
        return originalRes;
      }

      const textEncoder = new TextEncoder();
      const textDecoder = new TextDecoder();
      const reader = originalRes.body.getReader();
      let buffer = '';
      let finalResultData = null;

      const customStream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += textDecoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) {
                  controller.enqueue(textEncoder.encode(line + '\n'));
                  continue;
                }
                if (trimmed.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(trimmed.slice(6));
                    if (data.type === 'progress') {
                      controller.enqueue(textEncoder.encode(line + '\n'));
                    } else if (data.type === 'result') {
                      finalResultData = data.data;
                    } else {
                      controller.enqueue(textEncoder.encode(line + '\n'));
                    }
                  } catch (_) {
                    controller.enqueue(textEncoder.encode(line + '\n'));
                  }
                } else {
                  controller.enqueue(textEncoder.encode(line + '\n'));
                }
              }
            }

            // Python search complete. If candidates exist, evaluate with Gemini Vision!
            if (finalResultData && Array.isArray(finalResultData.candidates) && finalResultData.candidates.length > 0) {
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
                type: 'progress',
                source: 'Gemini Vision',
                message: `Comparing cover art with Gemini Vision against ${finalResultData.candidates.length} candidate(s)...`
              })}\n\n`));

              finalResultData = await evaluateWithGemini(ctx, originalFetch, logger, finalResultData, reqBody, config, controller, textEncoder);
            }

            if (finalResultData) {
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
                type: 'result',
                data: finalResultData
              })}\n\n`));
            }

            controller.close();
          } catch (streamErr) {
            controller.error(streamErr);
          }
        }
      });

      return new Response(customStream, {
        status: originalRes.status,
        statusText: originalRes.statusText,
        headers: originalRes.headers
      });
    } else {
      // Non-streaming /api/tag-file fallback
      const originalRes = await originalFetch(input, newInit);
      if (!originalRes.ok) {
        return originalRes;
      }

      let resData = await originalRes.json();
      if (resData && Array.isArray(resData.candidates) && resData.candidates.length > 0) {
        resData = await evaluateWithGemini(ctx, originalFetch, logger, resData, reqBody, config, null, null);
      }

      return new Response(JSON.stringify(resData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  globalThis.fetch._isGeminiTaggerHook = true;
  logger('INFO', 'EXT_COVER', '✓ Gemini Vision transparent cover matcher hooked into Tag Comics Now! scan.');
}

module.exports = {
  installTaggerHook,
  installGeminiTagger: installTaggerHook
};
