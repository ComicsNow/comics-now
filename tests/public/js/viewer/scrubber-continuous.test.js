/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModuleInVm(relPath, sandbox) {
  const fullPath = path.resolve(__dirname, '../../../..', relPath);
  const content = fs.readFileSync(fullPath, 'utf8');

  const cleanContent = content
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/export\s+class\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = class $1')
    .replace(/export\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = function $1')
    .replace(/export\s+async\s+function\s+([a-zA-Z0-9_$]+)/g, 'globalThis.$1 = async function $1')
    .replace(/export\s+const\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/export\s+let\s+([a-zA-Z0-9_$]+)\s*=/g, 'globalThis.$1 =')
    .replace(/\bconst\s+/g, 'var ')
    .replace(/\blet\s+/g, 'var ')
    .replace(/export\s+\{[\s\S]*?\};?/g, '')
    .replace(/export\s+default\s+[\s\S]*?;?/g, '');

  const script = new vm.Script(cleanContent);
  script.runInContext(sandbox);
}

describe('Page scrubber in continuous mode', () => {
  describe('goToPage (thumbnail-url.js) is continuous-aware', () => {
    let sandbox;
    let state;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="fullscreen-pages-continuous">
          <div class="page-container" data-index="0"></div>
          <div class="page-container" data-index="1"></div>
          <div class="page-container" data-index="2"></div>
        </div>
      `;
      window.HTMLElement.prototype.scrollIntoView = jest.fn();

      state = {
        currentPageIndex: 0,
        getViewerPages: jest.fn(() => ['p1.jpg', 'p2.jpg', 'p3.jpg']),
        currentComic: { id: 'comic-123', progress: { totalPages: 3 } },
        saveProgress: jest.fn(),
        updateLibraryProgress: jest.fn(),
        renderPage: jest.fn(async () => true)
      };

      const actions = {
        viewer: {
          setPageIndex: jest.fn((idx) => { state.currentPageIndex = idx; return idx; })
        }
      };

      sandbox = {
        window: { ...window, HTMLElement: window.HTMLElement },
        document,
        state,
        actions,
        continuousState: { isContinuousMode: true, continuousContainer: null },
        console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
      };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      sandbox.continuousState.continuousContainer = document.getElementById('fullscreen-pages-continuous');
    });

    test('scrolls the continuous container to the target page instead of rendering a single page', async () => {
      loadModuleInVm('public/js/viewer/previews/thumbnail-url.js', sandbox);

      const result = await sandbox.goToPage(2);

      expect(result).toBe(true);
      expect(state.currentPageIndex).toBe(2);
      const target = document.querySelector('.page-container[data-index="2"]');
      expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
      expect(state.renderPage).not.toHaveBeenCalled();
    });

    test('falls back to single-page render when no matching container exists', async () => {
      sandbox.continuousState.continuousContainer.querySelectorAll('.page-container[data-index="2"]')
        .forEach(el => el.remove());
      loadModuleInVm('public/js/viewer/previews/thumbnail-url.js', sandbox);

      const result = await sandbox.goToPage(2);

      expect(result).toBe(true);
      expect(state.currentPageIndex).toBe(2);
      expect(state.renderPage).toHaveBeenCalled();
    });

    test('renders a single page when not in continuous mode', async () => {
      sandbox.continuousState.isContinuousMode = false;
      loadModuleInVm('public/js/viewer/previews/thumbnail-url.js', sandbox);

      const result = await sandbox.goToPage(1);

      expect(result).toBe(true);
      expect(state.currentPageIndex).toBe(1);
      expect(state.renderPage).toHaveBeenCalled();
      expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe('updateCurrentPageFromScroll (continuous/progress.js) syncs the scrubber', () => {
    let sandbox;
    let state;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="fullscreen-pages-continuous">
          <div class="page-container" data-index="0"></div>
          <div class="page-container" data-index="1"></div>
        </div>
      `;
      window.HTMLElement.prototype.scrollIntoView = jest.fn();

      state = {
        currentPageIndex: 0,
        getViewerPages: jest.fn(() => ['p1.jpg', 'p2.jpg']),
        updateViewerPageCounter: jest.fn(),
        updateReaderScrubberStatus: jest.fn(),
        currentComic: { id: 'comic-123', progress: { totalPages: 2 } },
        saveProgress: jest.fn(),
        updateLibraryProgress: jest.fn()
      };

      const actions = {
        viewer: {
          setPageIndex: jest.fn((idx) => { state.currentPageIndex = idx; return idx; })
        }
      };

      sandbox = {
        window: { ...window, HTMLElement: window.HTMLElement },
        document,
        state,
        actions,
        console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
      };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);

      loadModuleInVm('public/js/continuous/state.js', sandbox);
      loadModuleInVm('public/js/continuous/progress.js', sandbox);
      sandbox.continuousState.continuousContainer = document.getElementById('fullscreen-pages-continuous');

      // Page 0 center is far from viewport middle; page 1 center is closest.
      const viewportMiddle = window.innerHeight / 2;
      Object.defineProperty(document.querySelector('.page-container[data-index="0"]'), 'getBoundingClientRect', {
        value: () => ({ top: viewportMiddle + 500, height: 1000 })
      });
      Object.defineProperty(document.querySelector('.page-container[data-index="1"]'), 'getBoundingClientRect', {
        value: () => ({ top: viewportMiddle - 200, height: 400 })
      });
    });

    test('updates the reader scrubber status with the closest page while scrolling', async () => {
      await sandbox.updateCurrentPageFromScroll();

      expect(state.currentPageIndex).toBe(1);
      expect(state.updateReaderScrubberStatus).toHaveBeenCalledWith(2, 2);
    });
  });
});
