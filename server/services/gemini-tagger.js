/**
 * Tagger Hook: Transparent Gemini Vision cover matching for standard ComicTagger scans
 *
 * Hooks global fetch requests to the Python tagger sidecar (/api/tag-file-stream and /api/tag-file).
 * When Gemini API key is configured and daily quota is available:
 * 1. Adjusts request thresholds so Python gathers all candidates without prematurely auto-tagging with pHash.
 * 2. Streams progress in real-time to the ComicTagger console.
 * 3. Compares the local cover art against candidate covers using Gemini Multimodal Vision.
 * 4. Respects live tagger thresholds (upperThreshold auto-accept, lowerThreshold review, below lower threshold reject).
 * 5. Calls /api/apply-tag on auto-accept so ComicInfo.xml is written.
 *
 * When Gemini API key is absent or quota is exhausted:
 * Falls back to standard tagger cover matching (pHash) with zero alteration.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { matchCoverToCandidates } = require('./gemini-cover');
const { synthesizeMetadataWithGemini } = require('./gemini-metadata');

let isHookInstalled = false;

function installTaggerHook(ctx) {
  if (isHookInstalled) return;
  isHookInstalled = true;

  const originalFetch = globalThis.fetch;
  const logger = ctx.log || ((lvl, tag, msg) => console.log(`[${lvl}][${tag}] ${msg}`));

  function getConfig() {
    let fileConfig = {};
    try {
      const defaultConfigFile = (() => {
        try {
          return require('../constants').CONFIG_FILE;
        } catch (_) {
          return path.join(__dirname, '../../config.json');
        }
      })();
      const configPath = ctx.paths?.CONFIG_FILE || defaultConfigFile;
      if (fs.existsSync(configPath)) {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (_) {}

    let configGetterKey = '';
    try {
      const { getGeminiApiKey } = require('../config');
      configGetterKey = getGeminiApiKey();
    } catch (_) {}

    const enabled = process.env.GEMINI_COVER_MATCH_ENABLED !== undefined
      ? (process.env.GEMINI_COVER_MATCH_ENABLED === 'true' || process.env.GEMINI_COVER_MATCH_ENABLED === '1')
      : (fileConfig.geminiCoverMatchEnabled !== undefined ? !!fileConfig.geminiCoverMatchEnabled : true);

    const termsAccepted = fileConfig.geminiTermsAccepted === true;
    const apiKey = process.env.GEMINI_API_KEY || fileConfig.geminiApiKey || ctx.config?.geminiApiKey || configGetterKey || '';
    const model = (fileConfig.geminiModel || ctx.config?.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
    const dailyCap = parseInt(process.env.GEMINI_COVER_DAILY_CAP || fileConfig.geminiCoverDailyCap || '450', 10);
    const taggerServiceUrl = fileConfig.taggerServiceUrl || ctx.config?.taggerServiceUrl || 'http://127.0.0.1:5000';

    return { enabled, apiKey, model, dailyCap, taggerServiceUrl, termsAccepted };
  }

  async function checkAndIncrementQuota(dailyCap) {
    if (!ctx.db || typeof ctx.db.dbGet !== 'function') {
      return { allowed: true, count: 0 };
    }

    try {
      const today = new Date().toISOString().slice(0, 10);
      const resetRow = await ctx.db.dbGet("SELECT value FROM settings WHERE key = '_ext_cover_reset'");
      const lastReset = resetRow?.value;

      if (lastReset !== today) {
        await ctx.db.dbRun("INSERT INTO settings (key, value) VALUES ('_ext_cover_reset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [today]);
        await ctx.db.dbRun("INSERT INTO settings (key, value) VALUES ('_ext_cover_requests', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
      }

      const reqRow = await ctx.db.dbGet("SELECT value FROM settings WHERE key = '_ext_cover_requests'");
      const count = parseInt(reqRow?.value || '0', 10);

      if (count >= dailyCap) {
        return { allowed: false, count };
      }

      const newCount = count + 1;
      await ctx.db.dbRun("UPDATE settings SET value = ? WHERE key = '_ext_cover_requests'", [String(newCount)]);
      return { allowed: true, count: newCount };
    } catch (err) {
      return { allowed: true, count: 0 };
    }
  }

  async function resolveLocalCover(filePath) {
    try {
      // 1. Check existing thumbnail from SQLite
      if (ctx.db && typeof ctx.db.dbGet === 'function') {
        const row = await ctx.db.dbGet("SELECT thumbnailPath FROM comics WHERE path = ?", [filePath]);
        if (row && row.thumbnailPath) {
          const thumbDir = ctx.paths?.THUMBNAILS_DIRECTORY || path.join(__dirname, '../../thumbnails');
          const thumbPath = path.join(thumbDir, path.basename(row.thumbnailPath));
          if (fs.existsSync(thumbPath)) return thumbPath;
        }
      }

      // 2. Try library-pages generateThumbnail
      try {
        const { generateThumbnail } = require('../../server/services/library-pages');
        if (typeof generateThumbnail === 'function') {
          const thumb = await generateThumbnail(filePath);
          if (thumb) {
            const thumbDir = ctx.paths?.THUMBNAILS_DIRECTORY || path.join(__dirname, '../../thumbnails');
            const full = path.join(thumbDir, path.basename(thumb));
            if (fs.existsSync(full)) return full;
          }
        }
      } catch (_) {}

      // 3. Check persistent cover extracted by Python tagger
      const fileHash = crypto.createHash('md5').update(filePath).digest('hex');
      const filename = path.basename(filePath);
      const taggerUpload = path.join(__dirname, '../../tagger/uploads', fileHash, `cover_${filename}.jpg`);
      if (fs.existsSync(taggerUpload)) {
        return taggerUpload;
      }
    } catch (err) {
      logger('DEBUG', 'TAGGER_HOOK', `Cover resolution exception: ${err.message}`);
    }
    return null;
  }

  async function recordDecision(filePath, decision, winnerTitle) {
    if (!ctx.db || typeof ctx.db.dbRun !== 'function') return;
    try {
      const comicRow = await ctx.db.dbGet("SELECT id FROM comics WHERE path = ?", [filePath]);
      const comicId = comicRow?.id || crypto.createHash('sha1').update(filePath).digest('hex');
      const bestSource = decision.bestIndex >= 0 ? (winnerTitle || `candidate_${decision.bestIndex}`) : 'rejected';
      await ctx.db.dbRun(`
        INSERT INTO _ext_cover_match (comicId, bestSource, confidence, reason, decidedAt)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(comicId) DO UPDATE SET
          bestSource = excluded.bestSource,
          confidence = excluded.confidence,
          reason = excluded.reason,
          decidedAt = excluded.decidedAt
      `, [comicId, bestSource, decision.confidence || 0, decision.reason || '', Date.now()]);
    } catch (_) {}
  }

  async function evaluateWithGemini(res, reqBody, config, controller, textEncoder) {
    const filePath = reqBody.path;
    const candidates = res.candidates || [];
    const upperThreshold = typeof reqBody.upper_threshold === 'number' ? reqBody.upper_threshold : 0.85;
    const lowerThreshold = typeof reqBody.lower_threshold === 'number' ? reqBody.lower_threshold : 0.80;

    const localCoverPath = await resolveLocalCover(filePath);
    if (!localCoverPath) {
      if (controller && textEncoder) {
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          source: 'Gemini Vision',
          message: 'Local cover art unavailable; using standard tagger candidate ranking'
        })}\n\n`));
      }
      return res;
    }

    let decision;
    try {
      decision = await matchCoverToCandidates({
        localCoverPath,
        candidates,
        apiKey: config.apiKey,
        model: config.model
      });
    } catch (err) {
      if (controller && textEncoder) {
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          source: 'Gemini Vision',
          message: `Gemini vision request failed (${err.message}); using standard tagger ranking`
        })}\n\n`));
      }
      return res;
    }

    const { bestIndex, confidence, reason } = decision;
    const winner = (bestIndex >= 0 && bestIndex < candidates.length) ? candidates[bestIndex] : null;
    const winnerTitle = winner ? (winner.metadata?.title || winner.title || 'Unknown Title') : null;

    recordDecision(filePath, decision, winnerTitle);

    if (winner) {
      const pct = Math.round(confidence * 100);

      // Request 2: Metadata Synthesis & Normalization (only for confirmed matches >= lowerThreshold)
      let finalMetadata = winner.metadata || {};
      const metaQuota = await checkAndIncrementQuota(config.dailyCap);
      if (metaQuota.allowed) {
        if (controller && textEncoder) {
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            source: 'Gemini AI',
            message: 'Synthesizing canonical metadata with Gemini 3.5 Flash-Lite...'
          })}\n\n`));
        }

        let existingMeta = {};
        try {
          const { getComicInfoFromArchive } = require('../../server/services/metadata');
          existingMeta = await getComicInfoFromArchive(filePath);
        } catch (_) {}

        let publisherCodex = [];
        try {
          if (ctx.db && typeof ctx.db.dbAll === 'function') {
            const rows = await ctx.db.dbAll("SELECT DISTINCT publisher FROM comics WHERE publisher IS NOT NULL AND publisher != '' AND publisher != 'Unknown Publisher'");
            publisherCodex = (rows || []).map(r => r.publisher).filter(Boolean);
          }
        } catch (_) {}

        try {
          const synthesized = await synthesizeMetadataWithGemini({
            winningCandidate: winner,
            allCandidates: candidates,
            filename: path.basename(filePath),
            existingMeta,
            publisherCodex,
            apiKey: config.apiKey,
            model: config.model
          });

          if (synthesized && typeof synthesized === 'object') {
            finalMetadata = synthesized;
            winner.metadata = synthesized;
            if (controller && textEncoder) {
              controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
                type: 'progress',
                source: 'Gemini AI',
                message: `✓ Metadata synthesized (Series: "${synthesized.Series}", Vol: ${synthesized.Volume || '1'}, Publisher: ${synthesized.Publisher})`
              })}\n\n`));
            }
          }
        } catch (synthErr) {
          logger('WARN', 'TAGGER_HOOK', `Metadata synthesis failed; using raw candidate data: ${synthErr.message}`);
        }
      }

      const displayTitle = finalMetadata.Series
        ? `${finalMetadata.Series} #${finalMetadata.Number || winner.issue || ''}`.trim()
        : (winnerTitle || 'Unknown Title');

      if (confidence >= upperThreshold) {
        // >= Upper threshold: Auto-accept!
        if (controller && textEncoder) {
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            source: 'Gemini Vision',
            message: `✓ Match confirmed (${pct}% >= ${Math.round(upperThreshold * 100)}%): "${displayTitle}" - ${reason}`
          })}\n\n`));
        }

        // Apply metadata to file via sidecar /api/apply-tag
        try {
          const serviceUrl = config.taggerServiceUrl || 'http://127.0.0.1:5000';
          await originalFetch(`${serviceUrl}/api/apply-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: filePath,
              metadata: finalMetadata,
              metadata_storage: reqBody.metadata_storage || 'archive'
            })
          });
        } catch (applyErr) {
          logger('WARN', 'TAGGER_HOOK', `Failed to apply tag via sidecar: ${applyErr.message}`);
        }

        res.status = 'tagged';
        res.matched_title = displayTitle;
        res.confidence = pct;
        res.metadata = finalMetadata;
        res.source = winner.source;
        res.matching_url = winner.matching_url || winner.source;
        res.reason = `Auto-tagged by Gemini Vision & Metadata AI (${pct}%): ${reason}`;
      } else if (confidence >= lowerThreshold) {
        // Between lower and upper threshold: Needs user review
        if (controller && textEncoder) {
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            source: 'Gemini Vision',
            message: `ⓘ Review required (${pct}% in ${Math.round(lowerThreshold * 100)}%-${Math.round(upperThreshold * 100)}%): "${displayTitle}" - ${reason}`
          })}\n\n`));
        }

        // Place winning candidate with synthesized metadata as choice #1
        winner.metadata = finalMetadata;
        const reordered = [winner, ...candidates.filter((_, idx) => idx !== bestIndex)];
        res.candidates = reordered;
        res.status = 'review';
        res.matched_title = displayTitle;
        res.confidence = pct;
        res.metadata = finalMetadata;
        res.source = winner.source;
        res.matching_url = winner.matching_url || winner.source;
        res.reason = `Needs Confirmation (Gemini Vision confidence: ${pct}% - ${reason})`;
      } else {
        // Below lower threshold: Ignored/rejected
        if (controller && textEncoder) {
          controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            source: 'Gemini Vision',
            message: `✘ Match rejected (${pct}% < ${Math.round(lowerThreshold * 100)}%): ${reason}`
          })}\n\n`));
        }
        res.status = 'skipped';
        res.confidence = 0;
        res.reason = `Rejected by Gemini Vision: ${reason}`;
      }
    } else {
      // Rejection / None match
      if (controller && textEncoder) {
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          source: 'Gemini Vision',
          message: `✘ All candidates rejected by Gemini Vision: ${reason}`
        })}\n\n`));
      }
      res.status = 'skipped';
      res.confidence = 0;
      res.reason = `All candidates rejected by Gemini Vision: ${reason}`;
    }

    return res;
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

    const config = getConfig();

    if (!config.termsAccepted && ctx.db && typeof ctx.db.dbGet === 'function') {
      try {
        const row = await ctx.db.dbGet("SELECT value FROM settings WHERE key = 'geminiTermsAccepted'");
        if (row && (row.value === 'true' || row.value === '"true"' || row.value === true)) {
          config.termsAccepted = true;
          if (ctx.config) ctx.config.geminiTermsAccepted = true;
        }
      } catch (_) {}
    }

    if (!config.apiKey && ctx.db && typeof ctx.db.dbGet === 'function') {
      try {
        const keyRow = await ctx.db.dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
        if (keyRow?.value) {
          try { config.apiKey = JSON.parse(keyRow.value); } catch { config.apiKey = keyRow.value; }
          if (ctx.config) ctx.config.geminiApiKey = config.apiKey;
        }
      } catch (_) {}
    }

    // If Gemini is disabled, has no API key, or terms have not been accepted, pass through completely unaltered
    if (!config.enabled || !config.apiKey || !config.termsAccepted) {
      return originalFetch(input, init);
    }

    // Check quota
    const quota = await checkAndIncrementQuota(config.dailyCap);
    if (!quota.allowed) {
      logger('WARN', 'TAGGER_HOOK', `Daily Gemini quota reached (${quota.count}/${config.dailyCap}). Using standard tagger cover matching (pHash).`);
      return originalFetch(input, init);
    }

    // Adjust request to Python so it gathers candidates without auto-writing with pHash
    const pythonReqBody = {
      ...reqBody,
      upper_threshold: 1.01, // Prevent premature pHash auto-tagging
      lower_threshold: 0.30  // Allow all viable title matches through for Gemini visual evaluation
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

              finalResultData = await evaluateWithGemini(finalResultData, reqBody, config, controller, textEncoder);
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
        resData = await evaluateWithGemini(resData, reqBody, config, null, null);
      }

      return new Response(JSON.stringify(resData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  logger('INFO', 'EXT_COVER', '✓ Gemini Vision transparent cover matcher hooked into ComicTagger scan.');
}

module.exports = { installTaggerHook, installGeminiTagger: installTaggerHook };
