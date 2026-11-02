/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSmartFiltersSandbox() {
  const state = {
    currentView: 'root',
    activeSmartFilter: null,
    currentRootFolder: null,
    currentPublisher: null,
    currentSeries: null,
    activeFilter: 'all',
    library: {
      'Marvel': {
        publishers: {
          'Marvel Comics': {
            series: {
              'X-Men': [
                { id: 101, title: 'X-Men #1' },
                { id: 102, title: 'X-Men #2' }
              ]
            }
          }
        }
      }
    },
    LibrarySmartLists: {
      getLatestComics: jest.fn().mockReturnValue([{ id: 101, title: 'X-Men #1' }]),
      rebuildLatestComics: jest.fn(),
      LATEST_ADDED_DAYS: 14
    },
    updateBreadcrumb: jest.fn(),
    showView: jest.fn(),
    renderComicCards: jest.fn()
  };

  const sandbox = {
    window,
    document,
    Element: window.Element,
    state,
    console,
    alert: jest.fn()
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

describe('Smart Filters Module', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="latest-added-btn"></button>
      <button id="downloaded-btn"></button>
      <button id="guided-smart-list-btn"></button>
      <button id="dynamic-manga-filter-btn"></button>
      <button id="dynamic-reading-list-filter-btn"></button>
      <div id="smart-scope-mode-toggle" class="hidden"></div>
      <div id="smart-filter-host" class="hidden"></div>
      <div id="smart-list-view">
        <div class="smart-filter-mount"></div>
        <h2 id="smart-list-title"></h2>
        <div id="smart-list-container"></div>
      </div>
    `;
    env = createSmartFiltersSandbox();
  });

  test('button active states toggle css classes correctly', () => {
    env.loadFile('public/js/library/filters/buttons.js');
    const { setGuidedButtonActive, setMangaFilterButtonActive } = env.sandbox;

    setGuidedButtonActive(true);
    const guidedBtn = document.getElementById('guided-smart-list-btn');
    expect(guidedBtn.classList.contains('bg-purple-600')).toBe(true);
    expect(guidedBtn.getAttribute('aria-pressed')).toBe('true');

    setGuidedButtonActive(false);
    expect(guidedBtn.classList.contains('bg-gray-700')).toBe(true);
    expect(guidedBtn.getAttribute('aria-pressed')).toBe('false');

    setMangaFilterButtonActive(true);
    const mangaBtn = document.getElementById('dynamic-manga-filter-btn');
    expect(mangaBtn.classList.contains('bg-purple-600')).toBe(true);
  });

  test('predicate collects drill-in ids and scopes comics correctly', () => {
    env.loadFile('public/js/library/filters/predicate.js');
    const { collectDrillInComicIds, scopeListByDrillIn } = env.sandbox;

    env.state.currentRootFolder = 'Marvel';
    env.state.currentPublisher = 'Marvel Comics';
    env.state.currentSeries = 'X-Men';

    const ids = collectDrillInComicIds();
    expect(ids.size).toBe(2);
    expect(ids.has(101)).toBe(true);
    expect(ids.has(102)).toBe(true);

    const comics = [
      { id: 101, title: 'X-Men #1' },
      { id: 999, title: 'Batman #1' }
    ];
    const scoped = scopeListByDrillIn(comics);
    expect(scoped.length).toBe(1);
    expect(scoped[0].id).toBe(101);
  });

  test('LibrarySmartFilters namespace is cleanly registered on state and window', () => {
    env.loadFile('public/js/library/filters/buttons.js');
    env.loadFile('public/js/library/filters/predicate.js');
    env.loadFile('public/js/library/filters/views.js');
    env.loadFile('public/js/library/smart-filters.js');

    const { LibrarySmartFilters, state, window } = env.sandbox;
    expect(LibrarySmartFilters).toBeDefined();
    expect(typeof LibrarySmartFilters.syncSmartFilterButtons).toBe('function');
    expect(typeof LibrarySmartFilters.showLatestAddedSmartList).toBe('function');
    expect(state.LibrarySmartFilters).toBe(LibrarySmartFilters);
    expect(window.LibrarySmartFilters).toBe(LibrarySmartFilters);
  });
});
