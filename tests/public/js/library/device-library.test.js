/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createDeviceLibrarySandbox() {
  const state = {
    showRootFolderList: jest.fn(),
    applyFilterAndRender: jest.fn(),
    showView: jest.fn(),
    showComicList: jest.fn(),
    openComicViewer: jest.fn(),
    OfflineDB: {
      openOfflineDB: jest.fn()
    }
  };

  const sandbox = {
    window,
    document,
    Element: window.Element,
    state,
    console,
    alert: jest.fn(),
    confirm: jest.fn().mockReturnValue(true),
    setTimeout,
    clearTimeout
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

describe('Device Library Module', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="comic-list" class="hidden">
        <h2 id="comic-list-title"></h2>
        <div id="comic-list-container"></div>
      </div>
      <div id="root-folder-container"></div>
    `;
    env = createDeviceLibrarySandbox();
    env.loadFile('public/js/library/device/storage.js');
    env.loadFile('public/js/library/device/ui.js');
    env.loadFile('public/js/library/device-library.js');
  });

  test('renderLocalComicList populates container with local comic cards', () => {
    const { renderLocalComicList, state } = env.sandbox;

    const mockComics = [
      { name: 'Batman #1.cbz', path: 'Batman #1.cbz' },
      { name: 'Superman #1.cbz', path: 'Superman #1.cbz' }
    ];

    renderLocalComicList('Local Files', mockComics);

    const titleEl = document.getElementById('comic-list-title');
    const container = document.getElementById('comic-list-container');
    expect(titleEl.textContent).toBe('Local Files');
    expect(container.children.length).toBe(2);
    expect(container.textContent).toContain('Batman #1.cbz');
    expect(container.textContent).toContain('Superman #1.cbz');
    expect(state.showView).toHaveBeenCalled();
  });

  test('DeviceLibrary namespace is cleanly registered on state and window', () => {
    const { DeviceLibrary, state, window } = env.sandbox;

    expect(DeviceLibrary).toBeDefined();
    expect(typeof DeviceLibrary.requestDeviceLibrary).toBe('function');
    expect(typeof DeviceLibrary.getDeviceLibraries).toBe('function');
    expect(typeof DeviceLibrary.getDeviceComics).toBe('function');
    expect(state.DeviceLibrary).toBe(DeviceLibrary);
    expect(window.DeviceLibrary).toBe(DeviceLibrary);
  });
});
