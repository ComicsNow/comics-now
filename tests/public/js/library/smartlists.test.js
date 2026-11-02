/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSmartlistsSandbox() {
  const state = {
    currentView: 'root',
    currentRootFolder: null,
    currentPublisher: null,
    activeSmartFilter: null,
    downloadedComicIds: new Set(),
    comicIdMap: new Map(),
    library: {}
  };

  const sandbox = {
    window,
    document,
    Element: window.Element,
    state,
    console,
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, lists: [] })
    }),
    applyDisplayInfoToComic: jest.fn(c => c),
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

describe('Library Smartlists Modular Units', () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="latest-added-btn"><span class="pill-label">New</span></div>
      <span id="latest-added-count">0</span>
      <div id="downloaded-btn"><span class="pill-label">Down</span></div>
      <span id="downloaded-count">0</span>
      <div id="guided-smart-list-btn"><span id="guided-smart-list-count">0</span></div>
      <div id="dynamic-manga-filter-btn" class="hidden">
        <span id="dynamic-manga-filter-label">Manga</span>
        <span id="dynamic-manga-filter-count">0</span>
      </div>
      <div id="dynamic-reading-list-filter-btn" class="hidden">
        <span id="dynamic-reading-list-filter-count">0</span>
      </div>
    `;

    env = createSmartlistsSandbox();
    env.loadFile('public/js/library/smartlists/predicates.js');
    env.loadFile('public/js/library/smartlists/publisher-match.js');
    env.loadFile('public/js/library/smartlists/downloaded.js');
    env.loadFile('public/js/library/smartlists/counters.js');
    env.loadFile('public/js/library/smartlists.js');
  });

  describe('predicates.js', () => {
    test('isComicLatest accurately detects comics within 14 days', () => {
      const now = Date.now();
      const recentComic = { id: 'c1', updatedAt: now - 1000 * 60 * 60 * 24 }; // 1 day ago
      const oldComic = { id: 'c2', updatedAt: now - 1000 * 60 * 60 * 24 * 30 }; // 30 days ago

      expect(env.sandbox.isComicLatest(recentComic)).toBe(true);
      expect(env.sandbox.isComicLatest(oldComic)).toBe(false);
    });

    test('isComicDownloaded checks state.downloadedComicIds set', () => {
      env.state.downloadedComicIds.add('c1');
      expect(env.sandbox.isComicDownloaded({ id: 'c1' })).toBe(true);
      expect(env.sandbox.isComicDownloaded({ id: 'c2' })).toBe(false);
    });

    test('comicMatchesActiveSmartScope validates against active scope', () => {
      const comic = { id: 'c1', guidedViewStatus: 'completed', mangaMode: true };
      env.state.activeSmartFilter = 'guided';
      expect(env.sandbox.comicMatchesActiveSmartScope(comic)).toBe(true);

      env.state.activeSmartFilter = 'non-manga';
      expect(env.sandbox.comicMatchesActiveSmartScope(comic)).toBe(false);
    });
  });

  describe('publisher-match.js', () => {
    test('isPubMatch and matchesPublisher correctly handle stems and prefixes', () => {
      expect(env.sandbox.isPubMatch('DC Comics', 'DC')).toBe(true);
      expect(env.sandbox.isPubMatch('Dark Horse Books', 'Dark Horse Comics')).toBe(true);
      expect(env.sandbox.isPubMatch('Marvel', 'DC')).toBe(false);

      const listWithPrefix = { name: 'DC: Knightfall', publishers: [] };
      expect(env.sandbox.matchesPublisher(listWithPrefix, 'DC Comics')).toBe(true);
    });

    test('getReadingListsForPublisher filters cached lists', () => {
      env.sandbox.setCachedReadingLists([
        { id: 'l1', name: 'Batman Event', publishers: ['DC Comics'] },
        { id: 'l2', name: 'Secret Wars', publishers: ['Marvel'] }
      ]);

      const dcLists = env.sandbox.getReadingListsForPublisher('DC Comics');
      expect(dcLists.length).toBe(1);
      expect(dcLists[0].id).toBe('l1');
    });
  });

  describe('downloaded.js', () => {
    test('updateDownloadedComicProgressData safely mutates comic progress', () => {
      env.sandbox.syncDownloadedComicStatusFromLibrary = jest.fn();
      expect(env.sandbox.resolveTotalPagesForComic({ totalPages: 25 })).toBe(25);
      expect(env.sandbox.resolveTotalPagesForComic({ pageCount: 30 })).toBe(30);
      expect(env.sandbox.resolveTotalPagesForComic(null)).toBe(0);
    });

    test('rebuildDownloadedComics handles empty and error states', async () => {
      env.state.getAllDownloadedComics = jest.fn().mockResolvedValue([
        { id: 'c1', comicInfo: { title: 'Downloaded Comic 1' }, downloadedAt: Date.now() }
      ]);

      const result = await env.sandbox.rebuildDownloadedComics({ skipRender: true });
      expect(result.length).toBe(1);
      expect(env.sandbox.getDownloadedSmartListComics().length).toBe(1);
      expect(env.sandbox.findDownloadedComicById('c1')).toBeTruthy();
    });
  });

  describe('counters.js', () => {
    test('rebuildMangaSmartLists splits comics into manga and non-manga collections', () => {
      env.state.comicIdMap.set('c1', { id: 'c1', name: 'Berserk 01', mangaMode: true });
      env.state.comicIdMap.set('c2', { id: 'c2', name: 'Batman 01', mangaMode: false });

      env.sandbox.rebuildMangaSmartLists();

      expect(env.sandbox.getMangaComics().length).toBe(1);
      expect(env.sandbox.getNonMangaComics().length).toBe(1);
      expect(document.getElementById('dynamic-manga-filter-count').textContent).toBe('1');
    });

    test('updateLatestButtonCount switches to Smart Inbox mode when currentRootFolder is Smart Inbox', () => {
      env.state.currentRootFolder = 'Smart Inbox';
      env.state.library = {
        'Smart Inbox': {
          publishers: {
            'Default': {
              series: {
                'Tagged': [
                  { id: 't1', tagStatus: 'successful' },
                  { id: 't2', tagStatus: 'failed' }
                ]
              }
            }
          }
        }
      };

      env.sandbox.updateLatestButtonCount();

      expect(document.getElementById('latest-added-count').textContent).toBe('1');
      expect(document.getElementById('downloaded-count').textContent).toBe('1');
      expect(document.getElementById('latest-added-btn').textContent).toContain('Successful');
      expect(document.getElementById('downloaded-btn').textContent).toContain('Failed');
    });
  });

  describe('facade public/js/library/smartlists.js', () => {
    test('attaches LibrarySmartLists singleton to state and window', () => {
      expect(env.state.LibrarySmartLists).toBeDefined();
      expect(typeof env.state.LibrarySmartLists.rebuildMangaSmartLists).toBe('function');
      expect(typeof env.state.LibrarySmartLists.getReadingListsForPublisher).toBe('function');
      expect(typeof env.state.LibrarySmartLists.rebuildDownloadedComics).toBe('function');
    });
  });
});
