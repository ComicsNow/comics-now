/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Settings Modal Responsive Information Architecture & Scope Switcher', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="settings-modal" class="hidden">
        <div id="settings-scope-bar" class="flex">
          <button id="settings-scope-reader-btn" data-scope="reader">My Reader</button>
          <button id="settings-scope-server-btn" data-scope="server" class="admin-only-scope">Server Admin</button>
          <button id="settings-scope-engines-btn" data-scope="engines" class="admin-only-scope">AI Engines</button>
        </div>
        <div id="settings-tabs-row">
          <!-- Reader Scope Tabs -->
          <div id="settings-scope-reader-tabs" class="scope-tabs-group">
            <button id="settings-tab-comics-defaults" class="tab-button">Reading Defaults</button>
            <button id="settings-tab-downloads" class="tab-button">Downloads</button>
            <button id="settings-tab-devices" class="tab-button">Devices</button>
          </div>
          <!-- Server Scope Tabs -->
          <div id="settings-scope-server-tabs" class="scope-tabs-group hidden">
            <button id="settings-tab-general" class="tab-button">General</button>
            <button id="settings-tab-users" class="tab-button">Users</button>
            <button id="settings-tab-logs" class="tab-button">Logs</button>
          </div>
          <!-- Engines Scope Tabs -->
          <div id="settings-scope-engines-tabs" class="scope-tabs-group hidden">
            <button id="settings-tab-story-arcs" class="tab-button">Story Arcs</button>
            <button id="settings-tab-guided-reader" class="tab-button">Guided Reader</button>
          </div>
        </div>
        <div id="settings-content-comics-defaults" class="tab-content"></div>
        <div id="settings-content-downloads" class="tab-content hidden"></div>
        <div id="settings-content-devices" class="tab-content hidden"></div>
        <div id="settings-content-general" class="tab-content hidden"></div>
        <div id="settings-content-users" class="tab-content hidden"></div>
        <div id="settings-content-logs" class="tab-content hidden"></div>
        <div id="settings-content-story-arcs" class="tab-content hidden"></div>
        <div id="settings-content-guided-reader" class="tab-content hidden"></div>
      </div>
    `;

    const state = {
      API_BASE_URL: 'http://localhost:3000',
      syncManager: { userRole: 'admin' }
    };

    sandbox = {
      window,
      document,
      console,
      state
    };

    vm.createContext(sandbox);

    const filePath = path.resolve(__dirname, '../public/js/settings/scope-switcher.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
        .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ');
      vm.runInContext(content, sandbox);
    }
  });

  test('initSettingsScopeSwitcher switches active scope group', () => {
    sandbox.initSettingsScopeSwitcher();

    const serverScopeBtn = document.getElementById('settings-scope-server-btn');
    serverScopeBtn.click();

    const readerGroup = document.getElementById('settings-scope-reader-tabs');
    const serverGroup = document.getElementById('settings-scope-server-tabs');
    const enginesGroup = document.getElementById('settings-scope-engines-tabs');

    expect(serverGroup.classList.contains('hidden')).toBe(false);
    expect(readerGroup.classList.contains('hidden')).toBe(true);
    expect(enginesGroup.classList.contains('hidden')).toBe(true);
  });

  test('non-admin role hides admin scope buttons', () => {
    sandbox.state.syncManager.userRole = 'user';
    sandbox.initSettingsScopeSwitcher();

    const serverScopeBtn = document.getElementById('settings-scope-server-btn');
    const enginesScopeBtn = document.getElementById('settings-scope-engines-btn');

    expect(serverScopeBtn.classList.contains('hidden')).toBe(true);
    expect(enginesScopeBtn.classList.contains('hidden')).toBe(true);
  });

  test('bidirectional bridge buttons navigate between settings and tagger', () => {
    const bridgeToTagger = document.createElement('button');
    bridgeToTagger.id = 'bridge-to-tagger-btn';
    document.body.appendChild(bridgeToTagger);

    const bridgeToStoryArcs = document.createElement('button');
    bridgeToStoryArcs.id = 'bridge-to-story-arcs-settings-btn';
    document.body.appendChild(bridgeToStoryArcs);

    const ctSettingsTab = document.createElement('button');
    ctSettingsTab.id = 'ct-tab-settings';
    let ctSettingsClicked = false;
    ctSettingsTab.addEventListener('click', () => { ctSettingsClicked = true; });
    document.body.appendChild(ctSettingsTab);

    let closedSettings = false;
    let openedCT = false;
    let closedCT = false;
    let openedSettings = false;

    window.closeSettingsModal = () => { closedSettings = true; };
    window.openCTModal = () => { openedCT = true; };
    window.closeCTModal = () => { closedCT = true; };
    window.openSettingsModal = () => { openedSettings = true; };

    sandbox.initSettingsScopeSwitcher();

    bridgeToTagger.click();
    expect(closedSettings).toBe(true);
    expect(openedCT).toBe(true);
    expect(ctSettingsClicked).toBe(true);

    bridgeToStoryArcs.click();
    expect(closedCT).toBe(true);
    expect(openedSettings).toBe(true);
  });
});
