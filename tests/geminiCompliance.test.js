const fs = require('fs');
const express = require('express');
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
});
