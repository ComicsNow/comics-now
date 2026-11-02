/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Comics Management - Modular Settings', () => {
  let sandbox;

  function loadClientScript(relPath, customSandbox = sandbox) {
    const fullPath = path.resolve(__dirname, '../../../../', relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');
    vm.runInContext(cleanContent, customSandbox);
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="rename-output" class="hidden"></div>
      <div id="move-output" class="hidden"></div>
      <div id="mgmt-confirm-modal" class="hidden">
        <h3 id="mgmt-confirm-title"></h3>
        <p id="mgmt-confirm-warning"></p>
        <input id="mgmt-confirm-input" />
        <button id="mgmt-confirm-proceed-btn" disabled>Proceed</button>
        <button id="mgmt-confirm-cancel-btn">Cancel</button>
      </div>
    `;

    sandbox = {
      window,
      document,
      console,
      state: { API_BASE_URL: 'http://localhost:3000' },
      escapeHtml: str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])),
      fetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
    };
    vm.createContext(sandbox);

    loadClientScript('public/js/settings/management/dialogs.js');
    loadClientScript('public/js/settings/management/rename-stream.js');
    loadClientScript('public/js/settings/management/move-stream.js');
  });

  test('promptSafetyConfirmation opens modal and triggers callback only on exact confirmation phrase', () => {
    const callback = jest.fn();
    sandbox.promptSafetyConfirmation('Test Title', 'Test Warning', callback);

    const modal = document.getElementById('mgmt-confirm-modal');
    const title = document.getElementById('mgmt-confirm-title');
    const warning = document.getElementById('mgmt-confirm-warning');
    const input = document.getElementById('mgmt-confirm-input');
    const proceedBtn = document.getElementById('mgmt-confirm-proceed-btn');

    expect(modal.classList.contains('hidden')).toBe(false);
    expect(title.textContent).toBe('Test Title');
    expect(warning.textContent).toBe('Test Warning');
    expect(proceedBtn.disabled).toBe(true);

    input.value = 'i want';
    input.dispatchEvent(new Event('input'));
    expect(proceedBtn.disabled).toBe(true);

    input.value = 'i want to do this';
    input.dispatchEvent(new Event('input'));
    expect(proceedBtn.disabled).toBe(false);

    proceedBtn.click();
    expect(callback).toHaveBeenCalledWith('i want to do this');
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('startRenameStream and stopRenameStream manage stream lifecycle', () => {
    expect(() => {
      sandbox.startRenameStream();
      sandbox.stopRenameStream();
    }).not.toThrow();
  });

  test('startMoveStream and stopMoveStream manage stream lifecycle', () => {
    expect(() => {
      sandbox.startMoveStream();
      sandbox.stopMoveStream();
    }).not.toThrow();
  });
});
