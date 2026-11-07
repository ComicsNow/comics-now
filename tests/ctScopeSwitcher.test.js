/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCtScopeSwitcher() {
  const filePath = path.resolve(__dirname, '../public/js/comictagger/scope-switcher.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const cjsCode = code
    .replace(/export const /g, 'const ')
    .replace(/export let /g, 'let ')
    .replace(/export function /g, 'function ')
    + '\nmodule.exports = { CT_SCOPES, CT_TAB_TO_SCOPE, getCtScope, setCtScope, syncCtScopeWithActiveTab, initCtScopeSwitcher };';

  const sandbox = {
    document,
    window,
    console,
    module: { exports: {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(cjsCode, sandbox);
  return sandbox.module.exports;
}

describe('Tag Comics Now Scope Switcher', () => {
  let switcher;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="ct-modal" class="hidden">
        <div id="ct-scope-bar" class="flex items-center gap-1.5">
          <button type="button" id="ct-scope-scanner-btn" data-ct-scope="scanner" class="ct-scope-btn">Scanner & Review</button>
          <button type="button" id="ct-scope-sources-btn" data-ct-scope="sources" class="ct-scope-btn">Sources & AI</button>
          <button type="button" id="ct-scope-organize-btn" data-ct-scope="organize" class="ct-scope-btn">File Organization</button>
        </div>
        <div id="ct-tabs-row">
          <div id="ct-scope-scanner-tabs" class="ct-scope-tabs-group">
            <button id="ct-tab-output" class="tab-button active">Scan & Output</button>
            <button id="ct-tab-matches" class="tab-button">Matches & Review</button>
            <button id="ct-tab-logs" class="tab-button">Scan Logs</button>
          </div>
          <div id="ct-scope-sources-tabs" class="ct-scope-tabs-group hidden" style="display: none;">
            <button id="ct-tab-settings" class="tab-button">Settings & Sources</button>
            <button id="ct-tab-gemini" class="tab-button">Gemini AI</button>
          </div>
          <div id="ct-scope-organize-tabs" class="ct-scope-tabs-group hidden" style="display: none;">
            <button id="mgmt-tab-operations" class="tab-button active">Operations</button>
            <button id="mgmt-tab-name" class="tab-button">Name</button>
            <button id="mgmt-tab-folder" class="tab-button">Folder</button>
            <button id="mgmt-tab-errors" class="tab-button">Errors</button>
          </div>
        </div>
        <div id="ct-content-output"></div>
        <div id="ct-content-matches" class="hidden"></div>
        <div id="ct-content-logs" class="hidden"></div>
        <div id="ct-content-settings" class="hidden"></div>
        <div id="ct-content-gemini" class="hidden"></div>
        <div id="ct-content-management" class="hidden">
          <div id="mgmt-content-operations"></div>
          <div id="mgmt-content-name" class="hidden"></div>
          <div id="mgmt-content-folder" class="hidden"></div>
          <div id="mgmt-content-errors" class="hidden"></div>
        </div>
      </div>
    `;
    if (fs.existsSync(path.resolve(__dirname, '../public/js/comictagger/scope-switcher.js'))) {
      switcher = loadCtScopeSwitcher();
    }
  });

  test('defines correct scope hierarchy and tab mappings', () => {
    switcher = loadCtScopeSwitcher();
    expect(switcher.CT_SCOPES.scanner.tabs).toEqual(['output', 'matches', 'logs']);
    expect(switcher.CT_SCOPES.sources.tabs).toEqual(['settings', 'gemini']);
    expect(switcher.CT_SCOPES.organize.tabs).toEqual(['operations', 'name', 'folder', 'errors']);

    expect(switcher.CT_TAB_TO_SCOPE['output']).toBe('scanner');
    expect(switcher.CT_TAB_TO_SCOPE['matches']).toBe('scanner');
    expect(switcher.CT_TAB_TO_SCOPE['settings']).toBe('sources');
    expect(switcher.CT_TAB_TO_SCOPE['gemini']).toBe('sources');
    expect(switcher.CT_TAB_TO_SCOPE['management']).toBe('organize');
    expect(switcher.CT_TAB_TO_SCOPE['operations']).toBe('organize');
  });

  test('setCtScope switches active scope and applies display styles correctly', () => {
    switcher = loadCtScopeSwitcher();
    switcher.initCtScopeSwitcher();

    switcher.setCtScope('sources');
    expect(switcher.getCtScope()).toBe('sources');

    const scannerTabs = document.getElementById('ct-scope-scanner-tabs');
    const sourcesTabs = document.getElementById('ct-scope-sources-tabs');
    const organizeTabs = document.getElementById('ct-scope-organize-tabs');

    expect(scannerTabs.classList.contains('hidden')).toBe(true);
    expect(scannerTabs.style.display).toBe('none');
    expect(sourcesTabs.classList.contains('hidden')).toBe(false);
    expect(sourcesTabs.style.display).toBe('flex');
    expect(organizeTabs.classList.contains('hidden')).toBe(true);
    expect(organizeTabs.style.display).toBe('none');

    const sourcesBtn = document.getElementById('ct-scope-sources-btn');
    expect(sourcesBtn.classList.contains('bg-amber-500')).toBe(true);
  });

  test('syncCtScopeWithActiveTab aligns scope automatically for direct tab clicks', () => {
    switcher = loadCtScopeSwitcher();
    switcher.initCtScopeSwitcher();

    switcher.syncCtScopeWithActiveTab('gemini');
    expect(switcher.getCtScope()).toBe('sources');

    const sourcesTabs = document.getElementById('ct-scope-sources-tabs');
    expect(sourcesTabs.style.display).toBe('flex');

    switcher.syncCtScopeWithActiveTab('operations');
    expect(switcher.getCtScope()).toBe('organize');

    const organizeTabs = document.getElementById('ct-scope-organize-tabs');
    expect(organizeTabs.style.display).toBe('flex');
  });
});
