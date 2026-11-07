/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Series View -> Comic View Integration', () => {
  let sandbox;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="breadcrumb-container"></div>
      <div id="comic-list" class="view-container">
        <div id="comic-list-container"></div>
      </div>
      <div id="comic-viewer" class="view-container hidden" style="display: none;">
        <h2 id="comic-title"></h2>
        <p id="comic-subtitle" class="hidden"></p>
        <div id="viewer-pages"></div>
        <div id="page-loader" class="hidden"></div>
        <div id="page-counter"></div>
      </div>
      <div id="fullscreen-viewer" class="fullscreen-viewer hidden">
        <img id="fullscreen-image" />
      </div>
    `;

    const state = {
      currentView: 'comics',
      currentSeries: 'Batman',
      currentPublisher: 'DC Comics',
      currentRootFolder: 'Comics',
      currentFolderPath: 'DC Comics/Batman',
      library: {
        'DC Comics': {
          'Batman': [
            {
              id: 'comic-101',
              name: 'Batman #01',
              totalPages: 24,
              thumbnailPath: 'batman-1.jpg',
              progress: { lastReadPage: 0, totalPages: 24 }
            }
          ]
        }
      },
      preloadedImages: new Map(),
      pageUrlCache: new Map(),
      openComicViewer: null,
      getComicById: (id) => {
        if (id === 'comic-101') {
          return {
            comic: {
              id: 'comic-101',
              name: 'Batman #01',
              totalPages: 24,
              thumbnailPath: 'batman-1.jpg',
              progress: { lastReadPage: 0, totalPages: 24 }
            },
            publisher: 'DC Comics',
            series: 'Batman',
            rootFolder: 'Comics'
          };
        }
        return null;
      },
      showView: (viewDiv) => {
        document.querySelectorAll('.view-container').forEach(el => {
          el.classList.add('hidden');
          el.style.display = 'none';
        });
        if (viewDiv) {
          viewDiv.classList.remove('hidden');
          viewDiv.style.display = '';
        }
      },
      updateViewerPageCounter: jest.fn(),
      hidePageJumpInput: jest.fn(),
      resetComicSummary: jest.fn(),
      updateOrientationButtons: jest.fn(),
      initServerViewer: jest.fn(),
      applyDisplayInfoToComic: (c) => ({ displayTitle: c.name, subtitle: '', altText: c.name }),
      encodePath: (p) => encodeURIComponent(p),
      history: {
        pushState: jest.fn(),
        scrollRestoration: 'auto'
      }
    };

    sandbox = {
      window,
      document,
      Element: window.Element,
      console,
      state,
      global: state,
      canonicalGlobal: state,
      setTimeout,
      clearTimeout,
      URL,
      URLSearchParams,
      APP_CONFIG: { baseUrl: '/test-deploy' },
      history: {
        pushState: jest.fn(),
        scrollRestoration: 'auto'
      },
      addEventListener: window.addEventListener.bind(window)
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);
  });

  function loadFile(relPath) {
    const fullPath = path.resolve(__dirname, '..', relPath);
    let content = fs.readFileSync(fullPath, 'utf8');
    const cleanContent = content
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+const\s+/g, 'var ')
      .replace(/export\s+let\s+/g, 'var ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+class\s+/g, 'class ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[\s\S]*?;?/g, '')
      .replace(/const\s+global\s*=/g, 'var global =')
      .replace(/const\s+escapeHtml\s*=/g, 'var escapeHtml =')
      .replace(/const\s+actionsRef\s*=/g, 'var actionsRef =')
      .replace(/const\s+renderContent\s*=/g, 'var renderContent =')
      .replace(/const\s+safeHtml\s*=/g, 'var safeHtml =')
      .replace(/const\s+API_BASE_URL\s*=/g, 'var API_BASE_URL =');
    vm.runInContext(cleanContent, sandbox);
  }

  test('clicking a comic card in series view transitions DOM to comic viewer', async () => {
    sandbox.escapeHtml = (s) => s || '';
    // 1. Load template engine and router
    loadFile('public/js/ui/template.js');
    loadFile('public/js/router.js');

    // 2. Load viewer opener
    loadFile('public/js/viewer/nav/offline-loader.js');
    loadFile('public/js/viewer/nav/viewer-breadcrumbs.js');
    loadFile('public/js/viewer/nav/return-nav.js');
    loadFile('public/js/viewer/nav/viewer-opener.js');
    loadFile('public/js/viewer/navigation.js');

    // 3. Register routes
    loadFile('public/js/routes.js');
    vm.runInContext(`
      state.comicViewerDiv = document.getElementById('comic-viewer');
      state.comicListDiv = document.getElementById('comic-list');
      state.comicTitleH2 = document.getElementById('comic-title');
      state.comicSubtitleP = document.getElementById('comic-subtitle');
      state.router = router;
      registerRoutes();
    `, sandbox);

    // 4. Load card builder
    vm.runInContext(`
      var ICONS = { READ: '', UNREAD: '', DOWNLOAD: '' };
      var applyDisplayInfoToComic = state.applyDisplayInfoToComic;
      var toggleReadStatus = () => {};
      var applyFilterAndRender = () => {};
    `, sandbox);
    loadFile('public/js/library/render/comics/card-builder.js');

    // 5. Render card in series view
    const comic = {
      id: 'comic-101',
      name: 'Batman #01',
      totalPages: 24,
      thumbnailPath: 'batman-1.jpg',
      progress: { lastReadPage: 0, totalPages: 24 }
    };
    const card = sandbox.createComicCard(comic);
    document.getElementById('comic-list-container').appendChild(card);

    // Initial state: comic list visible, comic viewer hidden
    expect(document.getElementById('comic-list').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('comic-viewer').classList.contains('hidden')).toBe(true);

    sandbox.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: ['page1.jpg', 'page2.jpg'] })
    });
    // User clicks the comic card in series view
    card.click();

    // Verify comic viewer is now visible and series view is hidden
    const comicViewer = document.getElementById('comic-viewer');
    const comicList = document.getElementById('comic-list');

    expect(comicViewer.classList.contains('hidden')).toBe(false);
    expect(comicViewer.style.display).not.toBe('none');
    expect(comicList.classList.contains('hidden')).toBe(true);

    // Verify the title is populated with the comic name
    expect(document.getElementById('comic-title').textContent).toBe('Batman #01');
    expect(sandbox.state.currentView).toBe('comic');
  });

  test('uses real getComicById from comic-utils without mocks to resolve and transition', async () => {
    sandbox.escapeHtml = (s) => s || '';
    // Load real comic-utils and dom-utils
    loadFile('public/js/core/dom-utils.js');
    loadFile('public/js/core/comic-utils.js');

    // Setup realistic library structure
    sandbox.state.library = {
      'lib_0': {
        publishers: {
          'DC Comics': {
            series: {
              'Batman': [
                {
                  id: 'comic-999',
                  name: 'Batman #999',
                  totalPages: 30,
                  thumbnailPath: 'b999.jpg',
                  progress: { lastReadPage: 5, totalPages: 30 }
                }
              ]
            }
          }
        }
      }
    };
    sandbox.window.library = sandbox.state.library;
    sandbox.state.getComicById = sandbox.getComicById;

    // Verify real getComicById resolves the comic
    const resolved = sandbox.getComicById('comic-999', true);
    expect(resolved).not.toBeNull();
    expect(resolved.comic.name).toBe('Batman #999');
    expect(resolved.publisher).toBe('DC Comics');
    expect(resolved.series).toBe('Batman');

    // Load full pipeline with real getComicById
    loadFile('public/js/ui/template.js');
    loadFile('public/js/router.js');
    loadFile('public/js/viewer/nav/offline-loader.js');
    loadFile('public/js/viewer/nav/viewer-breadcrumbs.js');
    loadFile('public/js/viewer/nav/return-nav.js');
    loadFile('public/js/viewer/nav/viewer-opener.js');
    loadFile('public/js/viewer/navigation.js');
    loadFile('public/js/routes.js');

    vm.runInContext(`
      state.comicViewerDiv = document.getElementById('comic-viewer');
      state.comicListDiv = document.getElementById('comic-list');
      state.comicTitleH2 = document.getElementById('comic-title');
      state.comicSubtitleP = document.getElementById('comic-subtitle');
      state.router = router;
      registerRoutes();
    `, sandbox);

    vm.runInContext(`
      var ICONS = { READ: '', UNREAD: '', DOWNLOAD: '' };
      var applyDisplayInfoToComic = state.applyDisplayInfoToComic;
      var toggleReadStatus = () => {};
      var applyFilterAndRender = () => {};
    `, sandbox);
    loadFile('public/js/library/render/comics/card-builder.js');

    const comic = sandbox.state.library['lib_0'].publishers['DC Comics'].series['Batman'][0];
    const card = sandbox.createComicCard(comic);
    document.getElementById('comic-list-container').appendChild(card);

    sandbox.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: ['page1.jpg', 'page2.jpg'] })
    });

    card.click();

    const comicViewer = document.getElementById('comic-viewer');
    const comicList = document.getElementById('comic-list');

    expect(comicViewer.classList.contains('hidden')).toBe(false);
    expect(comicList.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('comic-title').textContent).toBe('Batman #999');
    expect(sandbox.state.currentView).toBe('comic');
  });
});
