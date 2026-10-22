/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Continuous Reading Mode MutationObserver & Event Safety Regression Test', () => {
  let sandbox;
  let state;
  let mockComic;
  let mutationCount;
  let trackedObserver;

  beforeEach(() => {
    mutationCount = 0;

    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer">
        <div id="fullscreen-title" class="fullscreen-title"></div>
        <button id="fullscreen-close-btn"></button>
        <div id="fullscreen-controls" class="fullscreen-controls">
          <button id="fullscreen-continuous-mode-btn" class="continuous-mode-btn"></button>
          <button id="manga-guided-toggle-btn" class="active"></button>
          <button id="western-guided-toggle-btn" class="active"></button>
          <button id="western-speech-zoom" class="active"></button>
          <button id="manga-panel-zoom" class="active"></button>
          <button id="manga-speech-zoom-btn" class="active"></button>
        </div>
        <img id="fullscreen-image" src="page1.jpg" />
        <div id="fullscreen-pages-continuous" class="hidden"></div>
        <button id="fullscreen-prev-page-btn">&larr;</button>
        <button id="fullscreen-next-page-btn">&rarr;</button>
        <div id="fullscreen-nav-left"></div>
        <div id="fullscreen-nav-right"></div>
        <div id="viewer-pages" data-pages='["p1.jpg", "p2.jpg", "p3.jpg"]'></div>
        <span id="page-counter"></span>
        <span id="page-counter-bottom"></span>
      </div>
    `;

    mockComic = {
      id: 'comic-freeze-test',
      name: 'Non-Freezing Comic #1',
      continuousMode: false,
      guidedMode: true,
      bubbleMode: false,
      hotZoomMode: false,
      mangaBubbleHotMode: false,
      guidedViewStatus: 'completed'
    };

    class ActiveMutationObserver {
      constructor(callback) {
        this.callback = callback;
        trackedObserver = this;
      }
      observe(target, options) {
        this.target = target;
        this.options = options;
        const origAdd = target.classList.add.bind(target.classList);
        const origRemove = target.classList.remove.bind(target.classList);
        const origToggle = target.classList.toggle.bind(target.classList);

        const recordMutation = () => {
          mutationCount++;
          if (mutationCount > 50) {
            throw new Error(`Infinite MutationObserver feedback loop detected! Mutations exceeded 50 (count=${mutationCount})`);
          }
          Promise.resolve().then(() => {
            this.callback([{ type: 'attributes', attributeName: 'class', target }]);
          });
        };

        target.classList.add = (...args) => {
          origAdd(...args);
          recordMutation();
        };
        target.classList.remove = (...args) => {
          origRemove(...args);
          recordMutation();
        };
        target.classList.toggle = (...args) => {
          const res = origToggle(...args);
          recordMutation();
          return res;
        };
      }
      disconnect() {}
    }

    class MockIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    state = {
      currentComic: mockComic,
      currentPageIndex: 0,
      isContinuousMode: false,
      viewerPagesDiv: document.getElementById('viewer-pages'),
      fullscreenViewer: document.getElementById('fullscreen-viewer'),
      fullscreenImage: document.getElementById('fullscreen-image'),
      fullscreenControls: document.getElementById('fullscreen-controls'),
      getPageUrl: jest.fn(p => Promise.resolve(`blob:${p}`)),
      getViewerPages: jest.fn(() => ['p1.jpg', 'p2.jpg', 'p3.jpg']),
      updateComicInLibrary: jest.fn((id, updates) => Object.assign(mockComic, updates)),
      updateDownloadedComicInfo: jest.fn().mockResolvedValue(undefined),
      updateDownloadedSmartListComic: jest.fn(),
      loadLibraryCacheFromDB: jest.fn().mockResolvedValue({ data: {} }),
      saveLibraryCacheToDB: jest.fn().mockResolvedValue(undefined),
      updateLibraryProgress: jest.fn(),
      saveProgress: jest.fn().mockResolvedValue(undefined),
      showFullscreenControls: jest.fn(),
      hideFullscreenControls: jest.fn(),
      GuidedView: {
        cache: new Map([['comic-freeze-test', { pages: { p1: { sequence: [{}], bubbles: [{}] } } }]]),
        loadGuidedView: jest.fn().mockResolvedValue({ pages: {} }),
        currentPagePanels: () => [],
        isMangaComic: () => false,
        applyClasses: (needsLayout) => {
          const stage = document.getElementById('fullscreen-viewer');
          if (stage) stage.classList.toggle('guided-stage', !!needsLayout);
        },
        applyZoomCss: (isActive) => {
          const stage = document.getElementById('fullscreen-viewer');
          if (stage) stage.classList.toggle('guided-zoom-no-touchmenu', !!isActive);
        },
        applyTransform: jest.fn(),
        applyBubbleOverlay: jest.fn(),
        updateToggleUI: jest.fn(),
        updateBubbleToggleUI: jest.fn(),
        updateWesternSpeechZoomUI: jest.fn(),
        updateMangaPanelZoomUI: jest.fn(),
        updateMangaSpeechZoomUI: jest.fn(),
        isFullscreenOpen: () => true
      }
    };

    window.HTMLElement.prototype.scrollIntoView = jest.fn();

    sandbox = {
      window,
      document,
      HTMLElement: window.HTMLElement,
      MutationObserver: ActiveMutationObserver,
      IntersectionObserver: MockIntersectionObserver,
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      requestAnimationFrame: (cb) => cb(),
      Promise
    };
    vm.createContext(sandbox);

    function loadModule(relPath) {
      const fullPath = path.join(__dirname, '..', relPath);
      let code = fs.readFileSync(fullPath, 'utf-8')
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
        .replace(/export\s+async\s+function\s+/g, 'async function ')
        .replace(/export\s+function\s+/g, 'function ')
        .replace(/export\s+const\s+/g, 'const ')
        .replace(/export\s+\{[\s\S]*?\};?/g, '')
        .replace(/export\s+default\s+[^;]+;?/g, '');
      new vm.Script(code, { filename: fullPath }).runInContext(sandbox);
    }

    loadModule('public/js/viewer/guided/mode-registry.js');
    loadModule('public/js/viewer/guided/modes/guided.js');
    loadModule('public/js/viewer/guided/lifecycle.js');
    loadModule('public/js/viewer/fullscreen.js');
    loadModule('public/js/continuous.js');
  });

  test('1. watchFullscreenToggle must NOT trigger an infinite MutationObserver microtask loop when continuous mode is enabled', async () => {
    // Mount the observer as guided/index.js does
    sandbox.watchFullscreenToggle();

    // Enable continuous mode
    await sandbox.enableContinuousMode();

    // Allow pending microtasks and macrotasks to flush
    await new Promise(r => setTimeout(r, 80));

    // Must not have entered infinite loop and mutations must be minimal (< 10)
    expect(mutationCount).toBeLessThan(10);
    expect(sandbox.state.isContinuousMode).toBe(true);
    expect(mockComic.continuousMode).toBe(true);
    expect(mockComic.guidedMode).toBe(false);
  });

  test('2. watchFullscreenToggle ignores non-visibility class changes like continuous-active or controls-open', async () => {
    sandbox.watchFullscreenToggle();
    const fv = document.getElementById('fullscreen-viewer');

    mutationCount = 0;
    fv.classList.add('has-controls-open');
    fv.classList.add('continuous-active');
    fv.classList.remove('guided-stage');

    await new Promise(r => setTimeout(r, 40));

    // Non-visibility classes must not trigger refreshGuidedToggle loops
    expect(mutationCount).toBeLessThanOrEqual(5);
  });

  test('3. setupContinuousModeButtonHandler is idempotent and does not bind duplicate click listeners', async () => {
    const btn = document.getElementById('fullscreen-continuous-mode-btn');

    // Call initializeContinuousMode twice (simulating script load + DOMContentLoaded)
    sandbox.initializeContinuousMode();
    sandbox.initializeContinuousMode();

    mutationCount = 0;
    mockComic.continuousMode = false;

    // Single click should toggle continuousMode once (from false to true)
    btn.click();
    await new Promise(r => setTimeout(r, 80));

    expect(mockComic.continuousMode).toBe(true);
    expect(sandbox.state.isContinuousMode).toBe(true);
    expect(mutationCount).toBeLessThan(10);
  });
});
