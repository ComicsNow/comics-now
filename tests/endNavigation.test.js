/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('End of Comic Navigation & Side-by-Side Reading List / Series', () => {
  let sandbox;
  let dom;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="end-of-comic-navigation" class="hidden">
        <div id="end-nav-buttons">
          <button id="next-in-series-btn" class="hidden"></button>
          <button id="next-in-reading-list-btn" class="hidden"></button>
        </div>
      </div>
      <div id="fullscreen-end-of-comic-navigation" class="hidden">
        <div id="fullscreen-end-nav-buttons">
          <button id="fullscreen-next-in-series-btn" class="hidden"></button>
          <button id="fullscreen-next-in-reading-list-btn" class="hidden"></button>
        </div>
      </div>
    `;

    const state = {
      currentPageIndex: 9,
      getPageCounterTotal: () => 10,
      currentComic: { id: 'c1', series: 'Test Series', publisher: 'Image', rootFolder: '/comics' },
      viewerReturnContext: {},
      library: {
        '/comics': {
          publishers: {
            'Image': {
              series: {
                'Test Series': [
                  { id: 'c1', series: 'Test Series' },
                  { id: 'c2', series: 'Test Series' }
                ]
              }
            }
          }
        }
      },
      getSeriesComics: jest.fn().mockResolvedValue([
        { id: 'c1', series: 'Test Series' },
        { id: 'c2', series: 'Test Series' }
      ]),
      getComicById: jest.fn(id => ({ id, name: `Comic ${id}` })),
      openComicViewer: jest.fn(),
      ReadingLists: {
        getReadingLists: jest.fn(),
        getReadingListDetails: jest.fn()
      }
    };

    sandbox = {
      window,
      document,
      state,
      console,
      fetch: jest.fn()
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    const fullPath = path.resolve(__dirname, '../public/js/viewer/end-navigation.js');
    const content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+let\s+/g, 'let ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '');

    vm.runInContext(cleanContent, sandbox);
  });

  it('renders both Next in Series and Next in Reading List side-by-side when both exist', async () => {
    sandbox.state.viewerReturnContext = {
      readingListId: 'list-1',
      readingListName: 'My Reading List'
    };

    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      ok: true,
      items: [
        { comicId: 'c1', sortOrder: 0 },
        { comicId: 'rl-c2', sortOrder: 1 }
      ]
    });

    await sandbox.state.updateEndOfComicNavigation();

    const nav = document.getElementById('end-of-comic-navigation');
    const seriesBtn = document.getElementById('next-in-series-btn');
    const readingListBtn = document.getElementById('next-in-reading-list-btn');

    expect(nav.classList.contains('hidden')).toBe(false);
    expect(seriesBtn.classList.contains('hidden')).toBe(false);
    expect(readingListBtn.classList.contains('hidden')).toBe(false);

    // Verify click handlers
    seriesBtn.click();
    expect(sandbox.state.openComicViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2' }),
      {}
    );

    readingListBtn.click();
    expect(sandbox.state.openComicViewer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rl-c2' }),
      expect.objectContaining({ readingListId: 'list-1' })
    );
  });

  it('dynamically follows reading list order when sortOrder changes', async () => {
    sandbox.state.viewerReturnContext = {
      readingListId: 'list-1',
      readingListName: 'My Reading List'
    };

    // First order: c1 -> rl-c2 -> rl-c3
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValueOnce({
      ok: true,
      items: [
        { comicId: 'c1', sortOrder: 0 },
        { comicId: 'rl-c2', sortOrder: 1 },
        { comicId: 'rl-c3', sortOrder: 2 }
      ]
    });

    let nextComic = await sandbox.state.getNextComicInReadingList();
    expect(nextComic.id).toBe('rl-c2');

    // Reordered order: c1 -> rl-c3 -> rl-c2
    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValueOnce({
      ok: true,
      items: [
        { comicId: 'c1', sortOrder: 0 },
        { comicId: 'rl-c3', sortOrder: 1 },
        { comicId: 'rl-c2', sortOrder: 2 }
      ]
    });

    nextComic = await sandbox.state.getNextComicInReadingList();
    expect(nextComic.id).toBe('rl-c3');
  });

  it('does NOT suppress Next in Series when in a reading list', async () => {
    sandbox.state.viewerReturnContext = {
      readingListId: 'list-1'
    };

    const nextInSeries = await sandbox.state.getNextComicInSeries();
    expect(nextInSeries).not.toBeNull();
    expect(nextInSeries.id).toBe('c2');
  });

  it('falls back to search reading lists if readingListId was not in viewerReturnContext', async () => {
    sandbox.state.viewerReturnContext = {};

    sandbox.state.ReadingLists.getReadingLists.mockResolvedValueOnce([
      { id: 'list-auto', name: 'Discovered List' }
    ]);

    sandbox.state.ReadingLists.getReadingListDetails.mockResolvedValue({
      ok: true,
      items: [
        { comicId: 'c1', sortOrder: 0 },
        { comicId: 'fallback-next', sortOrder: 1 }
      ]
    });

    const nextComic = await sandbox.state.getNextComicInReadingList();
    expect(nextComic).not.toBeNull();
    expect(nextComic.id).toBe('fallback-next');
    expect(nextComic._readingListContext.readingListId).toBe('list-auto');
  });
});
