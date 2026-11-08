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
    syncSmartFilterButtons: jest.fn(),
    mountSmartFilterHostInto: jest.fn(),
    updateBreadcrumb: jest.fn(),
    showView: jest.fn(),
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
    env.loadFile('../public/js/library/smartlists/predicates.js');
    env.loadFile('../public/js/library/smartlists/publisher-match.js');
    env.loadFile('../public/js/library/smartlists/downloaded.js');
    env.loadFile('../public/js/library/smartlists/counters.js');
    env.loadFile('../public/js/library/smartlists.js');
    env.loadFile('../public/js/library/status/calculator.js');
    env.loadFile('../public/js/library/status/dom-sync.js');
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
    // Regression: "New England Comics" must NOT match "DC" reading lists due to accidental "dc" substring
    expect(matchesPublisher({ name: 'DC: The Flash - Creator Runs and Chronicles', publishers: ['DC Comics'] }, 'New England Comics')).toBe(false);
    expect(matchesPublisher({ name: 'DC: Harley Quinn and Poison Ivy', publishers: ['DC Comics'] }, 'New England Comics')).toBe(false);
    expect(matchesPublisher({ name: 'New England Comics: The Tick - Complete Chronology', publishers: ['New England Comics'] }, 'New England Comics')).toBe(true);
    expect(matchesPublisher({ name: 'The Tick: The Eli Stone Saga', publishers: ['New England Comics'] }, 'New England Comics')).toBe(true);
    expect(matchesPublisher({ name: 'DC Event: Crisis on Infinite Earths', publishers: ['DC Comics'] }, 'DC Comics')).toBe(true);
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
    expect(count.textContent).toBe('2'); // displays all reading lists across library
  });

  test('updateReadingListFilterButtonCount hides button on publisher view when no reading lists exist', () => {
    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const updateReadingListFilterButtonCount = env.sandbox.updateReadingListFilterButtonCount;

    setCachedReadingLists([]);

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

  test('showPublisherList with activeSmartFilter reading-list invokes renderPublisherReadingLists(null, container)', () => {
    document.body.innerHTML += `
      <div id="publisher-list"></div>
      <div id="publisher-list-container"></div>
      <div id="publisher-title"></div>
      <div id="publisher-alpha-filter"></div>
    `;

    const mockRenderPublisherReadingLists = jest.fn();
    env.sandbox.renderPublisherReadingLists = mockRenderPublisherReadingLists;
    env.sandbox.publisherListDiv = document.getElementById('publisher-list');
    env.sandbox.publisherListContainer = document.getElementById('publisher-list-container');
    env.sandbox.publisherTitleH2 = document.getElementById('publisher-title');
    env.sandbox.publisherAlphaFilter = document.getElementById('publisher-alpha-filter');
    env.sandbox.clearElement = jest.fn();
    env.sandbox.filterPublishersByActiveFilter = jest.fn(pubs => pubs);
    env.sandbox.showView = jest.fn();
    env.sandbox.mountSmartFilterHostInto = jest.fn();
    env.sandbox.updateBreadcrumb = jest.fn();
    env.sandbox.syncSmartFilterButtons = jest.fn();
    env.sandbox.renderAlphaFilter = jest.fn();

    env.loadFile('../public/js/library/render/publishers.js');

    env.state.library = {
      '/comics/main': {
        publishers: {
          'DC': { series: {} },
          'Marvel': { series: {} }
        }
      }
    };
    env.state.currentRootFolder = '/comics/main';
    env.state.activeSmartFilter = 'reading-list';

    const showPublisherList = env.sandbox.showPublisherList;
    showPublisherList('/comics/main', { force: true });

    expect(mockRenderPublisherReadingLists).toHaveBeenCalledWith(null, env.sandbox.publisherListContainer);
  });

  test('renderPublisherReadingLists(null) renders all cached reading lists across publishers', () => {
    document.body.innerHTML = `
      <div id="publisher-list-container"></div>
    `;

    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    setCachedReadingLists([
      { id: 'list-1', name: 'Batman Saga', publishers: ['DC'], totalComics: 5, readComics: 0 },
      { id: 'list-2', name: 'Spider-Verse', publishers: ['Marvel'], totalComics: 10, readComics: 5 },
      { id: 'list-3', name: 'Spawn Origins', publishers: ['Image'], totalComics: 8, readComics: 8 }
    ]);

    env.state.currentView = 'publishers';
    env.sandbox.safeHtml = (strings, ...values) => ({ html: strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''), __isRawHtml: true });
    env.sandbox.safeRaw = (str) => str;
    env.sandbox.escapeHtml = (str) => str;
    env.sandbox.API_BASE_URL = '';

    env.loadFile('../public/js/library/render/reading-lists.js');

    const renderPublisherReadingLists = env.sandbox.renderPublisherReadingLists;
    const container = document.getElementById('publisher-list-container');

    renderPublisherReadingLists(null, container);

    // Default status filter is 'in-progress' -> 1 card
    const initialCards = container.querySelectorAll('.reading-list-card');
    expect(initialCards.length).toBe(1);

    const filterBar = document.getElementById('reading-lists-status-filter');
    expect(filterBar).not.toBeNull();

    // Click 'All (3)' status button
    const allBtn = filterBar.querySelector('button[data-status="all"]');
    expect(allBtn).not.toBeNull();
    allBtn.click();

    const allCards = container.querySelectorAll('.reading-list-card');
    expect(allCards.length).toBe(3);
  });

  test('on root (Libraries) view, button displays all reading lists count and showRootFolderList renders full reading lists', () => {
    document.body.innerHTML += `
      <div id="root-folder-list"></div>
      <div id="root-folder-list-container"></div>
    `;

    const mockRenderPublisherReadingLists = jest.fn();
    env.sandbox.renderPublisherReadingLists = mockRenderPublisherReadingLists;
    env.sandbox.rootFolderListDiv = document.getElementById('root-folder-list');
    env.sandbox.rootFolderListContainer = document.getElementById('root-folder-list-container');
    env.sandbox.clearElement = jest.fn();
    env.sandbox.createEmptyMessage = jest.fn();

    env.loadFile('../public/js/library/render/root-folders.js');

    const setCachedReadingLists = env.sandbox.setCachedReadingLists;
    const updateReadingListFilterButtonCount = env.sandbox.updateReadingListFilterButtonCount;

    setCachedReadingLists([
      { id: 'list-1', name: 'Batman Saga', publishers: ['DC'] },
      { id: 'list-2', name: 'Spider-Verse', publishers: ['Marvel'] }
    ]);

    env.state.currentView = 'root';
    updateReadingListFilterButtonCount();

    const span = document.getElementById('dynamic-reading-list-filter-count');
    const btn = document.getElementById('dynamic-reading-list-filter-btn');

    expect(span.textContent).toBe('2');
    expect(btn.classList.contains('hidden')).toBe(false);

    // Verify breadcrumb returning to Libraries unselects activeSmartFilter
    env.state.activeSmartFilter = 'reading-list';
    const showRootFolderList = env.sandbox.showRootFolderList;
    showRootFolderList({ force: true }); // without preserveSmartFilter
    expect(env.state.activeSmartFilter).toBeNull();

    // Verify selecting reading-list in root view calls renderPublisherReadingLists(null, container)
    env.state.activeSmartFilter = 'reading-list';
    showRootFolderList({ force: true, preserveSmartFilter: true });
    expect(mockRenderPublisherReadingLists).toHaveBeenCalledWith(null, env.sandbox.rootFolderListContainer);
  });
});
