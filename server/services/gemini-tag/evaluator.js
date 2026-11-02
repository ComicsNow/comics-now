const path = require('path');
const { matchCoverToCandidates } = require('../gemini-cover');
const { synthesizeMetadataWithGemini } = require('../gemini-metadata');
const { getComicInfoFromArchive } = require('../metadata');
const {
  resolveLocalCover,
  recordDecision,
  checkAndIncrementQuota
} = require('./resolver');

/**
 * Evaluates candidate comic matches using Gemini Vision cover matching and metadata synthesis.
 */
async function evaluateWithGemini(ctx, originalFetch, logger, res, reqBody, config, controller, textEncoder) {
  const filePath = reqBody.path;
  const candidates = res.candidates || [];
  const upperThreshold = typeof reqBody.upper_threshold === 'number' ? reqBody.upper_threshold : 0.85;
  const lowerThreshold = typeof reqBody.lower_threshold === 'number' ? reqBody.lower_threshold : 0.80;

  const localCoverPath = await resolveLocalCover(ctx, filePath, logger);
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

  recordDecision(ctx, filePath, decision, winnerTitle);

  if (winner) {
    const pct = Math.round(confidence * 100);

    let finalMetadata = winner.metadata || {};
    const metaQuota = await checkAndIncrementQuota(ctx, config.dailyCap);
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
      if (controller && textEncoder) {
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          source: 'Gemini Vision',
          message: `✓ Match confirmed (${pct}% >= ${Math.round(upperThreshold * 100)}%): "${displayTitle}" - ${reason}`
        })}\n\n`));
      }

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
      if (controller && textEncoder) {
        controller.enqueue(textEncoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          source: 'Gemini Vision',
          message: `ⓘ Review required (${pct}% in ${Math.round(lowerThreshold * 100)}%-${Math.round(upperThreshold * 100)}%): "${displayTitle}" - ${reason}`
        })}\n\n`));
      }

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

module.exports = {
  evaluateWithGemini
};
