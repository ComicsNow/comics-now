/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Tag Comics Now! scoped scan mode UI', () => {
  let sandbox;
  let ctModule;
  let eventSourceInstances;
  const realSetTimeout = global.setTimeout;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      eventSourceInstances.push(this);
    }
    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ct-scan-status-text">Ready to scan comic library</div>
      <button id="ct-run-btn">Run Library Scan</button>
      <button id="ct-rescan-unmatched-btn">Rescan Unmatched <span id="ct-unmatched-count"></span></button>
      <button id="ct-rescan-xml-btn">Rescan Existing XML</button>
      <button id="ct-cancel-btn" class="hidden">Cancel Scan</button>
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

    eventSourceInstances = [];

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
      ctScheduleInput: document.createElement('input'),
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
    for (const es of eventSourceInstances) {
      try { es.close(); } catch (_) {}
    }
    try { delete window.ctEventSource; } catch (_) {}
  });

  function fetchCallsFor(urlPart) {
    return sandbox.fetch.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes(urlPart)
    );
  }

  function lastRunBody() {
    const calls = fetchCallsFor('/tag-comics-now/run');
    if (calls.length === 0) return null;
    return JSON.parse(calls[calls.length - 1][1].body);
  }

  function tick() {
    return new Promise((resolve) => realSetTimeout(resolve, 0));
  }

  function okJson(payload) {
    return { ok: true, status: 200, json: async () => payload };
  }

  test('each run button posts its scan mode', async () => {
    sandbox.fetch.mockImplementation(async () => okJson({ ok: true }));

    document.getElementById('ct-run-btn').click();
    await tick();
    expect(lastRunBody()).toEqual({ mode: 'default' });

    document.getElementById('ct-rescan-unmatched-btn').click();
    await tick();
    expect(lastRunBody()).toEqual({ mode: 'unmatched' });

    document.getElementById('ct-rescan-xml-btn').click();
    await tick();
    expect(lastRunBody()).toEqual({ mode: 'existing-xml' });
  });

  test('setScanRunningUI hides all three run buttons while scanning and restores them', () => {
    const runBtn = document.getElementById('ct-run-btn');
    const unmatchedBtn = document.getElementById('ct-rescan-unmatched-btn');
    const xmlBtn = document.getElementById('ct-rescan-xml-btn');
    const cancelBtn = document.getElementById('ct-cancel-btn');

    ctModule.setScanRunningUI(true);
    expect(runBtn.classList.contains('hidden')).toBe(true);
    expect(unmatchedBtn.classList.contains('hidden')).toBe(true);
    expect(xmlBtn.classList.contains('hidden')).toBe(true);
    expect(cancelBtn.classList.contains('hidden')).toBe(false);

    ctModule.setScanRunningUI(false);
    expect(runBtn.classList.contains('hidden')).toBe(false);
    expect(unmatchedBtn.classList.contains('hidden')).toBe(false);
    expect(xmlBtn.classList.contains('hidden')).toBe(false);
    expect(cancelBtn.classList.contains('hidden')).toBe(true);
  });

  test('fetchCtScopeCounts renders the unmatched count and disables the button at zero', async () => {
    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/scope-counts')) return okJson({ ok: true, unmatched: 5 });
      return okJson({});
    });

    await ctModule.fetchCtScopeCounts();

    expect(document.getElementById('ct-unmatched-count').textContent).toBe('(5)');
    expect(document.getElementById('ct-rescan-unmatched-btn').disabled).toBe(false);

    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/scope-counts')) return okJson({ ok: true, unmatched: 0 });
      return okJson({});
    });

    await ctModule.fetchCtScopeCounts();

    expect(document.getElementById('ct-unmatched-count').textContent).toBe('');
    expect(document.getElementById('ct-rescan-unmatched-btn').disabled).toBe(true);

    // Restoring the scan UI must respect the disabled-at-zero state
    ctModule.setScanRunningUI(true);
    ctModule.setScanRunningUI(false);
    expect(document.getElementById('ct-rescan-unmatched-btn').disabled).toBe(true);
  });

  test('openCTModal refreshes the unmatched scope count', async () => {
    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/scope-counts')) return okJson({ ok: true, unmatched: 4 });
      if (url.includes('/tag-comics-now/logs')) return okJson([]);
      return okJson({ waitingForResponse: false, isRunning: false });
    });

    ctModule.openCTModal();
    await tick();

    expect(fetchCallsFor('/scope-counts').length).toBeGreaterThanOrEqual(1);
    expect(document.getElementById('ct-unmatched-count').textContent).toBe('(4)');
  });

  test('a successful selection confirmation refreshes the scope count', async () => {
    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/scope-counts')) return okJson({ ok: true, unmatched: 1 });
      return okJson({ ok: true });
    });

    ctModule.showCtConfirm('apply');
    await ctModule.handleCtConfirmYes();
    await tick();

    expect(fetchCallsFor('/scope-counts').length).toBe(1);
    expect(document.getElementById('ct-unmatched-count').textContent).toBe('(1)');
  });

  test('a Results completion log line triggers a scope-count refresh', async () => {
    ctModule.ctModal.classList.remove('hidden');
    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/tag-comics-now/logs')) {
        return okJson([{ timestamp: '2026-10-03T10:00:00.000Z', message: 'Results: 10 comics processed' }]);
      }
      if (url.includes('/scope-counts')) return okJson({ ok: true, unmatched: 6 });
      if (url.includes('/tag-comics-now/pending')) {
        return okJson({ waitingForResponse: false, isRunning: true });
      }
      return okJson({});
    });

    await ctModule.ctSyncLogsAndState();
    await tick();

    expect(fetchCallsFor('/scope-counts').length).toBe(1);
    expect(document.getElementById('ct-unmatched-count').textContent).toBe('(6)');
  });

  test('index.html exposes the two scoped buttons and drops the force checkbox', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');

    expect(html).toContain('ct-rescan-unmatched-btn');
    expect(html).toContain('ct-unmatched-count');
    expect(html).toContain('ct-rescan-xml-btn');
    expect(html).not.toContain('ct-force-scan-cb');
    expect(html).toContain('Scheduled scans re-process comics with existing ComicInfo.xml');
  });
});
