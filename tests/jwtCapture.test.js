/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {};

  const sandbox = {
    window: window,
    document: {
      ...document,
      cookie: ''
    },
    state: state,
    console: console,
    setInterval: setInterval,
    clearInterval: clearInterval,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    const script = new vm.Script(cleanContent);
    script.runInContext(sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('jwt-capture.js', () => {
  let env;

  beforeEach(() => {
    env = createModuleSandbox();

    jest.useFakeTimers();

    env.loadFile('../public/js/jwt-capture.js');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('extractCFToken', () => {
    test('returns null if no CF_Authorization cookie exists', () => {
      env.sandbox.document.cookie = 'other_cookie=value123; another=test';
      const result = env.sandbox.extractCFToken();
      expect(result).toBeNull();
    });

    test('returns the token when CF_Authorization cookie exists', () => {
      env.sandbox.document.cookie = 'some=value; CF_Authorization=my-test-token; other=123';
      const result = env.sandbox.extractCFToken();
      expect(result).toBe('my-test-token');
    });

    test('decodes URI components in the token', () => {
      env.sandbox.document.cookie = 'CF_Authorization=encoded%20token%2Btest';
      const result = env.sandbox.extractCFToken();
      expect(result).toBe('encoded token+test');
    });

    test('returns null on error', () => {
      // Cause an error by making cookie split fail
      const origCookie = env.sandbox.document.cookie;
      env.sandbox.document.cookie = null;

      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = env.sandbox.extractCFToken();

      expect(result).toBeNull();
      expect(spy).toHaveBeenCalled();

      env.sandbox.document.cookie = origCookie;
      spy.mockRestore();
    });
  });

  describe('captureCFToken', () => {
    test('returns false if no token is extracted', async () => {
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(false);
    });

    test('returns false if global.saveJWTToken is not a function', async () => {
      env.sandbox.document.cookie = 'CF_Authorization=test-token';
      // global.saveJWTToken is undefined by default
      const result = await env.sandbox.captureCFToken();
      expect(result).toBe(false);
    });

    test('calls global.saveJWTToken and returns true if token exists and function is available', async () => {
      env.sandbox.document.cookie = 'CF_Authorization=test-token';
      const mockSaveJWTToken = jest.fn().mockResolvedValue();
      env.state.saveJWTToken = mockSaveJWTToken;

      const result = await env.sandbox.captureCFToken();

      expect(result).toBe(true);
      expect(mockSaveJWTToken).toHaveBeenCalledWith('test-token');
    });

    test('returns false on error in capture process', async () => {
      env.sandbox.document.cookie = 'CF_Authorization=test-token';
      const mockSaveJWTToken = jest.fn().mockRejectedValue(new Error('Save failed'));
      env.state.saveJWTToken = mockSaveJWTToken;

      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await env.sandbox.captureCFToken();

      expect(result).toBe(false);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('initializeJWTCapture', () => {
    test('captures token immediately and sets up interval', async () => {
      env.sandbox.document.cookie = 'CF_Authorization=initial-token';
      let resolveMock;
      const promiseMock = new Promise(resolve => { resolveMock = resolve; });

      // Keep track of calls so we can resolve when it's called twice
      let callCount = 0;
      const mockSaveJWTToken = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          resolveMock();
        }
        return Promise.resolve();
      });
      env.state.saveJWTToken = mockSaveJWTToken;

      await env.sandbox.initializeJWTCapture(1000);

      // Should be called immediately
      expect(mockSaveJWTToken).toHaveBeenCalledTimes(1);
      expect(mockSaveJWTToken).toHaveBeenCalledWith('initial-token');

      // Change cookie for interval test
      env.sandbox.document.cookie = 'CF_Authorization=interval-token';

      jest.advanceTimersByTime(1000);

      // Wait for the mock to be called twice
      await promiseMock;

      expect(mockSaveJWTToken).toHaveBeenCalledTimes(2);
      expect(mockSaveJWTToken).toHaveBeenLastCalledWith('interval-token');

      expect(env.state._jwtCaptureIntervalId).toBeDefined();
    });
  });

  describe('stopJWTCapture', () => {
    test('clears the interval and sets id to null', async () => {
      await env.sandbox.initializeJWTCapture(1000);
      expect(env.state._jwtCaptureIntervalId).toBeDefined();

      env.sandbox.stopJWTCapture();

      expect(env.state._jwtCaptureIntervalId).toBeNull();
      // Fast forward to ensure interval is cleared (no more calls should happen)
      const mockSaveJWTToken = jest.fn().mockResolvedValue();
      env.state.saveJWTToken = mockSaveJWTToken;

      jest.advanceTimersByTime(2000);
      expect(mockSaveJWTToken).not.toHaveBeenCalled();
    });

    test('does nothing if interval id is falsy', () => {
      env.state._jwtCaptureIntervalId = null;
      env.sandbox.stopJWTCapture();
      expect(env.state._jwtCaptureIntervalId).toBeNull();
    });
  });
});
