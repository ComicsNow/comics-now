/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createComicsRenderSandbox() {
  const state = {
    currentView: 'comics',
    currentSeries: 'Batman',
    currentPublisher: 'DC',
    currentRootFolder: '/media/comics',
    activeFilter: 'all',
    downloadedComicIds: new Set()
  };

  const sandbox = {
    window: window,
    document: document,
    Element: window.Element,
    state: state,
    console: console,
    openComicViewer: jest.fn(),
    showComicContextMenu: jest.fn(),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
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
      .replace(/const\s+actionsRef\s*=/g, 'var actionsRef =')
      .replace(/const\s+clear\s*=/g, 'var clear =')
      .replace(/const\s+renderContent\s*=/g, 'var renderContent =')
      .replace(/const\s+safeHtml\s*=/g, 'var safeHtml =')
      .replace(/const\s+safeRaw\s*=/g, 'var safeRaw =')
      .replace(/const\s+API_BASE_URL\s*=/g, 'var API_BASE_URL =');
    vm.runInContext(content, sandbox);
  }

  // Load actual template engine first
  loadFile('public/js/ui/template.js');

  // Define mock global helpers in sandbox
  vm.runInContext(`
    var clearElement = (el) => { if (el) el.innerHTML = ''; };
    var ICONS = { READ: '<span>[READ]</span>', UNREAD: '<span>[UNREAD]</span>', DOWNLOAD: '<span>[DL]</span>' };
    var createEmptyMessage = (msg) => ({ __isRawHtml: true, html: '<div class="empty">' + msg + '</div>' });
    var createLoadingMessage = (msg) => ({ __isRawHtml: true, html: '<div class="loading">' + msg + '</div>' });
    var applyDisplayInfoToComic = (c) => ({ displayTitle: c.name || 'Untitled', subtitle: '', altText: c.name || '' });
    var toggleReadStatus = () => {};
    var getComicStatus = () => 'unread';
    var updateFilterButtonCounts = () => {};
    var updateBreadcrumb = () => {};
    var renderAlphaFilter = () => {};
    var syncSmartFilterButtons = () => {};
    var mountSmartFilterHostInto = () => {};
    var showView = () => {};
  `, sandbox);

  return { sandbox, state, loadFile };
}

describe('public/js/library/render/comics.js', () => {
  let ctx;

  beforeEach(() => {
    ctx = createComicsRenderSandbox();
    ctx.loadFile('public/js/library/render/comics/card-builder.js');
    ctx.loadFile('public/js/library/render/comics.js');
  });

  describe('renderComicCards', () => {
    it('renders empty message if comics array is empty', () => {
      const container = document.createElement('div');
      ctx.sandbox.renderComicCards([], null, container);
      expect(container.innerHTML).toContain('No comics found.');
    });

    it('renders comic cards with title and badges', () => {
      const container = document.createElement('div');
      const comics = [
        {
          id: 'comic-1',
          name: 'Batman #1',
          thumbnailPath: 'thumb1.jpg',
          totalPages: 32,
          progress: { lastReadPage: 16, totalPages: 32 }
        }
      ];
      ctx.sandbox.renderComicCards(comics, null, container);
      expect(container.children.length).toBe(1);
      const card = container.children[0];
      expect(card.classList.contains('comic-card')).toBe(true);
      expect(card.innerHTML).toContain('Batman #1');
      expect(card.innerHTML).toContain('thumb1.jpg');
      expect(card.innerHTML).toContain('p.32');
    });

    it('attaches click handler to open comic viewer', () => {
      const mockOpen = jest.fn();
      ctx.sandbox.window.openComicViewer = mockOpen;
      const container = document.createElement('div');
      const comics = [{ id: 'comic-1', name: 'Batman #1' }];
      ctx.sandbox.renderComicCards(comics, null, container);
      const card = container.children[0];
      card.click();
      expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'comic-1' }));
    });
  });
});
