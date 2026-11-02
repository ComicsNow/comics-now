/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Viewer Navigation Module', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="search-container"></div>
      <div id="filters-container"></div>
      <div id="comic-viewer" class="hidden"></div>
      <div id="viewer-pages"></div>
      <button id="prev-page-btn"></button>
      <button id="next-page-btn"></button>
      <button id="prev-page-btn-bottom"></button>
      <button id="next-page-btn-bottom"></button>
      <span id="page-counter"></span>
      <span id="page-counter-bottom"></span>
      <input id="page-jump" />
      <input id="page-jump-bottom" />
      <h2 id="comic-title"></h2>
      <p id="comic-subtitle"></p>
    `;

    const state = {
      window: window,
      document: document,
      API_BASE_URL: 'http://localhost:3000',
      encodePath: (p) => p.replace(/\//g, '|'),
      currentView: 'root',
      currentRootFolder: null,
      currentPublisher: null,
      currentSeries: null,
      currentFolderPath: null,
      viewerReturnContext: null,
      comicViewerDiv: document.getElementById('comic-viewer'),
      viewerPagesDiv: document.getElementById('viewer-pages'),
      prevPageBtn: document.getElementById('prev-page-btn'),
      nextPageBtn: document.getElementById('next-page-btn'),
      prevPageBtnBottom: document.getElementById('prev-page-btn-bottom'),
      nextPageBtnBottom: document.getElementById('next-page-btn-bottom'),
      pageCounterSpan: document.getElementById('page-counter'),
      pageCounterSpanBottom: document.getElementById('page-counter-bottom'),
      pageJumpInput: document.getElementById('page-jump'),
      pageJumpInputBottom: document.getElementById('page-jump-bottom'),
      comicTitleH2: document.getElementById('comic-title'),
      comicSubtitleP: document.getElementById('comic-subtitle'),
      showRootFolderList: jest.fn(),
      showComicList: jest.fn(),
      showSeriesList: jest.fn(),
      showPublisherList: jest.fn(),
      showView: jest.fn(),
      updateBreadcrumb: jest.fn(),
      updateViewerPageCounter: jest.fn(),
      renderPage: jest.fn().mockResolvedValue(true),
      preloadPages: jest.fn(),
      applyDisplayInfoToComic: jest.fn((c) => ({ displayTitle: c.name || 'Test Comic' })),
      JSZip: function() {
        this.loadAsync = jest.fn().mockResolvedValue({
          files: {
            '__MACOSX/._01.jpg': { dir: false },
            '02.jpg': { dir: false },
            '01.jpg': { dir: false },
            'info.txt': { dir: false },
            'folder/': { dir: true }
          }
        });
      }
    };

    sandbox = {
      window: window,
      document: document,
      Blob: Blob,
      state: state,
      canonicalGlobal: state,
      console: console,
      navigator: { onLine: true },
      sessionStorage: {
        getItem: jest.fn(() => null),
        setItem: jest.fn()
      },
      fetch: jest.fn(),
      JSZip: state.JSZip
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    function loadFile(relPath) {
      const fullPath = path.resolve(__dirname, '../../../../', relPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const cleanContent = content
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+const\s+/g, 'var ')
        .replace(/export\s+let\s+/g, 'var ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/const\s+([a-zA-Z0-9_$]+)\s*=/g, 'var $1 =')
        .replace(/let\s+([a-zA-Z0-9_$]+)\s*=/g, 'var $1 =')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+/g, '');
      vm.runInContext(cleanContent, sandbox);
    }

    // Load submodules if they exist, then navigation.js
    const submodules = [
      'public/js/viewer/nav/offline-loader.js',
      'public/js/viewer/nav/return-nav.js',
      'public/js/viewer/nav/viewer-breadcrumbs.js',
      'public/js/viewer/nav/viewer-opener.js'
    ];
    submodules.forEach(sub => {
      const fullPath = path.resolve(__dirname, '../../../../', sub);
      if (fs.existsSync(fullPath)) {
        loadFile(sub);
      }
    });

    loadFile('public/js/viewer/navigation.js');
  });

  test('IMAGE_FILE_REGEX correctly tests image file extensions', () => {
    const regex = sandbox.IMAGE_FILE_REGEX || sandbox.state.IMAGE_FILE_REGEX;
    expect(regex.test('page1.jpg')).toBe(true);
    expect(regex.test('page2.JPEG')).toBe(true);
    expect(regex.test('page3.png')).toBe(true);
    expect(regex.test('page4.webp')).toBe(true);
    expect(regex.test('page5.gif')).toBe(true);
    expect(regex.test('doc.pdf')).toBe(false);
    expect(regex.test('comic.cbr')).toBe(false);
  });

  test('normalizePagesResponse returns normalized array of pages', () => {
    const fn = sandbox.normalizePagesResponse || sandbox.state.normalizePagesResponse;
    expect(fn(null)).toEqual([]);
    expect(fn(undefined)).toEqual([]);
    expect(fn(['p1.jpg', 'p2.jpg'])).toEqual(['p1.jpg', 'p2.jpg']);
    expect(fn({ pages: ['p1.jpg'] })).toEqual(['p1.jpg']);
    expect(fn({ other: 123 })).toEqual([]);
  });

  test('setLibraryControlsVisibility toggles hidden class on containers', () => {
    const fn = sandbox.setLibraryControlsVisibility || sandbox.state.setLibraryControlsVisibility;
    const search = document.getElementById('search-container');
    const filters = document.getElementById('filters-container');

    fn(false);
    expect(search.classList.contains('hidden')).toBe(true);
    expect(filters.classList.contains('hidden')).toBe(true);

    fn(true);
    expect(search.classList.contains('hidden')).toBe(false);
    expect(filters.classList.contains('hidden')).toBe(false);
  });

  test('loadOfflineComicPages extracts and sorts image names filtering macos files', async () => {
    const fn = sandbox.loadOfflineComicPages || sandbox.state.loadOfflineComicPages;
    const comic = { id: 'comic-1', file: new Blob(['fake']) };
    const pages = await fn(comic);
    expect(pages).toEqual(['01.jpg', '02.jpg']);
  });

  test('navigateBackFromViewer cleans up context and navigates', () => {
    const fn = sandbox.navigateBackFromViewer || sandbox.state.navigateBackFromViewer;
    sandbox.state.viewerReturnContext = {
      view: 'comics',
      rootFolder: '/comics',
      publisher: 'DC',
      series: 'Batman'
    };

    fn();
    expect(sandbox.state.viewerReturnContext).toBeNull();
    expect(sandbox.state.currentSeries).toBe('Batman');
    expect(sandbox.state.showComicList).toHaveBeenCalledWith('Batman');
  });

  test('rebindViewerEvents attaches listeners without throwing', () => {
    const fn = sandbox.rebindViewerEvents || sandbox.state.rebindViewerEvents;
    expect(() => fn()).not.toThrow();
  });
});
