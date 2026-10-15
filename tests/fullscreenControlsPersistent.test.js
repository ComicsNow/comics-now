/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Fullscreen persistent header controls', () => {
  let sandbox;
  let state;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="fullscreen-viewer" class="fullscreen-viewer hidden">
        <div id="fullscreen-title" class="fullscreen-title hidden" role="heading" aria-level="2"></div>
        <button id="fullscreen-close-btn" class="fullscreen-close-button hidden" type="button">
          <span aria-hidden="true">&times;</span>
        </button>
        <div id="fullscreen-controls" class="fullscreen-controls hidden"></div>
        <img id="fullscreen-image" src="test.jpg" />
        <div id="fullscreen-scrubber-container" class="hidden"></div>
      </div>
    `;

    state = {
      fullscreenViewer: document.getElementById('fullscreen-viewer'),
      fullscreenTitle: document.getElementById('fullscreen-title'),
      fullscreenCloseBtn: document.getElementById('fullscreen-close-btn'),
      fullscreenControls: document.getElementById('fullscreen-controls'),
      fullscreenImage: document.getElementById('fullscreen-image'),
      currentComic: { name: 'Batman (2016) #1', series: 'Batman' },
      currentPageIndex: 0,
      resetFullscreenZoom: jest.fn(),
      renderPage: jest.fn().mockResolvedValue(undefined),
      applyFullscreenFitMode: jest.fn()
    };

    sandbox = {
      window,
      document,
      state,
      console: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id)
    };
    vm.createContext(sandbox);

    const filePath = path.join(__dirname, '../public/js/viewer/fullscreen.js');
    const code = fs.readFileSync(filePath, 'utf-8');
    const cleanContent = code
      .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+async\s+function\s+/g, 'async function ')
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+const\s+/g, 'const ')
      .replace(/export\s+\{[\s\S]*?\};?/g, '')
      .replace(/export\s+default\s+[^;]+;?/g, '');
    new vm.Script(cleanContent).runInContext(sandbox);
  });

  test('hideFullscreenControls leaves title and top-right close button visible', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');
    const controls = document.getElementById('fullscreen-controls');

    // Show controls first
    sandbox.showFullscreenControls(false);
    expect(controls.classList.contains('hidden')).toBe(false);
    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);

    // Call hideFullscreenControls
    sandbox.hideFullscreenControls();

    // Controls container should be hidden, but title and close button must NOT be hidden
    expect(controls.classList.contains('hidden')).toBe(true);
    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
  });

  test('auto-hide timer keeps title and close button visible after timeout', () => {
    jest.useFakeTimers();
    try {
      const titleEl = document.getElementById('fullscreen-title');
      const closeBtn = document.getElementById('fullscreen-close-btn');
      const controls = document.getElementById('fullscreen-controls');

      sandbox.showFullscreenControls(true);
      expect(controls.classList.contains('hidden')).toBe(false);
      expect(titleEl.classList.contains('hidden')).toBe(false);
      expect(closeBtn.classList.contains('hidden')).toBe(false);

      // Fast-forward past the autohide delay (3000ms)
      jest.advanceTimersByTime(3500);

      // Controls container should be hidden, but title and close button must stay visible
      expect(controls.classList.contains('hidden')).toBe(true);
      expect(titleEl.classList.contains('hidden')).toBe(false);
      expect(closeBtn.classList.contains('hidden')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('openFullscreen displays title and close button and populates title text', () => {
    const titleEl = document.getElementById('fullscreen-title');
    const closeBtn = document.getElementById('fullscreen-close-btn');

    // Initially both have 'hidden' class
    titleEl.classList.add('hidden');
    closeBtn.classList.add('hidden');

    sandbox.openFullscreen();

    expect(titleEl.classList.contains('hidden')).toBe(false);
    expect(closeBtn.classList.contains('hidden')).toBe(false);
    expect(titleEl.textContent).toBe('Batman (2016) #1');
  });
});
