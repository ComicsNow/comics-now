
/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('events.js UI interactions and API integrations', () => {
  let sandbox;
  let triggerScan;
  const mockFetch = jest.fn();
  const mockConfirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    mockConfirm.mockReturnValue(true);

    document.body.innerHTML = `
      <form id="metadata-form"></form>
      <div id="save-status"></div>
      <div id="ct-modal" class="hidden"></div>
      <div id="settings-modal" class="hidden"></div>
      <div id="mgmt-confirm-modal" class="hidden"></div>
      <div id="gemini-compliance-modal" class="hidden"></div>
      <div id="directory-selection-modal" class="hidden"></div>
      <div id="add-to-list-modal" class="hidden"></div>
      <div id="reading-list-modal" class="hidden"></div>

      <button id="mgmt-confirm-cancel-btn"></button>
      <button id="gemini-compliance-disagree-btn"></button>
      <button id="directory-cancel-btn"></button>
      <button id="add-to-list-cancel-btn"></button>
      <button id="reading-list-close-btn"></button>

      <div id="metadata-content"></div>
      <div id="metadata-tab"></div>
      <button type="submit" id="submit-btn"></button>
      <div id="other-element"></div>
    `;

    window.APP_CONFIG = { baseUrl: 'http://localhost' };

    // Load globals.js
    const globalsPath = path.resolve(__dirname, '..', 'public', 'js', 'globals.js');
    let globalsCode = fs.readFileSync(globalsPath, 'utf8');
    // Replace export keywords correctly
    globalsCode = globalsCode.replace(/export\s+(async\s+)?(function|const|let|var|class)\s+/g, '$1$2 ');
    globalsCode = globalsCode.replace(/export\s+\{[^}]*\};?/g, '');
    globalsCode = globalsCode.replace(/const state = /g, 'var state = ');
    globalsCode += `\nsandbox.state = state;\n`;

    // Load events.js
    const eventsPath = path.resolve(__dirname, '..', 'public', 'js', 'events.js');
    let eventsCode = fs.readFileSync(eventsPath, 'utf8');
    eventsCode = eventsCode.replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g, '');
    eventsCode = eventsCode.replace(/export\s+(async\s+)?(function|const|let|var|class)\s+/g, '$1$2 ');

    // Inject export references for testing
    eventsCode += `\nsandbox.triggerScan = triggerScan;\n`;

    sandbox = {
      window,
      document,
      console: { ...console, log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      fetch: mockFetch,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      confirm: mockConfirm,
      FormData: window.FormData,
      URL: window.URL,
      encodeURIComponent: window.encodeURIComponent,
      TextEncoder: require('util').TextEncoder,
      btoa: (str) => Buffer.from(str).toString('base64')
    };
    sandbox.globalThis = sandbox;
    sandbox.sandbox = sandbox; // allow code to write to sandbox

    const context = vm.createContext(sandbox);
    new vm.Script(globalsCode).runInContext(context);

    // Setup state before events.js runs
    sandbox.state.currentComic = { id: 'comic1', path: '/test/comic.cbz', name: 'Test Comic' };
    sandbox.state.currentMetadata = {};
    sandbox.state.metadataHasUnsavedChanges = false;
    sandbox.state.closeSettingsModal = jest.fn();
    // Re-assign baseUrl manually since globals.js might override if APP_CONFIG wasn't available soon enough
    sandbox.state.API_BASE_URL = 'http://localhost';

    new vm.Script(eventsCode).runInContext(context);

    triggerScan = sandbox.triggerScan;
  });

  describe('triggerScan', () => {
    it('should call fetch with POST to /api/v1/scan', async () => {
      await triggerScan();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/scan', { method: 'POST' });
    });

    it('should include full scan body if full parameter is true', async () => {
      await triggerScan(null, true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost/api/v1/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full: true })
      });
    });

    it('should disable and re-enable the button if provided', async () => {
      const button = document.createElement('button');
      const scanPromise = triggerScan(button);
      expect(button.disabled).toBe(true);
      await scanPromise;
      expect(button.disabled).toBe(false);
    });

    it('should re-enable the button even if fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const button = document.createElement('button');
      await expect(triggerScan(button)).rejects.toThrow('Network error');
      expect(button.disabled).toBe(false);
    });
  });

  describe('metadataForm submission', () => {
    it('should clear unsaved changes and call fetch to save metadata', async () => {
      sandbox.state.metadataHasUnsavedChanges = true;
      const form = document.getElementById('metadata-form');

      const input = document.createElement('input');
      input.name = 'Title';
      input.value = 'New Title';
      form.appendChild(input);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      // Manually dispatch submit event
      const event = new window.Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      // Give event loop time to process async submit handler
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sandbox.state.metadataHasUnsavedChanges).toBe(false);

      // Should have called the API to save
      expect(mockFetch).toHaveBeenCalled();
      const saveCall = mockFetch.mock.calls.find(call => call[1] && call[1].method === 'POST');
      expect(saveCall).toBeDefined();
      expect(saveCall[0]).toContain('/api/v1/comics/info');
      expect(JSON.parse(saveCall[1].body).Title).toBe('New Title');
    });

    it('should restore unsaved changes flag if save fails', async () => {
      const form = document.getElementById('metadata-form');

      mockFetch.mockRejectedValueOnce(new Error('Save failed'));

      // Dispatch event
      const event = new window.Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(sandbox.state.metadataHasUnsavedChanges).toBe(true);
      const statusDiv = document.getElementById('save-status');
      expect(statusDiv.textContent).toContain('Save failed');
    });
  });

  describe('Global unsaved changes click interceptor', () => {
    it('should prompt confirm if unsaved changes exist and clicked outside metadata UI', () => {
      sandbox.state.metadataHasUnsavedChanges = true;
      mockConfirm.mockReturnValueOnce(false); // Cancel click

      const otherEl = document.getElementById('other-element');
      const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });

      // Use Jest mock to spy on preventDefault
      clickEvent.preventDefault = jest.fn();
      clickEvent.stopPropagation = jest.fn();

      otherEl.dispatchEvent(clickEvent);

      expect(mockConfirm).toHaveBeenCalled();
      expect(clickEvent.preventDefault).toHaveBeenCalled();
      expect(clickEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should clear unsaved changes if confirm is accepted', () => {
      sandbox.state.metadataHasUnsavedChanges = true;
      mockConfirm.mockReturnValueOnce(true); // Proceed

      const otherEl = document.getElementById('other-element');
      const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      clickEvent.preventDefault = jest.fn();

      otherEl.dispatchEvent(clickEvent);

      expect(mockConfirm).toHaveBeenCalled();
      expect(clickEvent.preventDefault).not.toHaveBeenCalled();
      expect(sandbox.state.metadataHasUnsavedChanges).toBe(false);
    });

    it('should not prompt if click is inside metadata UI', () => {
      sandbox.state.metadataHasUnsavedChanges = true;

      const metadataContent = document.getElementById('metadata-content');
      const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      metadataContent.dispatchEvent(clickEvent);

      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Modal dismissal via Escape key', () => {
    it('should trigger cancel button click on visible confirm modal', () => {
      const modal = document.getElementById('mgmt-confirm-modal');
      const cancelBtn = document.getElementById('mgmt-confirm-cancel-btn');

      modal.classList.remove('hidden'); // make visible

      const btnClickSpy = jest.spyOn(cancelBtn, 'click');

      const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);

      expect(btnClickSpy).toHaveBeenCalled();
    });

    it('should trigger state.closeSettingsModal for visible settings modal', () => {
      const modal = document.getElementById('settings-modal');

      modal.classList.remove('hidden'); // make visible

      const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);

      expect(sandbox.state.closeSettingsModal).toHaveBeenCalled();
    });

    it('should ignore other keys', () => {
      const modal = document.getElementById('mgmt-confirm-modal');
      const cancelBtn = document.getElementById('mgmt-confirm-cancel-btn');

      modal.classList.remove('hidden');

      const btnClickSpy = jest.spyOn(cancelBtn, 'click');

      const enterEvent = new window.KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      expect(btnClickSpy).not.toHaveBeenCalled();
    });
  });
});
