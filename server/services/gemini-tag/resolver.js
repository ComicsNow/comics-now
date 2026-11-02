const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cryptoVault = require('../../utils/crypto-vault');
const { CONFIG_FILE } = require('../../constants');
const { getGeminiApiKey, getGeminiCoverMatchEnabled } = require('../../config');
const { incrementDailyUsage } = require('../gemini-quota');
const { generateThumbnail } = require('../library-pages');

/**
 * Resolves configuration for Gemini tagger from disk, DB, and environment.
 */
function getConfig(ctx) {
  let fileConfig = {};
  try {
    const defaultConfigFile = CONFIG_FILE || path.join(__dirname, '../../../config.json');
    const configPath = ctx.paths?.CONFIG_FILE || defaultConfigFile;
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {}

  let configGetterKey = '';
  try {
    configGetterKey = getGeminiApiKey();
  } catch (_) {}

  let enabled = true;
  if (process.env.GEMINI_COVER_MATCH_ENABLED !== undefined) {
    enabled = (process.env.GEMINI_COVER_MATCH_ENABLED === 'true' || process.env.GEMINI_COVER_MATCH_ENABLED === '1');
  } else if (ctx && ctx.config && ctx.config.geminiCoverMatchEnabled !== undefined) {
    enabled = !!ctx.config.geminiCoverMatchEnabled;
  } else if (fileConfig.geminiCoverMatchEnabled !== undefined) {
    enabled = !!fileConfig.geminiCoverMatchEnabled;
  } else if (typeof getGeminiCoverMatchEnabled === 'function') {
    try { enabled = !!getGeminiCoverMatchEnabled(); } catch (_) {}
  }

  const termsAccepted = fileConfig.geminiTermsAccepted === true;
  const rawApiKey = process.env.GEMINI_API_KEY || configGetterKey || fileConfig.geminiApiKey || ctx.config?.geminiApiKey || '';
  const apiKey = (cryptoVault.decrypt(rawApiKey) || rawApiKey || '').trim();
  const model = (fileConfig.geminiModel || ctx.config?.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
  const dailyCap = parseInt(process.env.GEMINI_COVER_DAILY_CAP || fileConfig.geminiCoverDailyCap || '450', 10);
  const taggerServiceUrl = fileConfig.taggerServiceUrl || ctx.config?.taggerServiceUrl || 'http://127.0.0.1:5000';

  return { enabled, apiKey, model, dailyCap, taggerServiceUrl, termsAccepted };
}

async function checkAndIncrementQuota(ctx, dailyCap) {
  return incrementDailyUsage(ctx.db, dailyCap);
}

/**
 * Resolves local cover art for a comic file from thumbnail cache or extracted upload.
 */
async function resolveLocalCover(ctx, filePath, logger) {
  try {
    // 1. Check existing thumbnail from SQLite
    if (ctx.db && typeof ctx.db.dbGet === 'function') {
      const row = await ctx.db.dbGet("SELECT thumbnailPath FROM comics WHERE path = ?", [filePath]);
      if (row && row.thumbnailPath) {
        const thumbDir = ctx.paths?.THUMBNAILS_DIRECTORY || path.join(__dirname, '../../../thumbnails');
        const thumbPath = path.join(thumbDir, path.basename(row.thumbnailPath));
        if (fs.existsSync(thumbPath)) return thumbPath;
      }
    }

    // 2. Try library-pages generateThumbnail
    try {
      if (typeof generateThumbnail === 'function') {
        const thumb = await generateThumbnail(filePath);
        if (thumb) {
          const thumbDir = ctx.paths?.THUMBNAILS_DIRECTORY || path.join(__dirname, '../../../thumbnails');
          const full = path.join(thumbDir, path.basename(thumb));
          if (fs.existsSync(full)) return full;
        }
      }
    } catch (_) {}

    // 3. Check persistent cover extracted by Python tagger
    const fileHash = crypto.createHash('md5').update(filePath).digest('hex');
    const filename = path.basename(filePath);
    const taggerUpload = path.join(__dirname, '../../../tagger/uploads', fileHash, `cover_${filename}.jpg`);
    if (fs.existsSync(taggerUpload)) {
      return taggerUpload;
    }
  } catch (err) {
    logger('DEBUG', 'TAGGER_HOOK', `Cover resolution exception: ${err.message}`);
  }
  return null;
}

/**
 * Records the Gemini matching decision into SQLite for auditability.
 */
async function recordDecision(ctx, filePath, decision, winnerTitle) {
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

module.exports = {
  getConfig,
  checkAndIncrementQuota,
  resolveLocalCover,
  recordDecision
};
