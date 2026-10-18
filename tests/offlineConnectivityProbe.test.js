/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupEnvironment(initialOnline = true) {
  let onLineStatus = initialOnline;

  Object.defineProperty(navigator, 'onLine', {
    get: () => onLineStatus,
    configurable: true
  });

  document.body.className = '';
  document.body.innerHTML = '<div id="offline-indicator" class="hidden">Offline</div>';

  const state = {
    API_BASE_URL: '',
    db: null
  };

  const sandbox = {
    window,
    document,
    navigator,
    state,
    console,
    fetch: jest.fn(),
    Event,
    AbortController: global.AbortController,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    Date: global.Date
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../public/js/offline/status.js');
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

  return {
    sandbox,
    setOnline: status => { onLineStatus = status; }
  };
}

describe('PWA Offline False-Positive Resilience & Connectivity Probe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('checkServerConnectivity self-heals when navigator.onLine is false but server responds', async () => {
    const env = setupEnvironment(false); // Simulate Android false offline
    const indicator = document.getElementById('offline-indicator');
    document.body.classList.add('is-offline');
    indicator.classList.remove('hidden');

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', timestamp: Date.now() })
    });

    const onlineListener = jest.fn();
    window.addEventListener('online', onlineListener);

    expect(typeof env.sandbox.checkServerConnectivity).toBe('function');
    const result = await env.sandbox.checkServerConnectivity();

    expect(result).toBe(true);
    expect(env.sandbox.isAppOnline()).toBe(true);
    expect(document.body.classList.contains('is-offline')).toBe(false);
    expect(indicator.classList.contains('hidden')).toBe(true);
    expect(onlineListener).toHaveBeenCalled();
  });

  test('checkServerConnectivity confirms offline when fetch fails and navigator is offline', async () => {
    const env = setupEnvironment(false);
    const indicator = document.getElementById('offline-indicator');

    env.sandbox.fetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = await env.sandbox.checkServerConnectivity();

    expect(result).toBe(false);
    expect(env.sandbox.isAppOnline()).toBe(false);
    expect(document.body.classList.contains('is-offline')).toBe(true);
    expect(indicator.classList.contains('hidden')).toBe(false);
  });

  test('updateOfflineIndicator gives grace period to probe when navigator.onLine is false but lastKnown was online', async () => {
    const env = setupEnvironment(false);
    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' })
    });

    expect(typeof env.sandbox.setLastKnownOnlineState).toBe('function');
    env.sandbox.setLastKnownOnlineState(true);

    const isOffline = env.sandbox.updateOfflineIndicator();
    expect(isOffline).toBe(false);
    expect(document.body.classList.contains('is-offline')).toBe(false);
  });
});
