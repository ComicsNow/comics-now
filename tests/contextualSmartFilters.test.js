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
    currentSeries: null,
    activeSmartFilter: null,
    activeFilter: 'all',
    mangaModePreference: false,
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
  sandbox.window = sandbox;
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

describe('Contextual Smart Filters', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="latest-added-btn" class="hidden">
        <span class="pill-label">New</span>
        <span id="latest-added-count">0</span>
      </button>
      <button id="downloaded-btn" class="hidden">
        <span class="pill-label">Down</span>
        <span id="downloaded-count">0</span>
      </button>
      <button id="guided-smart-list-btn" class="hidden">
        <span class="pill-label">Guided</span>
        <span id="guided-smart-list-count">0</span>
      </button>
      <button id="dynamic-manga-filter-btn" class="hidden">
        <span class="pill-label" id="dynamic-manga-filter-label">Manga</span>
        <span id="dynamic-manga-filter-count">0</span>
      </button>
      <button id="dynamic-reading-list-filter-btn" class="hidden">
        <span class="pill-label" id="dynamic-reading-list-filter-label">Reading Lists</span>
        <span id="dynamic-reading-list-filter-count">0</span>
      </button>
      <button id="dynamic-story-arc-filter-btn" class="hidden">
        <span class="pill-label" id="dynamic-story-arc-filter-label">Story Arcs</span>
        <span id="dynamic-story-arc-filter-count">0</span>
      </button>
    `;

    env = createModuleSandbox();
    env.loadFile('../public/js/library/smartlists/predicates.js');
    env.loadFile('../public/js/library/smartlists/downloaded.js');
    env.loadFile('../public/js/library/smartlists/publisher-match.js');
    env.loadFile('../public/js/settings/story-arc-reader-settings.js');
    env.loadFile('../public/js/library/smartlists/story-arcs.js');
    env.loadFile('../public/js/library/smartlists/counters.js');
  });

  const now = Date.now();

  const mockLibrary = {
    '/comics': {
      publishers: {
        'DC': {
          series: {
            'Batman': [
              { id: 1, name: 'Batman #1', updatedAt: now, guidedViewStatus: 'completed', mangaMode: false },
              { id: 2, name: 'Batman #2', updatedAt: 0, guidedViewStatus: 'none', mangaMode: false }
            ],
            'Detective': [
              { id: 3, name: 'Detective #1', updatedAt: 0, guidedViewStatus: 'completed', mangaMode: false }
            ]
          }
        },
        'Kodansha': {
          series: {
            'Attack on Titan': [
              { id: 4, name: 'AoT #1', updatedAt: 0, guidedViewStatus: 'none', mangaMode: true },
              { id: 5, name: 'AoT #2', updatedAt: 0, guidedViewStatus: 'none', mangaMode: true }
            ]
          }
        }
      }
    }
  };

  test('in comic view (series Batman): hides filter if 0 match, hides filter if ALL match, shows filter if partial', () => {
    env.state.currentRootFolder = '/comics';
    env.state.currentPublisher = 'DC';
    env.state.currentSeries = 'Batman';
    env.state.currentView = 'comics';
    env.state.library = mockLibrary;

    env.sandbox.updateLatestButtonCount();

    const latestBtn = document.getElementById('latest-added-btn');
    const latestCount = document.getElementById('latest-added-count');
    const guidedBtn = document.getElementById('guided-smart-list-btn');
    const guidedCount = document.getElementById('guided-smart-list-count');
    const mangaBtn = document.getElementById('dynamic-manga-filter-btn');

    // Batman has 2 comics: 1 New, 1 Not New -> 1 of 2 matches -> SHOW New
    expect(latestBtn.classList.contains('hidden')).toBe(false);
    expect(latestCount.textContent).toBe('1');

    // Batman has 2 comics: 1 Guided, 1 Not Guided -> 1 of 2 matches -> SHOW Guided
    expect(guidedBtn.classList.contains('hidden')).toBe(false);
    expect(guidedCount.textContent).toBe('1');

    // Batman has 2 comics: 0 Manga -> 0 matches -> HIDE Manga
    expect(mangaBtn.classList.contains('hidden')).toBe(true);

    // Reading lists and Story arcs must NEVER appear in comic view
    const readingListBtn = document.getElementById('dynamic-reading-list-filter-btn');
    const storyArcBtn = document.getElementById('dynamic-story-arc-filter-btn');
    expect(readingListBtn.classList.contains('hidden')).toBe(true);
    expect(storyArcBtn.classList.contains('hidden')).toBe(true);
  });

  test('in comic view (series AoT): hides Manga filter when 100% of comics are manga', () => {
    env.state.currentRootFolder = '/comics';
    env.state.currentPublisher = 'Kodansha';
    env.state.currentSeries = 'Attack on Titan';
    env.state.currentView = 'comics';
    env.state.library = mockLibrary;

    env.sandbox.updateLatestButtonCount();

    const mangaBtn = document.getElementById('dynamic-manga-filter-btn');
    // AoT has 2 comics: all 2 are manga (100%) -> HIDE Manga filter (nothing to filter)
    expect(mangaBtn.classList.contains('hidden')).toBe(true);
  });

  test('in series view (publisher DC): context covers all series of DC', () => {
    env.state.currentRootFolder = '/comics';
    env.state.currentPublisher = 'DC';
    env.state.currentSeries = null;
    env.state.currentView = 'series';
    env.state.library = mockLibrary;

    env.sandbox.updateLatestButtonCount();

    const latestBtn = document.getElementById('latest-added-btn');
    const latestCount = document.getElementById('latest-added-count');
    const guidedBtn = document.getElementById('guided-smart-list-btn');
    const guidedCount = document.getElementById('guided-smart-list-count');
    const mangaBtn = document.getElementById('dynamic-manga-filter-btn');

    // DC has 3 comics total across Batman and Detective: 1 is New (1 of 3) -> SHOW New (1)
    expect(latestBtn.classList.contains('hidden')).toBe(false);
    expect(latestCount.textContent).toBe('1');

    // DC has 3 comics total: 2 are Guided (2 of 3) -> SHOW Guided (2)
    expect(guidedBtn.classList.contains('hidden')).toBe(false);
    expect(guidedCount.textContent).toBe('2');

    // DC has 3 comics total: 0 are Manga -> HIDE Manga
    expect(mangaBtn.classList.contains('hidden')).toBe(true);
  });

  test('in publisher view (/comics): context covers all publishers in root folder', () => {
    env.state.currentRootFolder = '/comics';
    env.state.currentPublisher = null;
    env.state.currentSeries = null;
    env.state.currentView = 'publishers';
    env.state.library = mockLibrary;

    env.sandbox.updateLatestButtonCount();

    const mangaBtn = document.getElementById('dynamic-manga-filter-btn');
    const mangaCount = document.getElementById('dynamic-manga-filter-count');

    // Total comics in /comics: 3 DC + 2 Kodansha = 5.
    // Manga comics = 2 (AoT #1, AoT #2) -> 2 of 5 matches -> SHOW Manga (2)
    expect(mangaBtn.classList.contains('hidden')).toBe(false);
    expect(mangaCount.textContent).toBe('2');
  });

  test('clears activeSmartFilter if user navigates to a context where the active filter is hidden', () => {
    env.state.currentRootFolder = '/comics';
    env.state.currentPublisher = 'Kodansha';
    env.state.currentSeries = 'Attack on Titan';
    env.state.currentView = 'comics';
    env.state.library = mockLibrary;
    env.state.activeSmartFilter = 'manga'; // User had manga active

    env.sandbox.updateLatestButtonCount();

    // Since Manga filter is hidden in AoT (100% manga), activeSmartFilter must reset to null
    expect(env.state.activeSmartFilter).toBeNull();
  });

  test('on root (Libraries) view: only Reading Lists and Story Arcs are visible, other smart filters are hidden', () => {
    env.state.currentRootFolder = null;
    env.state.currentPublisher = null;
    env.state.currentSeries = null;
    env.state.currentView = 'root';
    env.state.library = mockLibrary;

    // Set reading lists cache
    env.sandbox.setCachedReadingLists([{ id: 'list-1', name: 'Batman Saga' }]);

    env.sandbox.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        storyArcs: [{ id: 'arc-1', title: 'Crisis' }]
      })
    });

    return env.sandbox.fetchAllStoryArcs().then(() => {
      env.sandbox.updateLatestButtonCount();

      const latestBtn = document.getElementById('latest-added-btn');
      const downloadedBtn = document.getElementById('downloaded-btn');
      const guidedBtn = document.getElementById('guided-smart-list-btn');
      const mangaBtn = document.getElementById('dynamic-manga-filter-btn');
      const readingListBtn = document.getElementById('dynamic-reading-list-filter-btn');
      const storyArcBtn = document.getElementById('dynamic-story-arc-filter-btn');

      // Others must be hidden on library/root view
      expect(latestBtn.classList.contains('hidden')).toBe(true);
      expect(downloadedBtn.classList.contains('hidden')).toBe(true);
      expect(guidedBtn.classList.contains('hidden')).toBe(true);
      expect(mangaBtn.classList.contains('hidden')).toBe(true);

      // Reading Lists and Story Arcs must be visible
      expect(readingListBtn.classList.contains('hidden')).toBe(false);
      expect(storyArcBtn.classList.contains('hidden')).toBe(false);
    });
  });
});
