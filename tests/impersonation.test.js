/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Impersonation Client', () => {
  let env;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Set up state and sandbox
    const state = {
      API_BASE_URL: 'http://localhost'
    };

    const sandbox = {
      window: {
        ...window,
        location: { reload: jest.fn() },
      },
      document: document,
      state: state,
      console: console,
      fetch: jest.fn(),
      alert: jest.fn(),
      encodeURIComponent: encodeURIComponent
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    // Read and parse script
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

    env = { sandbox, state };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sandbox initializes without crashing', () => {
    expect(typeof env.sandbox.startImpersonation).toBe('function');
    expect(typeof env.sandbox.stopImpersonation).toBe('function');
  });


  describe('startImpersonation', () => {
    test('success triggers window.location.reload', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ ok: true })
      });

      const result = await env.sandbox.startImpersonation('test-user-id', 'test@example.com');

      expect(result).toBe(true);
      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost/api/v1/admin/impersonate/test-user-id',
        expect.objectContaining({ method: 'POST' })
      );
      expect(env.sandbox.window.location.reload).toHaveBeenCalled();
      expect(env.sandbox.alert).not.toHaveBeenCalled();
    });

    test('failure via non-ok fetch response triggers alert', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: jest.fn().mockRejectedValue(new Error('Network error'))
      });

      const result = await env.sandbox.startImpersonation('test-user-id', 'test@example.com');

      expect(result).toBe(false);
      expect(env.sandbox.alert).toHaveBeenCalledWith('Could not start impersonation: Not Found');
      expect(env.sandbox.window.location.reload).not.toHaveBeenCalled();
    });

    test('failure via json payload with !ok triggers alert', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ ok: false, message: 'Invalid permission' })
      });

      const result = await env.sandbox.startImpersonation('test-user-id', 'test@example.com');

      expect(result).toBe(false);
      expect(env.sandbox.alert).toHaveBeenCalledWith('Could not start impersonation: Invalid permission');
      expect(env.sandbox.window.location.reload).not.toHaveBeenCalled();
    });
  });

  describe('stopImpersonation', () => {
    test('calls stop endpoint and reloads regardless of success', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({ ok: true });

      await env.sandbox.stopImpersonation();

      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost/api/v1/admin/impersonate/stop',
        expect.objectContaining({ method: 'POST' })
      );
      expect(env.sandbox.window.location.reload).toHaveBeenCalled();
    });

    test('reloads even if stop endpoint fails', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));

      await env.sandbox.stopImpersonation();

      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost/api/v1/admin/impersonate/stop',
        expect.objectContaining({ method: 'POST' })
      );
      expect(env.sandbox.window.location.reload).toHaveBeenCalled();
    });
  });

  describe('checkImpersonation and banner', () => {
    test('does nothing if user is not impersonating', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ impersonating: null })
      });

      // trigger DOMContentLoaded
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // wait for microtasks (fetch promise resolution)
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost/api/v1/user/me');
      expect(document.getElementById('impersonation-banner')).toBeNull();
    });

    test('renders banner and hooks up exit button if user is impersonating', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          impersonating: { targetEmail: 'target@example.com' }
        })
      });

      // trigger DOMContentLoaded
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // wait for microtasks (fetch promise resolution)
      await new Promise(resolve => setTimeout(resolve, 0));

      const banner = document.getElementById('impersonation-banner');
      expect(banner).not.toBeNull();
      expect(banner.textContent).toContain('Viewing as target@example.com');

      // padding should be set to nudge app content
      expect(document.body.style.paddingTop).not.toBe('');

      // Test exit button click
      const exitBtn = document.getElementById('impersonation-exit');
      expect(exitBtn).not.toBeNull();

      // Mock fetch for stopImpersonation before clicking
      env.sandbox.fetch.mockResolvedValueOnce({ ok: true });
      exitBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0)); // wait for stopImpersonation to finish

      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost/api/v1/admin/impersonate/stop',
        expect.objectContaining({ method: 'POST' })
      );
      expect(env.sandbox.window.location.reload).toHaveBeenCalled();
    });

    test('does not duplicate banner if already rendered', async () => {
      env.sandbox.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          impersonating: { targetEmail: 'target@example.com' }
        })
      });

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(resolve => setTimeout(resolve, 0));

      // Trigger again
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await new Promise(resolve => setTimeout(resolve, 0));

      const banners = document.querySelectorAll('#impersonation-banner');
      expect(banners.length).toBe(1);
    });
  });
});
