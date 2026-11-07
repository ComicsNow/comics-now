const fs = require('fs');
const express = require('express');

jest.mock('../server/utils/crypto-vault', () => ({
  encrypt: jest.fn(k => `enc_${k}`),
  decrypt: jest.fn(k => k ? k.replace(/^enc_/, '') : ''),
  isMasked: jest.fn(k => typeof k === 'string' && k.includes('•••')),
  mask: jest.fn(k => k ? `${k.slice(0, 4)}••••` : '')
}));

const attachGeminiRoutes = require('../server/routes/admin/gemini');

describe('Compliance & Config Endpoints', () => {
  let router;
  let testConfig;
  let mockDbRun;
  let mockDbGet;
  const testConfigPath = '/tmp/test-compliance-config.json';

  beforeEach(() => {
    testConfig = {
      geminiApiKey: '',
      geminiCoverMatchEnabled: false,
      geminiTermsAccepted: false
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig), 'utf8');

    mockDbGet = jest.fn().mockResolvedValue(null);
    mockDbRun = jest.fn().mockResolvedValue({});
    router = express.Router();
    attachGeminiRoutes(router, {
      config: testConfig,
      paths: { CONFIG_FILE: testConfigPath },
      dbGet: mockDbGet,
      dbRun: mockDbRun,
      log: jest.fn(),
      saveConfigToDisk: jest.fn()
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath);
    } catch (_) {}
  });

  function getRouteHandler(method, path) {
    const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
    if (!layer) throw new Error(`Route not found: ${method} ${path}`);
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
  }

  test('GET /api/v1/gemini/config reports termsAccepted correctly', async () => {
    const handler = getRouteHandler('GET', '/api/v1/gemini/config');
    const req = {};
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      set: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      termsAccepted: false,
      hasApiKey: false,
      model: 'gemini-3.5-flash-lite'
    }));
  });

  test('POST /api/v1/gemini/config rejects enabling without terms acceptance', async () => {
    const handler = getRouteHandler('POST', '/api/v1/gemini/config');
    const req = {
      body: {
        geminiApiKey: 'test-key',
        geminiCoverMatchEnabled: true,
        geminiTermsAccepted: false
      }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      termsRequired: true
    }));
  });

  test('POST /api/v1/gemini/config succeeds when terms are accepted and saves model', async () => {
    const handler = getRouteHandler('POST', '/api/v1/gemini/config');
    const req = {
      body: {
        geminiApiKey: 'AIzaSyTestKey123',
        geminiModel: 'gemini-2.5-flash-lite',
        geminiCoverMatchEnabled: true,
        geminiTermsAccepted: true
      }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      termsAccepted: true,
      model: 'gemini-2.5-flash-lite'
    }));
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('geminiApiKey'),
      expect.any(Array)
    );
  });

  test('POST /api/v1/gemini/config validates geminiCoverDailyCap bounds and types', async () => {
    const handler = getRouteHandler('POST', '/api/v1/gemini/config');

    // Test invalid non-numeric string
    let res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ body: { geminiTermsAccepted: true, geminiCoverDailyCap: 'invalid' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('geminiCoverDailyCap') }));

    // Test invalid negative cap
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ body: { geminiTermsAccepted: true, geminiCoverDailyCap: -50 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Test invalid 0 cap
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ body: { geminiTermsAccepted: true, geminiCoverDailyCap: 0 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    // Test valid integer cap
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler({ body: { geminiTermsAccepted: true, geminiCoverDailyCap: 500 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(mockDbRun).toHaveBeenCalledWith(
      expect.stringContaining('geminiCoverDailyCap'),
      expect.any(Array)
    );
  });

  test('GET /api/v1/gemini/config retrieves hasApiKey: true when stored in database', async () => {
    mockDbGet.mockImplementation(async (query) => {
      if (query.includes('geminiApiKey')) {
        return { value: JSON.stringify('AIzaSyPersistedKey') };
      }
      if (query.includes('geminiTermsAccepted')) {
        return { value: 'true' };
      }
      return null;
    });

    const handler = getRouteHandler('GET', '/api/v1/gemini/config');
    const req = {};
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      set: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      termsAccepted: true,
      hasApiKey: true
    }));
  });

  test('GET /api/v1/gemini/models returns fallback Flash-Lite models when no key provided', async () => {
    const handler = getRouteHandler('GET', '/api/v1/gemini/models');
    const req = { query: {} };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      source: 'default',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'gemini-3.5-flash-lite' })
      ])
    }));
  });

  test('GET /api/v1/gemini/models filters only models containing Flash-Lite from Google API', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
          { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
          { name: 'models/gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash-Lite' },
          { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite' }
        ]
      })
    });

    try {
      const handler = getRouteHandler('GET', '/api/v1/gemini/models');
      const req = { query: { apiKey: 'AIzaSyLiveTestKey' } };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      };

      await handler(req, res);

      expect(res.json).toHaveBeenCalled();
      const callData = res.json.mock.calls[0][0];
      expect(callData.source).toBe('gemini-api');

      // Verify EVERY model in the result contains Flash-Lite
      expect(callData.models.length).toBeGreaterThan(0);
      callData.models.forEach(m => {
        const hasFlashLite = m.id.toLowerCase().includes('flash-lite') || m.displayName.toLowerCase().includes('flash-lite');
        expect(hasFlashLite).toBe(true);
      });

      // Verify Pro and non-lite models are excluded
      expect(callData.models.some(m => m.id === 'gemini-1.5-pro')).toBe(false);
      expect(callData.models.some(m => m.id === 'gemini-2.0-flash')).toBe(false);
      // Verify default 3.5 Flash-Lite is included
      expect(callData.models.some(m => m.id === 'gemini-3.5-flash-lite')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('POST /api/v1/gemini/config awaits readConfig() and persists geminiCoverMatchEnabled: false without losing existing config keys', async () => {
    fs.writeFileSync(testConfigPath, JSON.stringify({
      comicsLocation: '/custom/comics',
      geminiApiKey: 'AIzaSyExistingKey',
      geminiCoverMatchEnabled: true,
      geminiTermsAccepted: true
    }), 'utf8');

    const handler = getRouteHandler('POST', '/api/v1/gemini/config');
    const req = {
      body: {
        geminiCoverMatchEnabled: false
      }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    const savedDiskConfig = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
    expect(savedDiskConfig.comicsLocation).toBe('/custom/comics');
    expect(savedDiskConfig.geminiCoverMatchEnabled).toBe(false);
    expect(testConfig.geminiCoverMatchEnabled).toBe(false);
  });

  test('config store setGeminiCoverMatchEnabled mutates active config object after loadConfigFromDisk()', async () => {
    const configStore = require('../server/config/store');
    await configStore.loadConfigFromDisk();
    configStore.setGeminiCoverMatchEnabled(false, true);
    expect(configStore.getConfig().geminiCoverMatchEnabled).toBe(false);
    expect(configStore.getGeminiCoverMatchEnabled()).toBe(false);
  });

  test('Frontend: unchecking #ct-gemini-enabled-toggle immediately persists geminiCoverMatchEnabled: false to /api/v1/gemini/config', async () => {
    const path = require('path');
    const vm = require('vm');
    const { JSDOM } = require('jsdom');

    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div id="gemini-compliance-modal" class="hidden">
        <input id="gemini-modal-key-input" />
        <input type="checkbox" id="gemini-modal-agree-cb" />
        <button id="gemini-modal-save-btn"></button>
        <button id="gemini-modal-disagree-btn"></button>
      </div>
      <input type="checkbox" id="ct-gemini-enabled-toggle" checked />
      <input type="password" id="ct-gemini-key-input" />
      <button id="ct-gemini-key-toggle"></button>
      <select id="ct-gemini-model-select"><option value="gemini-3.5-flash-lite">3.5</option></select>
      <input type="number" id="ct-gemini-daily-cap" value="450" />
      <button id="ct-gemini-save-btn"></button>
    </body></html>`);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, enabled: true, termsAccepted: true, hasApiKey: true })
    });

    const sandbox = {
      window: dom.window,
      document: dom.window.document,
      fetch: fetchMock,
      console,
      setTimeout,
      clearTimeout,
      state: { API_BASE_URL: '' }
    };

    const geminiJs = fs.readFileSync(path.join(__dirname, '../public/js/comictagger/gemini.js'), 'utf8')
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/\bexport\s+/g, '');

    vm.createContext(sandbox);
    new vm.Script(geminiJs).runInContext(sandbox);
    sandbox.initGeminiComplianceModal();

    fetchMock.mockClear();

    const toggle = dom.window.document.getElementById('ct-gemini-enabled-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change'));

    await new Promise(r => setTimeout(r, 20));

    expect(sandbox.window._geminiState.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/gemini/config'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"geminiCoverMatchEnabled":false')
      })
    );
  });
});
