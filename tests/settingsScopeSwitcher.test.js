/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScopeSwitcher() {
  const filePath = path.resolve(__dirname, '../public/js/settings/scope-switcher.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const cjsCode = code
    .replace(/export const /g, 'const ')
    .replace(/export let /g, 'let ')
    .replace(/export function /g, 'function ')
    + '\nmodule.exports = { SCOPES, TAB_TO_SCOPE, getSettingsScope, setSettingsScope, syncScopeWithActiveTab, initSettingsScopeSwitcher };';

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

describe('Settings Scope Switcher (Approach A)', () => {
  let switcher;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="settings-modal" class="hidden">
        <div id="settings-scope-bar" class="flex items-center gap-1.5">
          <button type="button" id="settings-scope-reader-btn" data-scope="reader" class="scope-btn">My Reader</button>
          <button type="button" id="settings-scope-server-btn" data-scope="server" class="admin-only-scope scope-btn">Server Admin</button>
          <button type="button" id="settings-scope-engines-btn" data-scope="engines" class="admin-only-scope scope-btn">AI Engines</button>
        </div>
        <div id="settings-tabs-row">
          <div id="settings-scope-reader-tabs" class="scope-tabs-group">
            <button id="settings-tab-comics-defaults" class="tab-button active">Reading Experience</button>
            <button id="settings-tab-downloads" class="tab-button">Downloads</button>
            <button id="settings-tab-devices" class="tab-button">Devices</button>
          </div>
          <div id="settings-scope-server-tabs" class="scope-tabs-group hidden">
            <button id="settings-tab-general" class="tab-button">Storage</button>
            <button id="settings-tab-users" class="tab-button">Users</button>
            <button id="settings-tab-logs" class="tab-button">Logs</button>
          </div>
          <div id="settings-scope-engines-tabs" class="scope-tabs-group hidden">
            <button id="settings-tab-guided-reader" class="tab-button">Guided Reader</button>
          </div>
        </div>
        <div id="settings-content-comics-defaults"></div>
        <div id="settings-content-downloads" class="hidden"></div>
        <div id="settings-content-devices" class="hidden"></div>
        <div id="settings-content-general" class="hidden"></div>
        <div id="settings-content-users" class="hidden"></div>
        <div id="settings-content-logs" class="hidden"></div>
        <div id="settings-content-guided-reader" class="hidden"></div>
      </div>
    `;
    switcher = loadScopeSwitcher();
  });

  test('defines correct scope hierarchy and mappings', () => {
    expect(switcher.SCOPES.reader.tabs).toEqual(['comics-defaults', 'downloads', 'devices']);
    expect(switcher.SCOPES.server.tabs).toEqual(['general', 'users', 'logs']);
    expect(switcher.SCOPES.engines.tabs).toEqual(['guided-reader']);

    expect(switcher.TAB_TO_SCOPE['comics-defaults']).toBe('reader');
    expect(switcher.TAB_TO_SCOPE['general']).toBe('server');
    expect(switcher.TAB_TO_SCOPE['guided-reader']).toBe('engines');
  });

  test('setSettingsScope switches active scope and shows correct tab group', () => {
    switcher.initSettingsScopeSwitcher();

    switcher.setSettingsScope('server');
    expect(switcher.getSettingsScope()).toBe('server');

    const readerTabs = document.getElementById('settings-scope-reader-tabs');
    const serverTabs = document.getElementById('settings-scope-server-tabs');
    const enginesTabs = document.getElementById('settings-scope-engines-tabs');

    expect(readerTabs.classList.contains('hidden')).toBe(true);
    expect(readerTabs.style.display).toBe('none');
    expect(serverTabs.classList.contains('hidden')).toBe(false);
    expect(serverTabs.style.display).toBe('flex');
    expect(enginesTabs.classList.contains('hidden')).toBe(true);
    expect(enginesTabs.style.display).toBe('none');

    const serverBtn = document.getElementById('settings-scope-server-btn');
    expect(serverBtn.classList.contains('bg-amber-500')).toBe(true);
  });

  test('syncScopeWithActiveTab automatically aligns scope when switching tabs directly', () => {
    switcher.initSettingsScopeSwitcher();

    // Directly navigating to guided-reader should switch scope to engines
    switcher.syncScopeWithActiveTab('guided-reader');
    expect(switcher.getSettingsScope()).toBe('engines');

    const enginesTabs = document.getElementById('settings-scope-engines-tabs');
    expect(enginesTabs.classList.contains('hidden')).toBe(false);

    // Switching back to downloads should align scope to reader
    switcher.syncScopeWithActiveTab('downloads');
    expect(switcher.getSettingsScope()).toBe('reader');

    const readerTabs = document.getElementById('settings-scope-reader-tabs');
    expect(readerTabs.classList.contains('hidden')).toBe(false);
  });

  test('clicking scope button switches scope cleanly', () => {
    switcher.initSettingsScopeSwitcher();

    const enginesBtn = document.getElementById('settings-scope-engines-btn');
    enginesBtn.click();

    expect(switcher.getSettingsScope()).toBe('engines');
    const enginesTabs = document.getElementById('settings-scope-engines-tabs');
    expect(enginesTabs.classList.contains('hidden')).toBe(false);
  });
});
