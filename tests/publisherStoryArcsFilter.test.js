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
    showView: jest.fn(),
    mountSmartFilterHostInto: jest.fn(),
    updateBreadcrumb: jest.fn(),
    syncSmartFilterButtons: jest.fn(),
    updateFilterButtonCounts: jest.fn()
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

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

describe('Story Arcs Button Count and View Scoping', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="dynamic-story-arc-filter-btn" class="hidden">
        <span id="dynamic-story-arc-filter-label">Story Arcs</span>
        <span id="dynamic-story-arc-filter-count">0</span>
      </div>
      <div id="smart-list-buttons"></div>
    `;

    env = createModuleSandbox();
    env.loadFile('../public/js/settings/story-arc-reader-settings.js');
    env.loadFile('../public/js/library/smartlists/publisher-match.js');
    env.loadFile('../public/js/library/smartlists/story-arcs.js');
  });

  test('on series view, button displays publisher-scoped count', () => {
    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchStoryArcsForPublisher = env.sandbox.fetchStoryArcsForPublisher;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Knightfall', publisher: 'DC Comics' },
          { id: 'arc-2', title: 'Court of Owls', publisher: 'DC Comics' }
        ]
      })
    });

    // Populate publisher arcs cache
    return fetchStoryArcsForPublisher('DC Comics').then(() => {
      env.state.currentView = 'series';
      env.state.currentPublisher = 'DC Comics';

      updateStoryArcFilterButtonCount();

      const span = document.getElementById('dynamic-story-arc-filter-count');
      const btn = document.getElementById('dynamic-story-arc-filter-btn');

      expect(span.textContent).toBe('2');
      expect(btn.classList.contains('hidden')).toBe(false);

      // Check different publisher with 0 arcs
      env.state.currentPublisher = 'Image Comics';
      updateStoryArcFilterButtonCount();
      expect(span.textContent).toBe('0');
      expect(btn.classList.contains('hidden')).toBe(true);
    });
  });

  test('on publisher view, button displays all-arcs count across library', () => {
    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchAllStoryArcs = env.sandbox.fetchAllStoryArcs;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Knightfall', publisher: 'DC Comics' },
          { id: 'arc-2', title: 'Spider-Verse', publisher: 'Marvel' },
          { id: 'arc-3', title: 'Spawn/Batman', publisher: 'Image Comics' }
        ]
      })
    });

    return fetchAllStoryArcs().then(() => {
      env.state.currentView = 'publishers';
      env.state.currentRootFolder = '/comics/main';
      env.state.library = {
        '/comics/main': {
          publishers: {
            'DC Comics': {},
            'Marvel': {},
            'Image Comics': {}
          }
        }
      };
      env.state.currentPublisher = null;

      updateStoryArcFilterButtonCount();

      const span = document.getElementById('dynamic-story-arc-filter-count');
      const btn = document.getElementById('dynamic-story-arc-filter-btn');

      expect(span.textContent).toBe('3');
      expect(btn.classList.contains('hidden')).toBe(false);
    });
  });

  test('on comics view, button is always hidden even if story arcs exist', () => {
    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchAllStoryArcs = env.sandbox.fetchAllStoryArcs;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Knightfall', publisher: 'DC Comics' }
        ]
      })
    });

    return fetchAllStoryArcs().then(() => {
      env.state.currentView = 'comics';
      env.state.currentSeries = 'Batman';
      env.state.currentPublisher = 'DC Comics';

      updateStoryArcFilterButtonCount();

      const btn = document.getElementById('dynamic-story-arc-filter-btn');
      expect(btn.classList.contains('hidden')).toBe(true);
    });
  });

  test('publisher matching normalizes aliases (e.g. Marvel matching Marvel Comics)', () => {
    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchAllStoryArcs = env.sandbox.fetchAllStoryArcs;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Civil War', publisher: 'Marvel Comics' }
        ]
      })
    });

    return fetchAllStoryArcs().then(() => {
      env.state.currentView = 'series';
      env.state.currentPublisher = 'Marvel';

      updateStoryArcFilterButtonCount();

      const span = document.getElementById('dynamic-story-arc-filter-count');
      const btn = document.getElementById('dynamic-story-arc-filter-btn');

      expect(span.textContent).toBe('1');
      expect(btn.classList.contains('hidden')).toBe(false);
    });
  });

  test('on series view, if publisher has 0 arcs, button is hidden and activeSmartFilter is cleared', () => {
    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchAllStoryArcs = env.sandbox.fetchAllStoryArcs;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Knightfall', publisher: 'DC Comics' }
        ]
      })
    });

    return fetchAllStoryArcs().then(() => {
      env.state.currentView = 'series';
      env.state.currentPublisher = 'Dark Horse Comics';
      env.state.activeSmartFilter = 'story-arc';

      updateStoryArcFilterButtonCount();

      const span = document.getElementById('dynamic-story-arc-filter-count');
      const btn = document.getElementById('dynamic-story-arc-filter-btn');

      expect(span.textContent).toBe('0');
      expect(btn.classList.contains('hidden')).toBe(true);
      expect(env.state.activeSmartFilter).toBeNull();
    });
  });

  test('showPublisherList with activeSmartFilter story-arc invokes renderPublisherStoryArcs(null)', () => {
    document.body.innerHTML += `
      <div id="publisher-list"></div>
      <div id="publisher-list-container"></div>
      <div id="publisher-title"></div>
      <div id="publisher-alpha-filter"></div>
    `;

    const mockRenderPublisherStoryArcs = jest.fn();
    env.sandbox.renderPublisherStoryArcs = mockRenderPublisherStoryArcs;
    env.sandbox.publisherListDiv = document.getElementById('publisher-list');
    env.sandbox.publisherListContainer = document.getElementById('publisher-list-container');
    env.sandbox.publisherTitleH2 = document.getElementById('publisher-title');
    env.sandbox.publisherAlphaFilter = document.getElementById('publisher-alpha-filter');
    env.sandbox.clearElement = jest.fn();
    env.sandbox.filterPublishersByActiveFilter = jest.fn(pubs => pubs);

    env.loadFile('../public/js/library/render/publishers.js');

    env.state.library = {
      '/comics/main': {
        publishers: {
          'DC Comics': { series: {} },
          'Marvel': { series: {} }
        }
      }
    };
    env.state.currentRootFolder = '/comics/main';
    env.state.activeSmartFilter = 'story-arc';

    const showPublisherList = env.sandbox.showPublisherList;
    showPublisherList('/comics/main', { force: true });

    expect(mockRenderPublisherStoryArcs).toHaveBeenCalledWith(null, env.sandbox.publisherListContainer);
  });

  test('showSeriesList with activeSmartFilter story-arc invokes renderPublisherStoryArcs(publisherName)', () => {
    document.body.innerHTML += `
      <div id="series-list"></div>
      <div id="series-list-container"></div>
      <div id="series-title"></div>
      <div id="series-alpha-filter"></div>
      <div id="series-sort-container"></div>
      <div id="smart-scope-mode-toggle"></div>
    `;

    const mockRenderPublisherStoryArcs = jest.fn();
    env.sandbox.renderPublisherStoryArcs = mockRenderPublisherStoryArcs;
    env.sandbox.seriesListDiv = document.getElementById('series-list');
    env.sandbox.seriesTitleH2 = document.getElementById('series-title');
    env.sandbox.seriesAlphaFilter = document.getElementById('series-alpha-filter');
    env.sandbox.clearElement = jest.fn();
    env.sandbox.filterSeriesByActiveFilter = jest.fn(s => s);

    env.loadFile('../public/js/library/render/series.js');

    env.state.library = {
      '/comics/main': {
        publishers: {
          'DC Comics': {
            series: {
              'Batman': [{ id: 1 }],
              'Detective Comics': [{ id: 2 }]
            }
          }
        }
      }
    };
    env.state.currentRootFolder = '/comics/main';
    env.state.activeSmartFilter = 'story-arc';

    const showSeriesList = env.sandbox.showSeriesList;
    showSeriesList('DC Comics', { force: true });

    expect(mockRenderPublisherStoryArcs).toHaveBeenCalledWith('DC Comics');
  });

  test('on root (Libraries) view, button displays all-arcs count and showRootFolderList renders full story arcs', () => {
    document.body.innerHTML += `
      <div id="root-folder-list"></div>
      <div id="root-folder-list-container"></div>
    `;

    const mockRenderPublisherStoryArcs = jest.fn();
    env.sandbox.renderPublisherStoryArcs = mockRenderPublisherStoryArcs;
    env.sandbox.rootFolderListDiv = document.getElementById('root-folder-list');
    env.sandbox.rootFolderListContainer = document.getElementById('root-folder-list-container');
    env.sandbox.clearElement = jest.fn();
    env.sandbox.createEmptyMessage = jest.fn();

    env.loadFile('../public/js/library/render/root-folders.js');

    const updateStoryArcFilterButtonCount = env.sandbox.updateStoryArcFilterButtonCount;
    const fetchAllStoryArcs = env.sandbox.fetchAllStoryArcs;

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [
          { id: 'arc-1', title: 'Knightfall', publisher: 'DC Comics' },
          { id: 'arc-2', title: 'Civil War', publisher: 'Marvel' }
        ]
      })
    });

    return fetchAllStoryArcs().then(() => {
      env.state.currentView = 'root';
      updateStoryArcFilterButtonCount();

      const span = document.getElementById('dynamic-story-arc-filter-count');
      const btn = document.getElementById('dynamic-story-arc-filter-btn');

      expect(span.textContent).toBe('2');
      expect(btn.classList.contains('hidden')).toBe(false);

      // Verify breadcrumb returning to Libraries unselects activeSmartFilter
      env.state.activeSmartFilter = 'story-arc';
      const showRootFolderList = env.sandbox.showRootFolderList;
      showRootFolderList({ force: true }); // without preserveSmartFilter
      expect(env.state.activeSmartFilter).toBeNull();

      // Verify selecting story-arc in root view calls renderPublisherStoryArcs(null, container)
      env.state.activeSmartFilter = 'story-arc';
      showRootFolderList({ force: true, preserveSmartFilter: true });
      expect(mockRenderPublisherStoryArcs).toHaveBeenCalledWith(null, env.sandbox.rootFolderListContainer);
    });
  });
});
