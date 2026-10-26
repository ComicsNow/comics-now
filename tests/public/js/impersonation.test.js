const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setupTestEnvironment() {
  const state = { API_BASE_URL: 'http://localhost:3000' };

  // Define mock window and document
  const mockButton = {
    addEventListener: jest.fn()
  };

  const mockBanner = {
    id: '',
    className: '',
    innerHTML: '',
    querySelector: jest.fn().mockReturnValue(mockButton),
    offsetHeight: 50
  };

  const document = {
    addEventListener: jest.fn((event, callback) => {
      if (event === 'DOMContentLoaded') {
        sandbox.triggerDOMContentLoaded = callback;
      }
    }),
    getElementById: jest.fn().mockReturnValue(null), // no banner exists initially
    createElement: jest.fn().mockReturnValue(mockBanner),
    body: {
      prepend: jest.fn(),
      style: {}
    }
  };

  const window = {
    location: {
      reload: jest.fn()
    },
    API_BASE_URL: 'http://localhost:3000'
  };

  const sandbox = {
    window,
    document,
    state,
    console,
    fetch: jest.fn(),
    alert: jest.fn(),
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    mockBanner,
    mockButton
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, '../../..', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Strip ES6 modules imports/exports
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

  return { sandbox, loadFile, state, window, document };
}

describe('Impersonation', () => {
  let env;

  beforeEach(() => {
    env = setupTestEnvironment();
    env.loadFile('public/js/impersonation.js');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should expose functions on state and window', () => {
    expect(env.state.startImpersonation).toBeDefined();
    expect(env.window.startImpersonation).toBeDefined();
    expect(env.window.stopImpersonation).toBeDefined();
  });

  describe('startImpersonation', () => {
    it('should successfully start impersonation and reload', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      const result = await env.sandbox.startImpersonation('user123', 'user@example.com');

      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/admin/impersonate/user123',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      expect(result).toBe(true);
      expect(env.window.location.reload).toHaveBeenCalled();
    });

    it('should show alert and return false if impersonation fails', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ ok: false, message: 'Not authorized' })
      });

      const result = await env.sandbox.startImpersonation('user123', 'user@example.com');

      expect(env.sandbox.alert).toHaveBeenCalledWith('Could not start impersonation: Not authorized');
      expect(result).toBe(false);
      expect(env.window.location.reload).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully and throw (since no try/catch)', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(env.sandbox.startImpersonation('user123', 'user@example.com')).rejects.toThrow('Network error');
    });
  });

  describe('stopImpersonation', () => {
    it('should call stop endpoint and reload', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({ ok: true });
      await env.sandbox.stopImpersonation();

      expect(env.sandbox.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/admin/impersonate/stop',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
      expect(env.window.location.reload).toHaveBeenCalled();
    });

    it('should reload even if fetch fails', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));
      await env.sandbox.stopImpersonation();

      expect(env.window.location.reload).toHaveBeenCalled();
    });
  });

  describe('checkImpersonation (DOMContentLoaded)', () => {
    it('should render banner if user is being impersonated', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ impersonating: { targetEmail: 'test@example.com' } })
      });

      await env.sandbox.triggerDOMContentLoaded();

      expect(env.sandbox.fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/user/me');

      // Document should be queried for existing banner
      expect(env.document.getElementById).toHaveBeenCalledWith('impersonation-banner');

      // New banner should be created
      expect(env.document.createElement).toHaveBeenCalledWith('div');

      // Banner props set
      expect(env.sandbox.mockBanner.id).toBe('impersonation-banner');
      expect(env.sandbox.mockBanner.innerHTML).toContain('test@example.com');

      // Appended to body
      expect(env.document.body.prepend).toHaveBeenCalledWith(env.sandbox.mockBanner);

      // Event listener added to exit button
      expect(env.sandbox.mockBanner.querySelector).toHaveBeenCalledWith('#impersonation-exit');
      expect(env.sandbox.mockButton.addEventListener).toHaveBeenCalledWith('click', env.sandbox.stopImpersonation);
    });

    it('should not render banner if user is not being impersonated', async () => {
      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      });

      await env.sandbox.triggerDOMContentLoaded();

      expect(env.document.createElement).not.toHaveBeenCalled();
    });

    it('should not render banner if already exists', async () => {
      env.document.getElementById.mockReturnValueOnce(true); // banner exists

      env.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ impersonating: { targetEmail: 'test@example.com' } })
      });

      await env.sandbox.triggerDOMContentLoaded();

      expect(env.document.createElement).not.toHaveBeenCalled();
    });

    it('should silently handle fetch errors', async () => {
      env.sandbox.fetch.mockRejectedValueOnce(new Error('Network error'));

      await env.sandbox.triggerDOMContentLoaded();

      expect(env.document.createElement).not.toHaveBeenCalled();
    });
  });
});
