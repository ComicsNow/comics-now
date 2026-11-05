/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSettingsSandbox() {
  const state = {
    API_BASE_URL: 'http://localhost:3000',
    router: { navigate: jest.fn() }
  };

  const modalEl = document.createElement('div');
  modalEl.id = 'settings-modal';
  modalEl.classList.add('hidden');

  const listEl = document.createElement('div');
  listEl.id = 'library-folders-list';

  const scanIntervalInput = document.createElement('input');
  scanIntervalInput.id = 'scan-interval';

  // jsdom persists document.body across tests in this file.
  for (const id of ['page-cache-max-input', 'page-cache-usage']) {
    document.getElementById(id)?.remove();
  }
  const pageCacheInput = document.createElement('input');
  pageCacheInput.id = 'page-cache-max-input';
  document.body.appendChild(pageCacheInput);
  const pageCacheUsage = document.createElement('p');
  pageCacheUsage.id = 'page-cache-usage';
  document.body.appendChild(pageCacheUsage);

  const statusDiv = document.createElement('div');
  statusDiv.id = 'settings-status';

  const sandbox = {
    window: window,
    document: document,
    Element: window.Element,
    state: state,
    console: console,
    jest: jest,
    fetch: jest.fn(),
    confirm: jest.fn(() => true),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    clearInterval: clearInterval
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  function loadFile(relPath) {
    const fullPath = path.resolve('/opt/comics-now', relPath);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+class\s+/g, 'class ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+/g, '')
      .replace(/const\s+global\s*=/g, 'var global =')
      .replace(/const\s+clear\s*=/g, 'var clear =')
      .replace(/const\s+renderContent\s*=/g, 'var renderContent =')
      .replace(/const\s+safeHtml\s*=/g, 'var safeHtml =')
      .replace(/const\s+safeRaw\s*=/g, 'var safeRaw =');
    vm.runInContext(content, sandbox);
  }

  // Load template engine
  loadFile('public/js/ui/template.js');

  // Load mock globals into sandbox
  vm.runInContext(`
    var settingsModal = document.getElementById('settings-modal') || document.createElement('div');
    var settingsTabDevices = document.createElement('div');
    var settingsForm = document.createElement('form');
    var scanIntervalInput = document.createElement('input');
    var settingsStatusDiv = document.createElement('div');
    var scanButton = document.createElement('button');
    var fullScanButton = document.createElement('button');
    var logsContainer = document.createElement('div');
    var getRelativePath = () => '/';
    var clearElement = (el) => { if (el) el.innerHTML = ''; };
    var triggerScan = jest.fn();
    var canonicalGlobal = state;
  `, sandbox);

  return { sandbox, state, loadFile };
}

describe('public/js/settings.js', () => {
  let ctx;

  beforeEach(() => {
    ctx = createSettingsSandbox();
    ctx.loadFile('public/js/settings/libraries.js');
    ctx.loadFile('public/js/settings/form-sync.js');
    ctx.loadFile('public/js/settings.js');
  });

  describe('openSettingsModal & closeSettingsModal', () => {
    it('opens settings modal and fetches settings', () => {
      ctx.sandbox.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ scanInterval: 10, libraries: [] })
      });

      ctx.sandbox.openSettingsModal();
      expect(ctx.sandbox.settingsModal.classList.contains('hidden')).toBe(false);
    });

    it('closes settings modal', () => {
      ctx.sandbox.settingsModal.classList.remove('hidden');
      ctx.sandbox.closeSettingsModal();
      expect(ctx.sandbox.settingsModal.classList.contains('hidden')).toBe(true);
    });
  });

  describe('fetchSettings', () => {
    it('populates scanIntervalInput with server settings', async () => {
      ctx.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ scanInterval: 15, allowedFormats: 'cbz' })
      });

      await ctx.sandbox.fetchSettings();
      expect(ctx.sandbox.scanIntervalInput.value).toBe('15');
    });

    it('populates the page cache limit and usage', async () => {
      ctx.sandbox.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          scanInterval: 15,
          allowedFormats: 'cbz',
          pageCacheMaxMb: 700,
          pageCacheUsageBytes: 250 * 1024 * 1024,
          pageCacheFileCount: 1234
        })
      });

      await ctx.sandbox.fetchSettings();

      expect(document.getElementById('page-cache-max-input').value).toBe('700');
      expect(document.getElementById('page-cache-usage').textContent)
        .toBe('Using 250 MB of 700 MB across 1,234 files');
    });
  });

  describe('settings form submission', () => {
    it('includes pageCacheMaxMb in the save payload', async () => {
      ctx.sandbox.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          scanInterval: 15,
          allowedFormats: 'cbz',
          metadataStorage: 'archive',
          comicVineApiKey: '',
          pageCacheMaxMb: 700,
          pageCacheUsageBytes: 0,
          pageCacheFileCount: 0
        })
      });
      document.getElementById('page-cache-max-input').value = '700';

      ctx.sandbox.settingsForm.dispatchEvent(new Event('submit', { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const postCall = ctx.sandbox.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall[1].body).pageCacheMaxMb).toBe(700);
    });
  });
});
