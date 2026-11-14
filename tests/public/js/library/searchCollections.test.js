/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSearchSandboxes({ online = true, fetchImpl = null, cachedReadingLists = [], cachedStoryArcs = [] } = {}) {
  const readingListCardClicks = [];
  const storyArcCardClicks = [];
  const renderComicCards = jest.fn();
  const state = {
    API_BASE_URL: '',
    searchViewMode: 'list',
    cachedReadingLists,
    cachedStoryArcs,
    comicIdMap: new Map([
      ['c1', { id: 'c1', name: 'Crisis #1.cbz', series: 'Crisis on Infinite Earths', publisher: 'DC Comics', metadata: { Title: 'Crisis #1' } }]
    ]),
    renderComicCards,
    showView: jest.fn((v) => { if (v) v.classList.remove('hidden'); }),
    createReadingListCard: (list) => {
      const el = document.createElement('div');
      el.className = 'reading-list-card';
      el.textContent = list.name;
      el.addEventListener('click', () => readingListCardClicks.push(list.id));
      return el;
    },
    createStoryArcCard: (arc) => {
      const el = document.createElement('div');
      el.className = 'story-arc-card';
      el.textContent = arc.title;
      el.addEventListener('click', () => storyArcCardClicks.push(arc.id));
      return el;
    }
  };

  const sandbox = {
    window: null,
    document,
    navigator: { onLine: online },
    fetch: fetchImpl || jest.fn(),
    state,
    comicIdMap: state.comicIdMap,
    clearElement: (el) => { if (el) el.replaceChildren(); },
    render: (el, content) => {
      if (!el) return;
      el.innerHTML = (content && typeof content.toHTML === 'function') ? content.toHTML() : String(content ?? '');
    },
    html: (strings, ...values) => {
      const out = strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i] ?? '') : ''), '');
      return { toHTML: () => out, html: out, __isRawHtml: true };
    },
    escapeHtml: (s) => String(s ?? ''),
    safeDirName: (s) => String(s ?? ''),
    getRelativePath: () => '/',
    createLoadingMessage: (m) => `<div>${m}</div>`,
    createEmptyMessage: (m) => `<div>${m}</div>`,
    searchResultsView: document.getElementById('search-results-view'),
    searchResultsTitle: document.getElementById('search-results-title'),
    searchResultsContainer: document.getElementById('search-results-container'),
    rootFolderListDiv: document.getElementById('root-folder-list'),
    publisherListDiv: document.getElementById('publisher-list'),
    seriesListDiv: document.getElementById('series-list'),
    comicListDiv: document.getElementById('comic-list'),
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const loadFile = (relPath) => {
    const fullPath = path.resolve(__dirname, '../../../..', relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing module: ${relPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8')
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '');
    vm.runInContext(content, sandbox);
  };

  loadFile('public/js/library/search-collections.js');
  loadFile('public/js/library/search.js');

  return { sandbox, state, renderComicCards };
}

describe('Search Reading Lists & Story Arcs', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="root-folder-list"></div>
      <div id="publisher-list" class="hidden"></div>
      <div id="series-list" class="hidden"></div>
      <div id="comic-list" class="hidden"></div>
      <div id="search-results-view" class="hidden">
        <h2 id="search-results-title"></h2>
        <div id="search-results-container"></div>
      </div>
    `;
  });

  it('includes reading-list and story-arc options in #library-search-field dropdown', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../../../public/index.html'), 'utf8');
    const selectMatch = html.match(/<select id="library-search-field"[\s\S]*?<\/select>/);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch[0]).toContain('value="reading-list"');
    expect(selectMatch[0]).toContain('value="story-arc"');
  });

  it('filters reading lists and deduplicates __collections story arcs', () => {
    const { sandbox } = loadSearchSandboxes();

    const lists = [
      { id: 'rl1', name: 'Absolute Universe', description: 'DC reboot', publishers: ['DC Comics'] },
      { id: 'rl2', name: 'Spider-Verse', description: 'Multiverse event', publishers: ['Marvel'] }
    ];
    expect(sandbox.filterReadingListsByQuery(lists, 'absolute').map((l) => l.id)).toEqual(['rl1']);
    expect(sandbox.filterReadingListsByQuery(lists, 'marvel').map((l) => l.id)).toEqual(['rl2']);

    const arcs = [
      { id: 'crisis', arcId: 'crisis', title: 'Crisis on Infinite Earths', publisher: 'DC Comics', description: '1985 event' },
      { id: 'crisis__collections', arcId: 'crisis', title: 'Crisis on Infinite Earths', publisher: 'DC Comics', description: '1985 event' },
      { id: 'civil-war', arcId: 'civil-war', title: 'Civil War', publisher: 'Marvel', description: '2006 event' }
    ];
    expect(sandbox.filterStoryArcsByQuery(arcs, 'crisis').map((a) => a.id)).toEqual(['crisis']);
  });

  it('searches only reading lists when field is "reading-list"', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('/api/v1/reading-lists')) {
        return {
          ok: true,
          json: async () => [{ id: 'rl1', name: 'Absolute Universe', description: 'DC', totalComics: 10 }]
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { sandbox, renderComicCards } = loadSearchSandboxes({ fetchImpl: fetchMock });
    await sandbox.showSearchView('Absolute', 'reading-list');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/reading-lists');
    expect(renderComicCards).not.toHaveBeenCalled();
    expect(document.querySelectorAll('#search-results-container .reading-list-card').length).toBe(1);
  });

  it('searches only story arcs when field is "story-arc"', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('/api/v1/story-arcs')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            storyArcs: [
              { id: '52', arcId: '52', title: '52', publisher: 'DC Comics', totalIssues: 1 },
              { id: '52__collections', arcId: '52', title: '52', publisher: 'DC Comics', totalIssues: 1 }
            ]
          })
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { sandbox, renderComicCards } = loadSearchSandboxes({ fetchImpl: fetchMock });
    await sandbox.showSearchView('52', 'story-arc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/story-arcs');
    expect(renderComicCards).not.toHaveBeenCalled();
    expect(document.querySelectorAll('#search-results-container .story-arc-card').length).toBe(1);
  });

  it('searches comics, reading lists, and story arcs together when field is "all"', async () => {
    const fetchMock = jest.fn(async (url) => {
      if (url.includes('/api/v1/search')) {
        return {
          ok: true,
          json: async () => [{ id: 'c1', name: 'Crisis #1.cbz', series: 'Crisis', publisher: 'DC Comics' }]
        };
      }
      if (url.includes('/api/v1/reading-lists')) {
        return {
          ok: true,
          json: async () => [{ id: 'rl1', name: 'Crisis Reading Order', totalComics: 12 }]
        };
      }
      if (url.includes('/api/v1/story-arcs')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            storyArcs: [{ id: 'crisis', arcId: 'crisis', title: 'Crisis on Infinite Earths', publisher: 'DC Comics' }]
          })
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    const { sandbox, renderComicCards } = loadSearchSandboxes({ fetchImpl: fetchMock });
    await sandbox.showSearchView('Crisis', 'all');

    expect(document.querySelectorAll('#search-results-container .reading-list-card').length).toBe(1);
    expect(document.querySelectorAll('#search-results-container .story-arc-card').length).toBe(1);
    expect(renderComicCards).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'c1' })]),
      'search',
      expect.any(HTMLElement)
    );
  });
});
