/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupEnvironment() {
  const state = {
    API_BASE_URL: 'http://localhost:3000'
  };

  const listeners = {};
  const mockDocument = {
    addEventListener: (event, cb) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    getElementById: jest.fn((id) => {
      if (id === 'impersonation-banner') return document.getElementById('impersonation-banner');
      return null;
    }),
    createElement: document.createElement.bind(document),
    body: {
      prepend: jest.fn((el) => {
        document.body.prepend(el);
      }),
      style: {
        paddingTop: ''
      },
      querySelector: document.querySelector.bind(document)
    }
  };

  const sandbox = {
    window: {
      location: {
        reload: jest.fn()
      }
    },
    document: mockDocument,
    state: state,
    console: console,
    fetch: jest.fn(),
    alert: jest.fn(),
    encodeURIComponent: global.encodeURIComponent,
    triggerDOMContentLoaded: () => {
      if (listeners['DOMContentLoaded']) {
        listeners['DOMContentLoaded'].forEach(cb => cb());
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const fullPath = path.resolve(__dirname, '../public/js/impersonation.js');
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

  return { sandbox, state };
}

describe('Impersonation Client', () => {
  let env;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = ''; // reset the actual jsdom body
    env = setupEnvironment();
  });

  describe('startImpersonation', () => {
    test('successful impersonation calls fetch and reloads', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      const result = await env.sandbox.startImpersonation('test-user-id', 'test@example.com');

      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/impersonate/test-user-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      expect(result).toBe(true);
      expect(env.sandbox.window.location.reload).toHaveBeenCalledTimes(1);
      expect(env.sandbox.alert).not.toHaveBeenCalled();
    });

    test('failed impersonation alerts error and does not reload', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ ok: false, message: 'You are not an admin' })
      });

      const result = await env.sandbox.startImpersonation('test-user-id', 'test@example.com');

      expect(env.sandbox.fetch).toHaveBeenCalled();
      expect(result).toBe(false);
      expect(env.sandbox.window.location.reload).not.toHaveBeenCalled();
      expect(env.sandbox.alert).toHaveBeenCalledWith('Could not start impersonation: You are not an admin');
    });

    test('failed impersonation network error propagates since fetch rejection is unhandled', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(env.sandbox.startImpersonation('test-user-id', 'test@example.com')).rejects.toThrow('Network error');

      expect(env.sandbox.window.location.reload).not.toHaveBeenCalled();
      expect(env.sandbox.alert).not.toHaveBeenCalled();
    });
  });

  describe('stopImpersonation', () => {
    test('calls stop api and reloads', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({ ok: true });

      await env.sandbox.stopImpersonation();

      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/impersonate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      expect(env.sandbox.window.location.reload).toHaveBeenCalledTimes(1);
    });

    test('reloads even if stop api fails', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));

      await env.sandbox.stopImpersonation();

      expect(env.sandbox.fetch).toHaveBeenCalled();
      expect(env.sandbox.window.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkImpersonation and renderBanner', () => {
    test('renders banner when user is impersonating someone', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impersonating: { targetEmail: 'impersonated@example.com' }
        })
      });

      env.sandbox.triggerDOMContentLoaded();
      // wait for promises to resolve
      await new Promise(process.nextTick);

      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/user/me');

      const banner = document.getElementById('impersonation-banner');
      expect(banner).not.toBeNull();
      expect(banner.innerHTML).toContain('Viewing as <strong>impersonated@example.com</strong> (read-only)');
      expect(env.sandbox.document.body.style.paddingTop).not.toBe('');

      // test exit button functionality
      const exitBtn = banner.querySelector('#impersonation-exit');
      env.sandbox.fetch.mockClear();
      env.sandbox.fetch.mockResolvedValueOnce({ ok: true });
      exitBtn.click();
      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/impersonate/stop', expect.any(Object));
      // Need a tick for the reload to be called since stopImpersonation is async and we just clicked
      await new Promise(process.nextTick);
      expect(env.sandbox.window.location.reload).toHaveBeenCalledTimes(1);
    });

    test('does not render banner if not impersonating', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'admin@example.com'
        }) // no impersonating field
      });

      env.sandbox.triggerDOMContentLoaded();
      await new Promise(process.nextTick);

      const banner = document.getElementById('impersonation-banner');
      expect(banner).toBeNull();
    });

    test('does not render banner on fetch error', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network offline'));

      env.sandbox.triggerDOMContentLoaded();
      await new Promise(process.nextTick);

      const banner = document.getElementById('impersonation-banner');
      expect(banner).toBeNull();
    });
  });
});
