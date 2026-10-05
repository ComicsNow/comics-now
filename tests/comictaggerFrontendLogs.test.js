/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Tag Comics Now! frontend log rendering, dedupe, and confirm flow', () => {
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
      // Timers are captured instead of scheduled so module-level polling
      // (interval for pending indicator, 2s initial check) never interferes.
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

  function tick() {
    return new Promise((resolve) => realSetTimeout(resolve, 0));
  }

  test('formatCtLogMessage marks only the real limiter line as rate-defense, not the WAITING banner', () => {
    const ts = new Date().toISOString();

    const limiterLine = ctModule.formatCtLogMessage(
      ts,
      '  ↳ [RateDefense] Rate defense / API cooldown: waiting 5.0s (comicvine.com)'
    );
    expect(limiterLine.dataset.logType).toBe('rate-defense');

    const waitingLine = ctModule.formatCtLogMessage(ts, '>>> WAITING FOR USER SELECTION (Found 2 candidates)');
    expect(waitingLine.dataset.logType).toBeUndefined();
    expect(waitingLine.textContent).toContain('WAITING FOR USER SELECTION');
  });

  test('loadCtSavedLogs renders an id-stamped entry once and shows the resolved text after replay', async () => {
    const ts = '2026-10-03T10:00:00.000Z';
    const waitingLogs = [
      { timestamp: ts, message: '>>> WAITING FOR USER SELECTION (Found 2 candidates)', id: 'ct-wait-1' }
    ];
    const resolvedLogs = [
      { timestamp: ts, message: '✓ User selected candidate #1: Example Title', id: 'ct-wait-1' }
    ];

    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/tag-comics-now/logs')) {
        const payload = sandbox.fetch.mock.calls.filter(([u]) => u.includes('/logs')).length > 1
          ? resolvedLogs
          : waitingLogs;
        return { ok: true, status: 200, json: async () => payload };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await ctModule.loadCtSavedLogs();

    let nodes = document.getElementById('ct-output').querySelectorAll('[data-log-id="ct-wait-1"]');
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain('WAITING FOR USER SELECTION');

    // Re-render with the same buffer: still exactly one node
    await ctModule.loadCtSavedLogs();
    nodes = document.getElementById('ct-output').querySelectorAll('[data-log-id="ct-wait-1"]');
    expect(nodes.length).toBe(1);

    // Buffer now replays the resolved message for the same id
    await ctModule.loadCtSavedLogs();
    const output = document.getElementById('ct-output');
    nodes = output.querySelectorAll('[data-log-id="ct-wait-1"]');
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain('User selected candidate #1');
    expect(output.textContent).not.toContain('WAITING FOR USER SELECTION');
  });

  test('ctSyncLogsAndState never duplicates the waiting line and updates it in place once resolved', async () => {
    const ts = '2026-10-03T10:00:00.000Z';
    ctModule.ctModal.classList.remove('hidden');
    let logPayload = [
      { timestamp: ts, message: '>>> WAITING FOR USER SELECTION (Found 2 candidates)', id: 'ct-wait-2' }
    ];

    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/tag-comics-now/logs')) {
        return { ok: true, status: 200, json: async () => logPayload };
      }
      if (url.includes('/tag-comics-now/pending')) {
        return { ok: true, status: 200, json: async () => ({ waitingForResponse: false, isRunning: false }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await ctModule.ctSyncLogsAndState();

    const output = document.getElementById('ct-output');
    let nodes = output.querySelectorAll('[data-log-id="ct-wait-2"]');
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain('WAITING FOR USER SELECTION');

    // Same buffer polled again: no duplicate line
    await ctModule.ctSyncLogsAndState();
    nodes = output.querySelectorAll('[data-log-id="ct-wait-2"]');
    expect(nodes.length).toBe(1);

    // Resolved message arrives with the same id: replaced in place, no duplicates
    logPayload = [
      { timestamp: ts, message: '✓ User selected candidate #1: Example Title', id: 'ct-wait-2' }
    ];
    await ctModule.ctSyncLogsAndState();

    nodes = output.querySelectorAll('[data-log-id="ct-wait-2"]');
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain('User selected candidate #1');
    expect(output.textContent).not.toContain('WAITING FOR USER SELECTION');
  });

  test('SSE onmessage replaces an id-stamped line in place', async () => {
    const ts = '2026-10-03T10:00:00.000Z';
    sandbox.fetch.mockImplementation(async (url) => {
      if (url.includes('/tag-comics-now/logs')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({ waitingForResponse: false, isRunning: false }) };
    });

    ctModule.openCTModal();
    await tick();

    const es = window.ctEventSource;
    expect(es).toBeTruthy();

    es.onmessage({ data: JSON.stringify({ timestamp: ts, message: '>>> WAITING FOR USER SELECTION (Found 2 candidates)', id: 'ct-wait-3' }) });
    const output = document.getElementById('ct-output');
    let nodes = output.querySelectorAll('[data-log-id="ct-wait-3"]');
    expect(nodes.length).toBe(1);

    // Duplicate delivery of the same id: still one node
    es.onmessage({ data: JSON.stringify({ timestamp: ts, message: '>>> WAITING FOR USER SELECTION (Found 2 candidates)', id: 'ct-wait-3' }) });
    nodes = output.querySelectorAll('[data-log-id="ct-wait-3"]');
    expect(nodes.length).toBe(1);

    es.onmessage({ data: JSON.stringify({ timestamp: ts, message: '⊘ Skipped — recorded as unmatched: X-Men 01.cbz', id: 'ct-wait-3' }) });
    nodes = output.querySelectorAll('[data-log-id="ct-wait-3"]');
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toContain('Skipped');
  });

  test('confirming a selection twice concurrently sends exactly one POST', async () => {
    sandbox.fetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    }));

    ctModule.showCtConfirm('apply');

    const p1 = ctModule.handleCtConfirmYes();
    const p2 = ctModule.handleCtConfirmYes();
    await Promise.all([p1, p2]);

    expect(fetchCallsFor('/tag-comics-now/apply').length).toBe(1);
    expect(document.getElementById('ct-confirm-bar').classList.contains('hidden')).toBe(true);
  });

  test('a rejected selection keeps the review visible, shows the error, and allows a retry', async () => {
    const matchTable = document.getElementById('ct-match-table');
    matchTable.classList.remove('hidden');

    sandbox.fetch.mockImplementation(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: 'No tagger run waiting for user selection' })
    }));

    ctModule.showCtConfirm('skip');
    await ctModule.handleCtConfirmYes();

    // Review is untouched: confirm bar stays open, matches still displayed
    expect(document.getElementById('ct-confirm-bar').classList.contains('hidden')).toBe(false);
    expect(matchTable.classList.contains('hidden')).toBe(false);

    const output = document.getElementById('ct-output');
    expect(output.textContent).toContain('No tagger run waiting for user selection');

    // The single-flight guard must release after a failure so the user can retry
    await ctModule.handleCtConfirmYes();
    expect(fetchCallsFor('/tag-comics-now/skip').length).toBe(2);
  });

  test('events.js no longer registers duplicate click listeners for Tag Comics Now! controls', () => {
    const eventsSource = fs.readFileSync(path.resolve(__dirname, '../public/js/events.js'), 'utf8');
    const ownedByComictagger = [
      'ctSaveBtn',
      'ctApplyBtn',
      'ctSkipBtn',
      'ctConfirmYes',
      'ctConfirmNo',
      'ctClearOutputBtn'
    ];
    for (const handle of ownedByComictagger) {
      expect(eventsSource).not.toContain(`${handle}?.addEventListener`);
      expect(eventsSource).not.toContain(`${handle}.addEventListener`);
    }
  });
});
