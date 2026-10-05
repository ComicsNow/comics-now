/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Tag Comics Now! service port setting UI', () => {
  let sandbox;
  let ctModule;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
    }
    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ct-content-settings">
        <input type="number" id="ct-tagger-port-input" class="w-full bg-gray-700 text-white p-2 rounded-lg text-sm" min="1" max="65535" value="5000">
        <span id="ct-engine-status" class="text-xs px-2.5 py-1 rounded-full bg-green-900/60 text-green-300 border border-green-700 font-medium">● Engine Ready</span>
        <input type="number" id="ct-schedule-input" value="60">
        <button id="ct-save-btn">Save Settings</button>
      </div>
      <div id="ct-content-matches">
        <div id="ct-preview-container" class="hidden"></div>
        <div id="ct-no-matches">No matches</div>
        <table id="ct-match-table" class="hidden">
          <tbody id="ct-match-body"></tbody>
        </table>
        <button id="ct-apply-btn" disabled></button>
        <button id="ct-skip-btn" disabled></button>
      </div>
      <button id="ct-tab-matches"><span id="ct-matches-badge" class="hidden"></span></button>
      <div id="ct-output"></div>
      <div id="ct-confirm-bar" class="hidden">
        <span id="ct-confirm-message"></span>
        <button id="ct-confirm-yes"></button>
        <button id="ct-confirm-no"></button>
      </div>
    `;

    const ctModalEl = document.createElement('div');
    ctModalEl.classList.add('hidden');

    const escapeHtml = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    sandbox = {
      window,
      document,
      console,
      Date,
      JSON,
      Math,
      URL,
      fetch: jest.fn(),
      state: { API_BASE_URL: '' },
      escapeHtml,
      getRelativePath: () => '/tag-comics-now',
      EventSource: FakeEventSource,
      setTimeout: jest.fn(() => 0),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(() => 0),
      clearInterval: jest.fn(),
      ctButton: document.createElement('button'),
      ctModal: ctModalEl,
      ctScheduleInput: document.getElementById('ct-schedule-input'),
      ctMatchBody: document.getElementById('ct-match-body'),
      ctApplyBtn: document.getElementById('ct-apply-btn'),
      ctSkipBtn: document.getElementById('ct-skip-btn'),
      ctConfirmBar: document.getElementById('ct-confirm-bar'),
      ctConfirmMessage: document.getElementById('ct-confirm-message'),
      ctConfirmYes: document.getElementById('ct-confirm-yes'),
      ctConfirmNo: document.getElementById('ct-confirm-no'),
      ctOutputDiv: document.getElementById('ct-output'),
      ctTabMatches: document.getElementById('ct-tab-matches'),
      ctMatchesBadge: document.getElementById('ct-matches-badge')
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const filePath = path.resolve(__dirname, '../public/js/comictagger.js');
    const content = fs.readFileSync(filePath, 'utf8');
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
    ctModule = sandbox;
  });

  afterEach(() => {
    try { delete window.ctEventSource; } catch (_) {}
  });

  function schedulePayload(overrides = {}) {
    return {
      minutes: 60,
      comicsLocation: '',
      metadataStorage: 'archive',
      lowerThreshold: 0.8,
      upperThreshold: 0.9,
      enabledSources: [],
      forceReprocess: false,
      metronUser: '',
      hasMetronPass: false,
      comicVineApiKey: '',
      googleBooksApiKey: '',
      taggerServiceUrl: 'http://127.0.0.1:5000',
      serviceOnline: true,
      ...overrides
    };
  }

  function mockSchedule(payload) {
    sandbox.fetch.mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/tag-comics-now/schedule')) {
        return { ok: true, status: 200, json: async () => payload };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
  }

  test('populates the port input from taggerServiceUrl and shows Engine Ready', async () => {
    mockSchedule(schedulePayload({ taggerServiceUrl: 'http://127.0.0.1:5100', serviceOnline: true }));

    await ctModule.fetchCtSettings();

    expect(document.getElementById('ct-tagger-port-input').value).toBe('5100');
    expect(document.getElementById('ct-engine-status').textContent).toContain('Engine Ready');
  });

  test('shows Engine Offline when the schedule endpoint reports the service down', async () => {
    mockSchedule(schedulePayload({ serviceOnline: false }));

    await ctModule.fetchCtSettings();

    expect(document.getElementById('ct-engine-status').textContent).toContain('Engine Offline');
  });

  test('falls back to port 5000 when taggerServiceUrl is missing or unparsable', async () => {
    mockSchedule(schedulePayload({ taggerServiceUrl: undefined }));
    await ctModule.fetchCtSettings();
    expect(document.getElementById('ct-tagger-port-input').value).toBe('5000');

    mockSchedule(schedulePayload({ taggerServiceUrl: 'not-a-url' }));
    await ctModule.fetchCtSettings();
    expect(document.getElementById('ct-tagger-port-input').value).toBe('5000');
  });

  test('includes the integer taggerServicePort in the save payload', async () => {
    document.getElementById('ct-tagger-port-input').value = '5100';
    const calls = [];
    sandbox.fetch.mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, changed: true, taggerServiceUrl: 'http://127.0.0.1:5100', workerRestarted: true })
      };
    });

    await ctModule.saveCtSettings();

    const saveCall = calls.find(
      (c) => typeof c.url === 'string' && c.url.includes('/tag-comics-now/schedule') && c.opts && c.opts.method === 'POST'
    );
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(saveCall.opts.body);
    expect(body.taggerServicePort).toBe(5100);
    expect(Number.isInteger(body.taggerServicePort)).toBe(true);
    expect(body.minutes).toBe(60);
  });

  test('omits taggerServicePort when the field is empty', async () => {
    document.getElementById('ct-tagger-port-input').value = '';
    const calls = [];
    sandbox.fetch.mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await ctModule.saveCtSettings();

    const saveCall = calls.find(
      (c) => typeof c.url === 'string' && c.url.includes('/tag-comics-now/schedule') && c.opts && c.opts.method === 'POST'
    );
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(saveCall.opts.body);
    expect(body.taggerServicePort).toBeUndefined();
  });
});
