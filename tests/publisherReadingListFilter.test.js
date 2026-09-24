/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createModuleSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    currentPublisher: null,
    activeSmartFilter: null,
    activeFilter: 'all',
    library: {}
  };

  const sandbox = {
    window: window,
    document: document,
    state: state,
    console: console,
    fetch: jest.fn(),
    applyDisplayInfoToComic: jest.fn(c => c)
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Helper to load ES-module-like file into sandbox
  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
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
  }

  return { sandbox, loadFile, state };
}

describe('Publisher View Reading List Filter', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="dynamic-reading-list-filter-btn" class="hidden">
        <span id="dynamic-reading-list-filter-label">Reading Lists</span>
        <span id="dynamic-reading-list-filter-count">0</span>
      </div>
      <div id="smart-list-buttons"></div>
    `;

    env = createModuleSandbox();
    env.loadFile('../public/js/library/smartlists.js');
    env.loadFile('../public/js/library/status.js');
  });

  test('matchesPublisher correctly matches by publishers array, prefix, and name', () => {
    const matchesPublisher = env.sandbox.matchesPublisher;
    expect(typeof matchesPublisher).toBe('function');

    expect(matchesPublisher({ name: 'Batman: Knightfall', publishers: ['DC Comics'] }, 'DC Comics')).toBe(true);
    expect(matchesPublisher({ name: 'Marvel: Civil War', publishers: [] }, 'Marvel')).toBe(true);
    expect(matchesPublisher({ name: 'Spawn Origins', publishers: ['Image'] }, 'Image Comics')).toBe(true);
    expect(matchesPublisher({ name: 'Dark Horse Star Wars', publishers: [] }, 'Dark Horse')).toBe(true);
    expect(matchesPublisher({ name: 'Spider-Man Collection', publishers: [] }, 'DC Comics')).toBe(false);
  });

  test('updateReadingListFilterButtonCount on publisher view counts matching publishers and reveals button', () => {
    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const updateReadingListFilterButtonCount = env.sandbox.updateReadingListFilterButtonCount;

    setCachedReadingLists([
      { id: 'list-1', name: 'Batman Epic', publishers: ['DC'] },
      { id: 'list-2', name: 'Spider-Verse', publishers: ['Marvel'] }
    ]);

    env.state.currentView = 'publishers';
    env.state.currentRootFolder = '/comics/main';
    env.state.library = {
      '/comics/main': {
        publishers: {
          'DC': { series: { 'Batman': [{ id: 1 }] } },
          'Marvel': { series: { 'Spider-Man': [{ id: 2 }] } },
          'Image': { series: { 'Spawn': [{ id: 3 }] } }
        }
      }
    };

    updateReadingListFilterButtonCount();

    const btn = document.getElementById('dynamic-reading-list-filter-btn');
    const count = document.getElementById('dynamic-reading-list-filter-count');

    expect(btn.classList.contains('hidden')).toBe(false);
    expect(count.textContent).toBe('2'); // DC and Marvel have reading lists
  });

  test('updateReadingListFilterButtonCount hides button on publisher view when no publishers have reading lists', () => {
    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const updateReadingListFilterButtonCount = env.sandbox.updateReadingListFilterButtonCount;

    setCachedReadingLists([
      { id: 'list-1', name: 'Dark Horse Classics', publishers: ['Dark Horse'] }
    ]);

    env.state.currentView = 'publishers';
    env.state.currentRootFolder = '/comics/main';
    env.state.library = {
      '/comics/main': {
        publishers: {
          'DC': { series: { 'Batman': [{ id: 1 }] } },
          'Marvel': { series: { 'Spider-Man': [{ id: 2 }] } }
        }
      }
    };

    updateReadingListFilterButtonCount();

    const btn = document.getElementById('dynamic-reading-list-filter-btn');
    const count = document.getElementById('dynamic-reading-list-filter-count');

    expect(btn.classList.contains('hidden')).toBe(true);
    expect(count.textContent).toBe('0');
  });

  test('filterPublishersByActiveFilter filters out publishers without reading lists when activeSmartFilter is reading-list', () => {
    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const filterPublishersByActiveFilter = env.sandbox.filterPublishersByActiveFilter;

    setCachedReadingLists([
      { id: 'list-1', name: 'Batman Saga', publishers: ['DC'] }
    ]);

    env.state.activeSmartFilter = 'reading-list';
    env.state.activeFilter = 'all';

    const publishers = {
      'DC': {
        series: {
          'Batman': [{ id: 1, progress: { totalPages: 10, lastReadPage: 0 } }]
        }
      },
      'Marvel': {
        series: {
          'Spider-Man': [{ id: 2, progress: { totalPages: 10, lastReadPage: 0 } }]
        }
      },
      'Image': {
        series: {
          'Spawn': [{ id: 3, progress: { totalPages: 10, lastReadPage: 0 } }]
        }
      }
    };

    const filtered = filterPublishersByActiveFilter(publishers);
    expect(Object.keys(filtered)).toEqual(['DC']);
  });

  test('filterPublishersByActiveFilter returns all publishers when activeSmartFilter is null', () => {
    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const filterPublishersByActiveFilter = env.sandbox.filterPublishersByActiveFilter;

    setCachedReadingLists([
      { id: 'list-1', name: 'Batman Saga', publishers: ['DC'] }
    ]);

    env.state.activeSmartFilter = null;
    env.state.activeFilter = 'all';

    const publishers = {
      'DC': {
        series: {
          'Batman': [{ id: 1, progress: { totalPages: 10, lastReadPage: 0 } }]
        }
      },
      'Marvel': {
        series: {
          'Spider-Man': [{ id: 2, progress: { totalPages: 10, lastReadPage: 0 } }]
        }
      }
    };

    const filtered = filterPublishersByActiveFilter(publishers);
    expect(Object.keys(filtered)).toEqual(['DC', 'Marvel']);
  });
});
