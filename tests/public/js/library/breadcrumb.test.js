/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEsmInSandbox(relPath) {
  const fullPath = path.resolve(__dirname, '../../../..', relPath);
  let content = fs.readFileSync(fullPath, 'utf8');
  content = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'var ')
    .replace(/export\s+let\s+/g, 'var ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '');

  const sandbox = {
    window,
    document,
    Element: window.Element,
    Node: window.Node,
    state: { activeFilter: 'all' },
    clearElement: (el) => { if (el) el.replaceChildren(); },
    requestAnimationFrame: (cb) => cb(),
    scrollTo: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(content, sandbox);
  return sandbox;
}

describe('Breadcrumb & Layout Hierarchy', () => {
  describe('updateBreadcrumb', () => {
    beforeEach(() => {
      document.body.innerHTML = '<nav id="breadcrumb" aria-label="Breadcrumb" class="hidden flex items-center gap-1.5 text-sm mb-4 px-1 flex-wrap"></nav>';
    });

    it('hides #breadcrumb when segments is empty or only contains the current page', () => {
      const { updateBreadcrumb } = loadEsmInSandbox('public/js/library/breadcrumb.js');
      const nav = document.getElementById('breadcrumb');

      updateBreadcrumb([]);
      expect(nav.classList.contains('hidden')).toBe(true);
      expect(nav.children.length).toBe(0);

      updateBreadcrumb([{ label: 'New' }]);
      expect(nav.classList.contains('hidden')).toBe(true);
      expect(nav.children.length).toBe(0);
    });

    it('omits the current page (last segment) and renders only ancestor buttons', () => {
      const { updateBreadcrumb } = loadEsmInSandbox('public/js/library/breadcrumb.js');
      const nav = document.getElementById('breadcrumb');
      const onLibraries = jest.fn();
      const onPublisher = jest.fn();

      updateBreadcrumb([
        { label: 'Libraries', action: onLibraries },
        { label: 'DC Comics', action: onPublisher },
        { label: 'Batman' }
      ]);

      expect(nav.classList.contains('hidden')).toBe(false);
      expect(nav.classList.contains('flex')).toBe(true);

      const buttons = Array.from(nav.querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Libraries', 'DC Comics']);
      expect(buttons.every((b) => b.classList.contains('underline'))).toBe(true);
      expect(nav.textContent).not.toContain('Batman');

      buttons[0].click();
      buttons[1].click();
      expect(onLibraries).toHaveBeenCalledTimes(1);
      expect(onPublisher).toHaveBeenCalledTimes(1);
    });

    it('renders a single ancestor button without trailing separator when 2 segments are passed', () => {
      const { updateBreadcrumb } = loadEsmInSandbox('public/js/library/breadcrumb.js');
      const nav = document.getElementById('breadcrumb');
      const onLibraries = jest.fn();

      updateBreadcrumb([
        { label: 'Libraries', action: onLibraries },
        { label: 'Marvel' }
      ]);

      const buttons = Array.from(nav.querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Libraries']);
      expect(nav.textContent).toBe('Libraries');
    });
  });

  describe('showView filters-container mounting', () => {
    it('mounts #filters-container into the active view .filters-mount below its title', () => {
      document.body.innerHTML = `
        <div id="search-container"></div>
        <div id="filters-container"></div>
        <div id="root-folder-list"><div class="filters-mount"></div></div>
        <div id="publisher-list" class="hidden">
          <h2 id="publisher-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="series-list" class="hidden">
          <h2 id="series-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="comic-list" class="hidden">
          <h2 id="comic-list-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="folder-list-view" class="hidden">
          <h2 id="folder-list-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="smart-list-view" class="hidden">
          <h2 id="smart-list-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="search-results-view" class="hidden">
          <h2 id="search-results-title" class="view-title"></h2>
          <div class="filters-mount"></div>
        </div>
        <div id="comic-viewer" class="hidden"></div>
      `;

      const { showView } = loadEsmInSandbox('public/js/core/comic-utils.js');
      const seriesList = document.getElementById('series-list');
      const filtersContainer = document.getElementById('filters-container');
      const comicViewer = document.getElementById('comic-viewer');

      showView(seriesList);
      expect(seriesList.classList.contains('hidden')).toBe(false);
      expect(filtersContainer.classList.contains('hidden')).toBe(false);
      expect(filtersContainer.parentElement).toBe(seriesList.querySelector('.filters-mount'));

      showView(comicViewer);
      expect(filtersContainer.classList.contains('hidden')).toBe(true);
    });
  });

  describe('public/index.html layout order', () => {
    const htmlPath = path.resolve(__dirname, '../../../../public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    it('places #breadcrumb between the Comics Now! title and the action buttons', () => {
      const logoIdx = html.indexOf('class="app-title-riso"');
      const breadcrumbIdx = html.indexOf('id="breadcrumb"');
      const buttonsIdx = html.indexOf('id="logout-button"');

      expect(logoIdx).toBeGreaterThan(-1);
      expect(breadcrumbIdx).toBeGreaterThan(logoIdx);
      expect(buttonsIdx).toBeGreaterThan(breadcrumbIdx);
    });

    it('places each library view title below #search-container and above .filters-mount', () => {
      const searchIdx = html.indexOf('id="search-container"');
      const titles = [
        'id="search-results-title"',
        'id="smart-list-title"',
        'id="folder-list-title"',
        'id="publisher-title"',
        'id="series-title"',
        'id="comic-list-title"',
      ];

      for (const titleMarker of titles) {
        const titleIdx = html.indexOf(titleMarker);
        const mountIdx = html.indexOf('class="filters-mount"', titleIdx);
        expect(titleIdx).toBeGreaterThan(searchIdx);
        expect(mountIdx).toBeGreaterThan(titleIdx);
      }
    });
  });
});
