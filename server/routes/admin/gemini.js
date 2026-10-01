/**
 * Gemini AI Settings and Compliance Routes
 *
 * Provides endpoints for managing Gemini Vision & Metadata configuration,
 * verifying 18+ strict compliance acceptance, and tracking daily quota usage.
 *
 * @param {import('express').Router} router
 * @param {Object} deps
 */

const fs = require('fs');
const path = require('path');

module.exports = function attach(router, deps) {
  const {
    config = {},
    dbGet,
    dbRun,
    log = () => {},
    saveConfigToDisk
  } = deps;

  const defaultConfigFile = (() => {
    try {
      return require('../../constants').CONFIG_FILE;
    } catch (_) {
      return path.join(__dirname, '../../../config.json');
    }
  })();
  const configPath = deps.paths?.CONFIG_FILE || defaultConfigFile;

  function readConfig() {
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  async function checkTermsAccepted() {
    const cfg = readConfig();
    if (config.geminiTermsAccepted === true) return true;
    if (typeof dbGet === 'function') {
      try {
        const row = await dbGet("SELECT value FROM settings WHERE key = 'geminiTermsAccepted'");
        if (row && (row.value === 'true' || row.value === '"true"' || row.value === true)) {
          config.geminiTermsAccepted = true;
          return true;
        }
      } catch (_) {}
    }
    if (cfg.geminiTermsAccepted !== undefined) {
      config.geminiTermsAccepted = cfg.geminiTermsAccepted === true;
      return config.geminiTermsAccepted;
    }
    return false;
  }

  async function handleGetConfig(req, res) {
    try {
      if (typeof res.set === 'function') {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
      const cfg = readConfig();
      const termsAccepted = await checkTermsAccepted();

      let dbApiKey = '';
      let dbModel = '';
      let dbEnabled = null;
      let dbCap = null;
      if (typeof dbGet === 'function') {
        try {
          const keyRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiApiKey'");
          if (keyRow?.value) {
            try { dbApiKey = JSON.parse(keyRow.value); } catch { dbApiKey = keyRow.value; }
          }
          const modelRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiModel'");
          if (modelRow?.value) {
            try { dbModel = JSON.parse(modelRow.value); } catch { dbModel = modelRow.value; }
          }
          const enabledRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiCoverMatchEnabled'");
          if (enabledRow?.value !== undefined) {
            try { dbEnabled = JSON.parse(enabledRow.value); } catch { dbEnabled = enabledRow.value; }
          }
          const capRow = await dbGet("SELECT value FROM settings WHERE key = 'geminiCoverDailyCap'");
          if (capRow?.value) {
            try { dbCap = JSON.parse(capRow.value); } catch { dbCap = capRow.value; }
          }
        } catch (_) {}
      }

      let configGetterKey = '';
      try {
        const { getGeminiApiKey } = require('../../config');
        configGetterKey = getGeminiApiKey();
      } catch (_) {}

      const apiKey = (process.env.NODE_ENV === 'test' ? '' : process.env.GEMINI_API_KEY) || dbApiKey || cfg.geminiApiKey || config.geminiApiKey || configGetterKey || '';

      let quotaCount = 0;
      if (typeof dbGet === 'function') {
        try {
          const reqRow = await dbGet("SELECT value FROM settings WHERE key = '_ext_cover_requests'");
          quotaCount = parseInt(reqRow?.value || '0', 10);
        } catch (_) {}
      }

      const isEnabled = dbEnabled !== null ? !!dbEnabled : (cfg.geminiCoverMatchEnabled !== false);
      const activeModel = dbModel || cfg.geminiModel || config.geminiModel || 'gemini-3.5-flash-lite';
      const dailyCapVal = dbCap ? parseInt(dbCap, 10) : parseInt(cfg.geminiCoverDailyCap || '450', 10);

      res.json({
        enabled: isEnabled,
        hasApiKey: !!apiKey,
        termsAccepted: termsAccepted,
        model: activeModel,
        dailyCap: dailyCapVal,
        dailyUsed: quotaCount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function handleGetModels(req, res) {
    try {
      const cfg = readConfig();
      const apiKey = (req.query.apiKey || cfg.geminiApiKey || config.geminiApiKey || (process.env.NODE_ENV === 'test' ? '' : process.env.GEMINI_API_KEY) || '').trim();

      const fallbackModels = [
        { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite (Recommended Default)' },
        { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' },
        { id: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash-Lite' },
        { id: 'gemini-2.0-flash-lite-preview-02-05', displayName: 'Gemini 2.0 Flash-Lite Preview' }
      ];

      if (!apiKey) {
        return res.json({
          models: fallbackModels,
          source: 'default'
        });
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = await resp.json();
          const rawModels = Array.isArray(data.models) ? data.models : [];
          // Filter ONLY models that have Flash-Lite in name or displayName
          const flashLiteModels = rawModels.filter(m => {
            const name = (m.name || '').toLowerCase();
            const disp = (m.displayName || '').toLowerCase();
            return name.includes('flash-lite') || name.includes('flashlite') ||
                   disp.includes('flash-lite') || disp.includes('flashlite');
          }).map(m => {
            const cleanId = (m.name || '').replace(/^models\//, '');
            return {
              id: cleanId,
              displayName: m.displayName || cleanId,
              description: m.description || ''
            };
          });

          // Ensure gemini-3.5-flash-lite is present
          if (!flashLiteModels.some(m => m.id === 'gemini-3.5-flash-lite')) {
            flashLiteModels.unshift({
              id: 'gemini-3.5-flash-lite',
              displayName: 'Gemini 3.5 Flash-Lite (Default)',
              description: 'Fast multimodal vision & canonical metadata reasoning'
            });
          }

          return res.json({
            models: flashLiteModels.length > 0 ? flashLiteModels : fallbackModels,
            source: 'gemini-api'
          });
        } else {
          const errData = await resp.json().catch(() => ({}));
          return res.json({
            models: fallbackModels,
            source: 'fallback',
            warning: errData.error?.message || 'API request failed'
          });
        }
      } catch (fetchErr) {
        return res.json({
          models: fallbackModels,
          source: 'fallback',
          warning: fetchErr.message
        });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function handlePostConfig(req, res) {
    try {
      const {
        geminiApiKey,
        geminiModel,
        geminiCoverMatchEnabled,
        geminiCoverDailyCap,
        geminiTermsAccepted
      } = req.body || {};

      const cfg = readConfig();
      const alreadyAccepted = await checkTermsAccepted();

      if (geminiTermsAccepted === true || alreadyAccepted) {
        cfg.geminiTermsAccepted = true;
        config.geminiTermsAccepted = true;
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiTermsAccepted', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'");
        }
      } else if (geminiTermsAccepted === false) {
        cfg.geminiTermsAccepted = false;
        config.geminiTermsAccepted = false;
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiTermsAccepted', 'false') ON CONFLICT(key) DO UPDATE SET value = 'false'");
        }
      }

      // If user attempts to set an API key or enable Gemini without terms accepted
      if ((geminiApiKey || geminiCoverMatchEnabled) && !cfg.geminiTermsAccepted) {
        cfg.geminiCoverMatchEnabled = false;
        config.geminiCoverMatchEnabled = false;
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
        return res.status(400).json({
          error: 'Gemini compliance agreement must be accepted before enabling AI cataloging.',
          termsRequired: true
        });
      }

      if (geminiApiKey !== undefined) {
        const key = String(geminiApiKey).trim();
        cfg.geminiApiKey = key;
        config.geminiApiKey = key;
        try {
          const { setGeminiApiKey } = require('../../config');
          setGeminiApiKey(key, true);
        } catch (_) {}
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiApiKey', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [JSON.stringify(key), JSON.stringify(key)]);
        }
      }
      if (geminiModel !== undefined) {
        const model = String(geminiModel).trim();
        cfg.geminiModel = model;
        config.geminiModel = model;
        try {
          const { setGeminiModel } = require('../../config');
          setGeminiModel(model, true);
        } catch (_) {}
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiModel', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [JSON.stringify(model), JSON.stringify(model)]);
        }
      }
      if (geminiCoverMatchEnabled !== undefined) {
        const enabled = !!geminiCoverMatchEnabled;
        cfg.geminiCoverMatchEnabled = enabled;
        config.geminiCoverMatchEnabled = enabled;
        try {
          const { setGeminiCoverMatchEnabled } = require('../../config');
          setGeminiCoverMatchEnabled(enabled, true);
        } catch (_) {}
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiCoverMatchEnabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [JSON.stringify(enabled), JSON.stringify(enabled)]);
        }
      }
      if (geminiCoverDailyCap !== undefined) {
        const cap = parseInt(geminiCoverDailyCap, 10);
        cfg.geminiCoverDailyCap = cap;
        config.geminiCoverDailyCap = cap;
        try {
          const { setGeminiCoverDailyCap } = require('../../config');
          setGeminiCoverDailyCap(cap, true);
        } catch (_) {}
        if (typeof dbRun === 'function') {
          await dbRun("INSERT INTO settings (key, value) VALUES ('geminiCoverDailyCap', ?) ON CONFLICT(key) DO UPDATE SET value = ?", [JSON.stringify(cap), JSON.stringify(cap)]);
        }
      }

      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
      if (typeof saveConfigToDisk === 'function') {
        saveConfigToDisk();
      }

      res.json({
        ok: true,
        message: 'Settings saved',
        termsAccepted: !!cfg.geminiTermsAccepted,
        model: cfg.geminiModel || 'gemini-3.5-flash-lite'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Canonical endpoints
  router.get('/api/v1/gemini/config', handleGetConfig);
  router.post('/api/v1/gemini/config', handlePostConfig);
  router.get('/api/v1/gemini/models', handleGetModels);

  // Backwards compatibility aliases
  router.get('/api/v1/_ext/gemini/config', handleGetConfig);
  router.post('/api/v1/_ext/gemini/config', handlePostConfig);
  router.get('/api/v1/_ext/gemini/models', handleGetModels);
  router.get('/api/v1/_ext/cover-match/config', handleGetConfig);
  router.post('/api/v1/_ext/cover-match/config', handlePostConfig);
};
