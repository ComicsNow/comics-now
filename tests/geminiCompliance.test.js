const fs = require('fs');
const express = require('express');
const attachGeminiRoutes = require('../server/routes/admin/gemini');

describe('Compliance & Config Endpoints', () => {
  let router;
  let testConfig;
  const testConfigPath = '/tmp/test-compliance-config.json';

  beforeEach(() => {
    testConfig = {
      geminiApiKey: '',
      geminiCoverMatchEnabled: false,
      geminiTermsAccepted: false
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig), 'utf8');

    router = express.Router();
    attachGeminiRoutes(router, {
      config: testConfig,
      paths: { CONFIG_FILE: testConfigPath },
      dbGet: jest.fn().mockResolvedValue(null),
      dbRun: jest.fn().mockResolvedValue({}),
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

  test('POST /api/v1/gemini/config succeeds when terms are accepted', async () => {
    const handler = getRouteHandler('POST', '/api/v1/gemini/config');
    const req = {
      body: {
        geminiApiKey: 'AIzaSyTestKey123',
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
      termsAccepted: true
    }));
  });
});
