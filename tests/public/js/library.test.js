/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createLibrarySandbox() {
  const state = {
    currentView: 'comics',
    currentRootFolder: '/media/comics',
    currentPublisher: 'DC',
    currentSeries: 'Batman',
    activeFilter: 'in-progress',
    activeSmartFilter: 'latest',
    router: { navigate: jest.fn() }
  };

  const sandbox = {
    window: window,
    document: document,
    Element: window.Element,
    state: state,
    console: console,
    jest: jest,
    fetch: jest.fn(),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
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
      .replace(/const\s+actionsRef\s*=/g, 'var actionsRef =');
    vm.runInContext(content, sandbox);
  }

  // Load mock globals into sandbox
  vm.runInContext(`
    var canonicalGlobal = state;
    var actions = {
      navigation: {
        setView: jest.fn(),
        setFilter: jest.fn((type, val) => { if (type === 'status') state.activeFilter = val; })
      }
    };
    var showRootFolderList = jest.fn();
    var updateFilterButtonCounts = jest.fn();
    var applyFilterAndRender = jest.fn();
    state.showRootFolderList = showRootFolderList;
    state.updateFilterButtonCounts = updateFilterButtonCounts;
    state.applyFilterAndRender = applyFilterAndRender;
  `, sandbox);

  return { sandbox, state, loadFile };
}

describe('public/js/library.js', () => {
  let ctx;

  beforeEach(() => {
    ctx = createLibrarySandbox();
    ctx.loadFile('public/js/library/navigation.js');
    ctx.loadFile('public/js/library/smart-scope.js');
    ctx.loadFile('public/js/library/search-controls.js');
    ctx.loadFile('public/js/library.js');
  });

  describe('filterLibrary', () => {
    it('returns the original library unmodified', () => {
      const lib = { publishers: ['DC'] };
      expect(ctx.sandbox.filterLibrary(lib, 'unread')).toBe(lib);
    });
  });

  describe('goToInitialView', () => {
    it('resets root navigation state and calls showRootFolderList', () => {
      ctx.sandbox.goToInitialView();
      expect(ctx.state.currentRootFolder).toBeNull();
      expect(ctx.state.currentPublisher).toBeNull();
      expect(ctx.state.currentSeries).toBeNull();
      expect(ctx.state.showRootFolderList).toHaveBeenCalledWith({ force: true });
    });
  });

  describe('handleFilterClick', () => {
    it('updates activeFilter and calls applyFilterAndRender', () => {
      ctx.state.activeSmartFilter = null;
      const container = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.filter = 'unread';
      container.appendChild(btn);
      document.body.appendChild(container);

      const event = { target: btn };
      ctx.sandbox.handleFilterClick(event);

      expect(ctx.state.activeFilter).toBe('unread');
      expect(ctx.state.applyFilterAndRender).toHaveBeenCalled();
    });
  });
});
