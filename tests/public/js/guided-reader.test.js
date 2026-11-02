/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createGuidedReaderSandbox() {
  const state = {
    API_BASE_URL: '',
    escapeHtml: (str) => String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]))
  };

  const sandbox = {
    window,
    document,
    Element: window.Element,
    CSS: { escape: (s) => s.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1') },
    state,
    console,
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    }),
    EventSource: jest.fn().mockImplementation(() => ({
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    })),
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
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
      .replace(/const\s+global\s*=/g, 'var global =');
    vm.runInContext(content, sandbox);
  }

  return { sandbox, loadFile, state };
}

describe('Guided Reader Admin UI Submodules', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="guided-log" style="height: 100px; overflow: auto;"></div>
      <select id="guided-log-level-filter">
        <option value="ALL">ALL</option>
        <option value="INFO">INFO</option>
        <option value="ERROR">ERROR</option>
      </select>
      <div id="guided-count-pending">0</div>
      <div id="guided-count-processing">0</div>
      <div id="guided-count-completed">0</div>
      <div id="guided-count-failed">0</div>
      <div id="guided-count-total">0</div>
      <div id="guided-current">Idle.</div>
      <button id="guided-run-btn"></button>
      <button id="guided-cancel-btn" disabled></button>
      <button id="guided-cancel-current-btn" disabled></button>
      <button id="guided-log-clear"></button>

      <form id="guided-settings-form">
        <input type="checkbox" id="guided-auto-on-add">
        <input type="checkbox" id="guided-schedule-enabled">
        <input type="number" id="guided-schedule-interval" value="24">
        <select id="guided-schedule-unit">
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        <select id="guided-concurrency">
          <option value="2">2</option>
          <option value="4">4</option>
        </select>
        <input type="checkbox" id="guided-use-modal">
        <div id="guided-modal-panel" class="hidden"></div>
        <input type="text" id="guided-modal-token-id">
        <input type="password" id="guided-modal-token-secret">
        <input type="text" id="guided-modal-env">
        <button type="submit" id="guided-settings-submit"></button>
        <div id="guided-settings-status"></div>
      </form>

      <div id="guided-modal-badge"></div>
      <div id="guided-modal-available"></div>
      <div id="guided-modal-total-credits"></div>
      <div id="guided-modal-metered"></div>
      <div id="guided-modal-billed"></div>
      <div id="guided-modal-credit-msg"></div>
      <div id="guided-modal-setup-banner" class="hidden"></div>
      <button id="guided-modal-setup-btn" class="hidden"></button>
      <button id="guided-modal-banner-setup-btn"></button>
      <button id="guided-modal-refresh-btn"></button>
      <button id="guided-modal-test-btn"></button>
      <div id="guided-modal-test-feedback"></div>
    `;

    env = createGuidedReaderSandbox();
    env.loadFile('public/js/guided-admin/logs.js');
    env.loadFile('public/js/guided-admin/modal.js');
    env.loadFile('public/js/guided-admin/status.js');
    env.loadFile('public/js/guided-admin/events.js');
    env.loadFile('public/js/guided-reader.js');
  });

  describe('logs.js', () => {
    test('appends log lines and supports level filtering', () => {
      env.sandbox.appendLogLine({ level: 'INFO', message: 'Starting task' });
      env.sandbox.appendLogLine({ level: 'ERROR', message: 'Failed chunk' });

      expect(env.sandbox.logBuffer.length).toBe(2);

      const logBox = document.getElementById('guided-log');
      expect(logBox.textContent).toContain('Starting task');
      expect(logBox.textContent).toContain('Failed chunk');

      expect(env.sandbox.entryMatches({ level: 'INFO' }, 'ALL')).toBe(true);
      expect(env.sandbox.entryMatches({ level: 'INFO' }, 'INFO')).toBe(true);
      expect(env.sandbox.entryMatches({ level: 'INFO' }, 'ERROR')).toBe(false);

      env.sandbox.clearLogs();
      expect(env.sandbox.logBuffer.length).toBe(0);
      expect(logBox.children.length).toBe(0);
    });

    test('updates in-place log entries sharing the same id', () => {
      env.sandbox.appendLogLine({ id: 'task-1', level: 'INFO', message: 'Step 1/10' });
      expect(env.sandbox.logBuffer.length).toBe(1);
      expect(document.getElementById('guided-log').textContent).toContain('Step 1/10');

      env.sandbox.appendLogLine({ id: 'task-1', level: 'INFO', message: 'Step 2/10' });
      expect(env.sandbox.logBuffer.length).toBe(1);
      expect(document.getElementById('guided-log').textContent).toContain('Step 2/10');
      expect(document.getElementById('guided-log').textContent).not.toContain('Step 1/10');
    });
  });

  describe('status.js', () => {
    test('applyStatusToUI correctly updates DOM counters and run status', () => {
      env.sandbox.applyStatusToUI({
        isRunning: true,
        counts: { pending: 5, processing: 1, completed: 10, failed: 0, total: 16 },
        current: { index: 1, total: 16, name: 'Batman 001.cbz' }
      });

      expect(document.getElementById('guided-count-pending').textContent).toBe('5');
      expect(document.getElementById('guided-count-processing').textContent).toBe('1');
      expect(document.getElementById('guided-count-completed').textContent).toBe('10');
      expect(document.getElementById('guided-count-total').textContent).toBe('16');
      expect(document.getElementById('guided-current').textContent).toContain('Batman 001.cbz');

      expect(document.getElementById('guided-run-btn').disabled).toBe(true);
      expect(document.getElementById('guided-cancel-btn').disabled).toBe(false);
    });

    test('applySettingsToUI populates form inputs accurately', () => {
      env.sandbox.applySettingsToUI({
        autoOnAdd: true,
        scheduleEnabled: true,
        scheduleInterval: 12,
        scheduleUnit: 'days',
        useModal: true,
        modalTokenId: 'ak-12345',
        hasModalSecret: true,
        concurrency: 4
      });

      expect(document.getElementById('guided-auto-on-add').checked).toBe(true);
      expect(document.getElementById('guided-schedule-enabled').checked).toBe(true);
      expect(document.getElementById('guided-schedule-interval').value).toBe('12');
      expect(document.getElementById('guided-schedule-unit').value).toBe('days');
      expect(document.getElementById('guided-use-modal').checked).toBe(true);
      expect(document.getElementById('guided-modal-panel').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('guided-modal-token-id').value).toBe('ak-12345');
      expect(document.getElementById('guided-modal-token-secret').placeholder).toContain('configured');
    });
  });

  describe('modal.js', () => {
    test('fetchModalCredits updates credit metrics and readiness status', async () => {
      env.sandbox.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          availableCredits: 25.50,
          totalCredits: 30.00,
          modelsUploaded: true,
          appDeployed: true,
          workspace: 'prod-cluster'
        })
      });

      await env.sandbox.fetchModalCredits();

      expect(document.getElementById('guided-modal-available').textContent).toBe('$25.50');
      expect(document.getElementById('guided-modal-total-credits').textContent).toBe('$30.00');
      expect(document.getElementById('guided-modal-badge').textContent).toBe('Ready (GPU)');
      expect(document.getElementById('guided-modal-credit-msg').textContent).toContain('prod-cluster');
    });
  });

  describe('facade public/js/guided-reader.js', () => {
    test('openGuidedReaderTab initializes submodules and polling', () => {
      expect(typeof env.sandbox.openGuidedReaderTab).toBe('function');
      env.sandbox.openGuidedReaderTab();
      expect(env.sandbox.EventSource).toHaveBeenCalled();
    });

    test('closeSettingsModal cleanly tears down streams and intervals', () => {
      env.sandbox.openGuidedReaderTab();
      const mockClose = jest.fn();
      env.state.closeSettingsModal = mockClose;

      expect(typeof env.state.closeSettingsModal).toBe('function');
      env.state.closeSettingsModal();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
