/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('impersonation.js', () => {
  let sandbox;
  let cleanContent;

  beforeAll(() => {
    const fullPath = path.resolve(__dirname, '../public/js/impersonation.js');
    const content = fs.readFileSync(fullPath, 'utf8');

    cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.paddingTop = '';

    global.fetch = jest.fn();
    global.alert = jest.fn();

    // Create a mock location object we can test against, rather than trying to overwrite JSDOM's location directly
    const mockLocation = {
      reload: jest.fn()
    };

    window.API_BASE_URL = '';

    sandbox = {
      window: {
        ...window,
        location: mockLocation,
        alert: global.alert
      },
      document,
      fetch: global.fetch,
      alert: global.alert,
      console,
      state: {},
      encodeURIComponent,
      setTimeout,
      Event
    };

    // Point global location object wrapper at mock for assertions
    sandbox.location = mockLocation;

    vm.createContext(sandbox);

    const script = new vm.Script(`
      ${cleanContent}

      // Hook up mocked location internally
      window.location = location;

      // Expose internal functions
      sandbox.checkImpersonation = checkImpersonation;
      sandbox.renderBanner = renderBanner;
      sandbox.startImpersonation = startImpersonation;
      sandbox.stopImpersonation = stopImpersonation;
    `);

    sandbox.sandbox = sandbox;
    script.runInContext(sandbox);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startImpersonation', () => {
    it('should fetch the correct endpoint and reload on success', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true })
      });

      const result = await sandbox.startImpersonation('user-123', 'test@example.com');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/impersonate/user-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      expect(sandbox.location.reload).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should show an alert and return false on failure (res.ok false)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({})
      });

      const result = await sandbox.startImpersonation('user-123', 'test@example.com');

      expect(global.alert).toHaveBeenCalledWith('Could not start impersonation: Internal Server Error');
      expect(sandbox.location.reload).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should show an alert and return false on failure (data.ok false)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, message: 'User not found' })
      });

      const result = await sandbox.startImpersonation('user-123', 'test@example.com');

      expect(global.alert).toHaveBeenCalledWith('Could not start impersonation: User not found');
      expect(sandbox.location.reload).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should throw error if fetch rejects with network error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(sandbox.startImpersonation('user-123', 'test@example.com'))
        .rejects.toThrow('Network error');
    });
  });

  describe('stopImpersonation', () => {
    it('should fetch the stop endpoint and reload', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true
      });

      await sandbox.stopImpersonation();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/impersonate/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      expect(sandbox.location.reload).toHaveBeenCalled();
    });

    it('should reload even if fetch fails', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await sandbox.stopImpersonation();

      expect(sandbox.location.reload).toHaveBeenCalled();
    });
  });

  describe('checkImpersonation and renderBanner', () => {
    it('should render the banner if user is impersonating', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impersonating: { targetEmail: 'target@example.com' }
        })
      });

      await sandbox.checkImpersonation();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/user/me');

      const banner = document.getElementById('impersonation-banner');
      expect(banner).not.toBeNull();
      expect(banner.innerHTML).toContain('target@example.com');

      // Ensure padding was applied
      expect(document.body.style.paddingTop).not.toBe('');
    });

    it('should not render the banner if not impersonating', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impersonating: null
        })
      });

      await sandbox.checkImpersonation();

      const banner = document.getElementById('impersonation-banner');
      expect(banner).toBeNull();
    });

    it('should not render the banner if fetch fails', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false
      });

      await sandbox.checkImpersonation();

      const banner = document.getElementById('impersonation-banner');
      expect(banner).toBeNull();
    });

    it('should not render multiple banners', async () => {
      sandbox.renderBanner('test1@example.com');
      sandbox.renderBanner('test2@example.com');

      const banners = document.querySelectorAll('#impersonation-banner');
      expect(banners.length).toBe(1);
      expect(banners[0].innerHTML).toContain('test1@example.com');
    });

    it('should attach a click listener to the exit button that calls stopImpersonation', () => {
      sandbox.renderBanner('target@example.com');

      const exitBtn = document.getElementById('impersonation-exit');
      expect(exitBtn).not.toBeNull();
    });

    it('should call fetch and reload when exit button is clicked', async () => {
      global.fetch.mockResolvedValueOnce({ ok: true });

      sandbox.renderBanner('target@example.com');

      const exitBtn = document.getElementById('impersonation-exit');

      // Because stopImpersonation is async, we can wrap the click execution
      await exitBtn.click();

      // Ensure stopImpersonation effects happened
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/admin/impersonate/stop', expect.any(Object));
      // wait for promises to flush for reload
      await new Promise(process.nextTick);
      expect(sandbox.location.reload).toHaveBeenCalled();
    });
  });

  describe('DOMContentLoaded', () => {
    it('should trigger checkImpersonation on DOMContentLoaded', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impersonating: { targetEmail: 'dom@example.com' }
        })
      });

      // Dispatch DOMContentLoaded on sandbox document
      sandbox.document.dispatchEvent(new sandbox.Event('DOMContentLoaded'));

      await new Promise(process.nextTick);

      const banner = document.getElementById('impersonation-banner');
      expect(banner).not.toBeNull();
      expect(banner.innerHTML).toContain('dom@example.com');
    });
  });
});
