/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupEnvironment() {
  // Mock the state object that would normally be imported from globals.js
  const state = {
    saveJWTToken: jest.fn().mockResolvedValue(true)
  };

  let cookieValue = '';

  Object.defineProperty(document, 'cookie', {
    get: () => {
      if (cookieValue === 'THROW') throw new Error('Cookie access error');
      return cookieValue;
    },
    set: (val) => { cookieValue = val; },
    configurable: true
  });

  const sandbox = {
    window,
    document,
    state,
    console: {
      ...console,
      error: jest.fn()
    },
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: jest.fn().mockReturnValue(12345),
    clearInterval: jest.fn(),
    decodeURIComponent: global.decodeURIComponent
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../public/js/jwt-capture.js');
  const content = fs.readFileSync(fullPath, 'utf8');

  // Strip out ES6 module syntax for execution in Node VM context.
  // This matches the established pattern for frontend modules in this repository (e.g., offlineConnectivityProbe.test.js).
  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);

  return {
    sandbox,
    setCookie: (val) => { cookieValue = val; }
  };
}

describe('JWT Capture Module', () => {
  let env;

  beforeEach(() => {
    env = setupEnvironment();
    jest.clearAllMocks();
  });

  describe('extractCFToken', () => {
    test('extracts token when CF_Authorization cookie exists', () => {
      env.setCookie('other=123; CF_Authorization=test_token_123; another=456');
      const token = env.sandbox.extractCFToken();
      expect(token).toBe('test_token_123');
    });

    test('decodes URI component in token', () => {
      env.setCookie('CF_Authorization=test%20token%21');
      const token = env.sandbox.extractCFToken();
      expect(token).toBe('test token!');
    });

    test('returns null when CF_Authorization cookie does not exist', () => {
      env.setCookie('other=123; another=456');
      const token = env.sandbox.extractCFToken();
      expect(token).toBeNull();
    });

    test('returns null when there are no cookies', () => {
      env.setCookie('');
      const token = env.sandbox.extractCFToken();
      expect(token).toBeNull();
    });

    test('returns null and logs error when cookie access throws', () => {
      env.setCookie('THROW');
      const token = env.sandbox.extractCFToken();
      expect(token).toBeNull();
      expect(env.sandbox.console.error).toHaveBeenCalledWith(
        '[JWT CAPTURE] Error extracting token:',
        expect.any(Error)
      );
    });
  });

  describe('captureCFToken', () => {
    test('calls saveJWTToken and returns true if token is found', async () => {
      env.setCookie('CF_Authorization=test_token');
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(true);
      expect(env.sandbox.state.saveJWTToken).toHaveBeenCalledWith('test_token');
    });

    test('returns false if no token is found', async () => {
      env.setCookie('');
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(false);
      expect(env.sandbox.state.saveJWTToken).not.toHaveBeenCalled();
    });

    test('returns false if global.saveJWTToken is not a function', async () => {
      env.setCookie('CF_Authorization=test_token');
      env.sandbox.state.saveJWTToken = null; // Removing the function
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(false);
    });

    test('returns false and logs error on exception', async () => {
      env.setCookie('THROW');
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(false);
      expect(env.sandbox.console.error).toHaveBeenCalled();
    });
  });

  describe('initializeJWTCapture', () => {
    test('captures immediately and sets up interval', async () => {
      env.setCookie('CF_Authorization=test_token');
      await env.sandbox.initializeJWTCapture(1000);

      expect(env.sandbox.state.saveJWTToken).toHaveBeenCalledWith('test_token');
      expect(env.sandbox.setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(env.sandbox.state._jwtCaptureIntervalId).toBe(12345);
    });

    test('uses default interval of 30 minutes if not provided', async () => {
      await env.sandbox.initializeJWTCapture();
      expect(env.sandbox.setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
    });
  });

  describe('stopJWTCapture', () => {
    test('clears interval if interval ID exists', async () => {
      env.sandbox.state._jwtCaptureIntervalId = 999;
      env.sandbox.stopJWTCapture();

      expect(env.sandbox.clearInterval).toHaveBeenCalledWith(999);
      expect(env.sandbox.state._jwtCaptureIntervalId).toBeNull();
    });

    test('does nothing if interval ID does not exist', () => {
      env.sandbox.state._jwtCaptureIntervalId = null;
      env.sandbox.stopJWTCapture();

      expect(env.sandbox.clearInterval).not.toHaveBeenCalled();
    });
  });
});
